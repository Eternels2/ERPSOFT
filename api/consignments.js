'use strict';
/* Depots-vente : livraison en depot chez un libraire, retours partiels, facturation du vendu. */
const { db, tx, nextRef } = require('../lib/db');
const { route, ApiError } = require('../lib/web');
const { round2, createInvoice, stockMove, findByIsbn } = require('../lib/services');

function getConsignment(id) {
  const c = db.prepare(`SELECT c.*, t.name AS client_name, t.code AS client_code, i.ref AS invoice_ref
    FROM consignments c JOIN thirdparties t ON t.id = c.fk_client
    LEFT JOIN invoices i ON i.id = c.fk_invoice WHERE c.id = ?`).get(Number(id));
  if (!c) throw new ApiError(404, 'Depot-vente introuvable');
  c.lines = db.prepare(`SELECT l.*, p.isbn, p.title, p.author, p.tva_rate FROM consignment_lines l
    JOIN products p ON p.id = l.fk_product WHERE l.fk_consignment = ? ORDER BY l.position, l.id`).all(c.id);
  c.total_ht = round2(c.lines.reduce((s, l) => s + l.qty_delivered * l.price_ht, 0));
  c.sold_ht = round2(c.lines.reduce((s, l) => s + (l.qty_delivered - l.qty_returned) * l.price_ht, 0));
  return c;
}

route('GET', '/api/consignments', async (ctx) => {
  const { status, q } = ctx.query;
  let sql = `SELECT c.*, t.name AS client_name,
      (SELECT COALESCE(SUM(qty_delivered),0) FROM consignment_lines WHERE fk_consignment = c.id) AS qty_delivered,
      (SELECT COALESCE(SUM(qty_returned),0) FROM consignment_lines WHERE fk_consignment = c.id) AS qty_returned,
      (SELECT COALESCE(SUM(qty_delivered * price_ht),0) FROM consignment_lines WHERE fk_consignment = c.id) AS total_ht
    FROM consignments c JOIN thirdparties t ON t.id = c.fk_client WHERE 1=1`;
  const args = [];
  if (status !== undefined && status !== '') { sql += ' AND c.status = ?'; args.push(Number(status)); }
  if (q) { sql += ' AND (c.ref LIKE ? OR t.name LIKE ?)'; args.push(`%${q}%`, `%${q}%`); }
  sql += ' ORDER BY c.id DESC LIMIT 300';
  return db.prepare(sql).all(...args);
});

route('GET', '/api/consignments/:id', async (ctx) => getConsignment(ctx.params.id));

route('POST', '/api/consignments', async (ctx) => {
  const b = ctx.body;
  const client = db.prepare("SELECT id FROM thirdparties WHERE id = ? AND type = 'client'").get(Number(b.fk_client));
  if (!client) throw new ApiError(400, 'Client invalide');
  const ref = nextRef('DV');
  const r = db.prepare(`INSERT INTO consignments (ref, fk_client, date_consignment, note, fk_user_creat)
    VALUES (?,?,?,?,?)`)
    .run(ref, client.id, b.date_consignment || new Date().toISOString().slice(0, 10), b.note || null, ctx.session.user.id);
  return { id: Number(r.lastInsertRowid), ref };
});

function requireStatus(id, status, msg) {
  const c = db.prepare('SELECT * FROM consignments WHERE id = ?').get(Number(id));
  if (!c) throw new ApiError(404, 'Depot-vente introuvable');
  if (c.status !== status) throw new ApiError(400, msg);
  return c;
}

route('POST', '/api/consignments/:id/lines', async (ctx) => {
  const c = requireStatus(ctx.params.id, 0, 'Cette action necessite un depot-vente encore en brouillon');
  const b = ctx.body;
  let product = null;
  if (b.fk_product) product = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(b.fk_product));
  else if (b.isbn) product = findByIsbn(b.isbn);
  if (!product) throw new ApiError(404, 'Livre introuvable');
  const qty = Math.max(1, Number(b.qty) || 1);
  const price = b.price_ht !== undefined && b.price_ht !== '' ? Number(b.price_ht) : product.price_ht;
  const existing = db.prepare('SELECT * FROM consignment_lines WHERE fk_consignment = ? AND fk_product = ?').get(c.id, product.id);
  if (existing) db.prepare('UPDATE consignment_lines SET qty_delivered = qty_delivered + ? WHERE id = ?').run(qty, existing.id);
  else {
    const pos = db.prepare('SELECT COALESCE(MAX(position),0)+1 AS p FROM consignment_lines WHERE fk_consignment = ?').get(c.id).p;
    db.prepare('INSERT INTO consignment_lines (fk_consignment, fk_product, qty_delivered, price_ht, position) VALUES (?,?,?,?,?)')
      .run(c.id, product.id, qty, price, pos);
  }
  return { ok: true };
});

route('PUT', '/api/consignments/:id/lines/:lineId', async (ctx) => {
  const c = requireStatus(ctx.params.id, 0, 'Cette action necessite un depot-vente encore en brouillon');
  const l = db.prepare('SELECT * FROM consignment_lines WHERE id = ? AND fk_consignment = ?').get(Number(ctx.params.lineId), c.id);
  if (!l) throw new ApiError(404, 'Ligne introuvable');
  const qty = ctx.body.qty_delivered !== undefined ? Number(ctx.body.qty_delivered) : l.qty_delivered;
  if (qty <= 0) throw new ApiError(400, 'La quantite doit etre superieure a zero');
  db.prepare('UPDATE consignment_lines SET qty_delivered = ?, price_ht = ? WHERE id = ?')
    .run(qty, ctx.body.price_ht !== undefined ? Number(ctx.body.price_ht) : l.price_ht, l.id);
  return { ok: true };
});

route('DELETE', '/api/consignments/:id/lines/:lineId', async (ctx) => {
  const c = requireStatus(ctx.params.id, 0, 'Cette action necessite un depot-vente encore en brouillon');
  db.prepare('DELETE FROM consignment_lines WHERE id = ? AND fk_consignment = ?').run(Number(ctx.params.lineId), c.id);
  return { ok: true };
});

/* Validation : le stock sort de l'entrepot vers le depot du client. */
route('POST', '/api/consignments/:id/validate', async (ctx) => {
  const c = requireStatus(ctx.params.id, 0, 'Cette action necessite un depot-vente encore en brouillon');
  const lines = db.prepare('SELECT * FROM consignment_lines WHERE fk_consignment = ?').all(c.id);
  if (!lines.length) throw new ApiError(400, "Le depot-vente n'a aucune ligne");
  tx(() => {
    for (const l of lines) {
      stockMove(l.fk_product, 'main', -l.qty_delivered, 'Depot-vente ' + c.ref, c.ref, ctx.session.user.id);
    }
    db.prepare('UPDATE consignments SET status = 1 WHERE id = ?').run(c.id);
  });
  return { ok: true };
});

/* Enregistrement d'un retour partiel : le stock revient dans l'entrepot. */
route('POST', '/api/consignments/:id/return', async (ctx) => {
  const c = db.prepare('SELECT * FROM consignments WHERE id = ?').get(Number(ctx.params.id));
  if (!c) throw new ApiError(404, 'Depot-vente introuvable');
  if (c.status !== 1) throw new ApiError(400, 'Cette action necessite un depot-vente valide');
  const { line_id, qty } = ctx.body;
  const l = db.prepare('SELECT * FROM consignment_lines WHERE id = ? AND fk_consignment = ?').get(Number(line_id), c.id);
  if (!l) throw new ApiError(404, 'Ligne introuvable');
  const n = Number(qty);
  if (!n || n <= 0) throw new ApiError(400, 'Aucune quantite de retour saisie');
  if (l.qty_returned + n > l.qty_delivered) throw new ApiError(400, 'Le retour depasse la quantite livree');
  tx(() => {
    db.prepare('UPDATE consignment_lines SET qty_returned = qty_returned + ? WHERE id = ?').run(n, l.id);
    stockMove(l.fk_product, 'main', n, 'Retour depot-vente ' + c.ref, c.ref, ctx.session.user.id);
  });
  return { ok: true };
});

/* Facturation de la quantite vendue (livree - retournee). */
route('POST', '/api/consignments/:id/invoice', async (ctx) => {
  const c = db.prepare('SELECT * FROM consignments WHERE id = ?').get(Number(ctx.params.id));
  if (!c) throw new ApiError(404, 'Depot-vente introuvable');
  if (c.status !== 1) throw new ApiError(400, 'Cette action necessite un depot-vente valide');
  if (c.fk_invoice) throw new ApiError(400, 'Une facture a deja ete generee pour ce depot-vente');
  const lines = db.prepare(`SELECT l.*, p.title, p.isbn, p.tva_rate FROM consignment_lines l
    JOIN products p ON p.id = l.fk_product WHERE l.fk_consignment = ?`).all(c.id);
  const invLines = lines
    .filter((l) => l.qty_delivered - l.qty_returned > 0)
    .map((l) => ({
      fk_product: l.fk_product,
      label: `${l.title} (${l.isbn})`,
      qty: l.qty_delivered - l.qty_returned,
      price_ht: l.price_ht,
      tva_rate: l.tva_rate
    }));
  if (!invLines.length) throw new ApiError(400, 'Rien a facturer (tout a ete retourne)');
  const inv = tx(() => {
    const created = createInvoice({
      type: 'facture', fk_client: c.fk_client, lines: invLines,
      source_type: 'depot-vente', source_id: c.id, note: 'Depot-vente ' + c.ref, userId: ctx.session.user.id
    });
    db.prepare('UPDATE consignments SET status = 2, fk_invoice = ? WHERE id = ?').run(created.id, c.id);
    return created;
  });
  return { ok: true, invoice: inv };
});

route('DELETE', '/api/consignments/:id', async (ctx) => {
  const c = db.prepare('SELECT * FROM consignments WHERE id = ?').get(Number(ctx.params.id));
  if (!c) throw new ApiError(404, 'Depot-vente introuvable');
  if (c.status !== 0) throw new ApiError(400, 'Seul un depot-vente en brouillon peut etre supprime');
  db.prepare('DELETE FROM consignments WHERE id = ?').run(c.id);
  return { ok: true };
});

module.exports = { getConsignment };
