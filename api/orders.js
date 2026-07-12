'use strict';
/* Commandes clients : cycle brouillon -> validee -> preparation (picking scanne) -> expediee -> facturee. */
const { db, tx, nextRef } = require('../lib/db');
const { route, ApiError } = require('../lib/web');
const { round2, createInvoice, stockMove, gisementMove, findByIsbn } = require('../lib/services');

const ORDER_TYPES = ['a-dispo', 'prioritaire', 'par-nos-soins', 'mise-au-banc', 'livraison', 'proforma'];

function orderTotals(orderId) {
  const r = db.prepare(`SELECT COALESCE(SUM(qty * price_ht * (1 - discount_pct/100.0)),0) AS ht,
      COALESCE(SUM(qty),0) AS qty, COALESCE(SUM(qty_picked),0) AS picked
    FROM order_lines WHERE fk_order = ?`).get(orderId);
  return { total_ht: round2(r.ht), qty_total: r.qty, qty_picked: r.picked };
}

function getOrder(id) {
  const o = db.prepare(`SELECT o.*, c.name AS client_name, c.code AS client_code, c.town AS client_town,
      i.ref AS invoice_ref
    FROM orders o JOIN thirdparties c ON c.id = o.fk_client
    LEFT JOIN invoices i ON i.id = o.fk_invoice WHERE o.id = ?`).get(Number(id));
  if (!o) throw new ApiError(404, 'Commande introuvable');
  o.lines = db.prepare(`SELECT l.*, p.isbn, p.title, p.author, p.tva_rate,
      (SELECT GROUP_CONCAT(g.code || ' (' || CAST(pg.qty AS INTEGER) || ')', ', ')
       FROM product_gisement pg JOIN gisements g ON g.id = pg.gisement_id
       WHERE pg.product_id = l.fk_product AND pg.qty > 0) AS locations
    FROM order_lines l JOIN products p ON p.id = l.fk_product
    WHERE l.fk_order = ? ORDER BY l.position, l.id`).all(Number(id));
  Object.assign(o, orderTotals(o.id));
  return o;
}

route('GET', '/api/orders', async (ctx) => {
  const { status, client, q } = ctx.query;
  let sql = `SELECT o.*, c.name AS client_name,
      (SELECT COALESCE(SUM(qty * price_ht * (1 - discount_pct/100.0)),0) FROM order_lines WHERE fk_order = o.id) AS total_ht,
      (SELECT COALESCE(SUM(qty),0) FROM order_lines WHERE fk_order = o.id) AS qty_total,
      (SELECT COALESCE(SUM(qty_picked),0) FROM order_lines WHERE fk_order = o.id) AS qty_picked
    FROM orders o JOIN thirdparties c ON c.id = o.fk_client WHERE 1=1`;
  const args = [];
  if (status !== undefined && status !== '') { sql += ' AND o.status = ?'; args.push(Number(status)); }
  if (client) { sql += ' AND o.fk_client = ?'; args.push(Number(client)); }
  if (q) { sql += ' AND (o.ref LIKE ? OR c.name LIKE ?)'; args.push(`%${q}%`, `%${q}%`); }
  sql += ' ORDER BY o.id DESC LIMIT 300';
  return db.prepare(sql).all(...args);
});

/* File de preparation : commandes validees + en preparation, triees par priorite. */
route('GET', '/api/warehouse/queue', async (ctx) => {
  return db.prepare(`SELECT o.*, c.name AS client_name, c.town AS client_town,
      (SELECT COALESCE(SUM(qty),0) FROM order_lines WHERE fk_order = o.id) AS qty_total,
      (SELECT COALESCE(SUM(qty_picked),0) FROM order_lines WHERE fk_order = o.id) AS qty_picked,
      (SELECT COUNT(*) FROM order_lines WHERE fk_order = o.id) AS nb_lines
    FROM orders o JOIN thirdparties c ON c.id = o.fk_client
    WHERE o.status IN (1, 2)
    ORDER BY o.status DESC, o.priority ASC, o.id ASC`).all();
});

route('GET', '/api/orders/:id', async (ctx) => getOrder(ctx.params.id));

route('POST', '/api/orders', async (ctx) => {
  const b = ctx.body;
  const client = db.prepare("SELECT id FROM thirdparties WHERE id = ? AND type = 'client'").get(Number(b.fk_client));
  if (!client) throw new ApiError(400, 'Client invalide');
  const type = ORDER_TYPES.includes(b.order_type) ? b.order_type : 'livraison';
  const ref = nextRef('CO');
  const r = db.prepare(`INSERT INTO orders (ref, fk_client, order_type, priority, status, note, fk_user_creat)
    VALUES (?,?,?,?,0,?,?)`)
    .run(ref, client.id, type, Math.min(9, Math.max(1, Number(b.priority) || 5)), b.note || null, ctx.session.user.id);
  return { id: Number(r.lastInsertRowid), ref };
});

function requireDraft(id) {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(id));
  if (!o) throw new ApiError(404, 'Commande introuvable');
  if (o.status !== 0) throw new ApiError(400, 'Cette action necessite une commande en brouillon');
  return o;
}

route('PUT', '/api/orders/:id', async (ctx) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(ctx.params.id));
  if (!o) throw new ApiError(404, 'Commande introuvable');
  const b = ctx.body;
  if (o.status !== 0 && (b.fk_client !== undefined)) throw new ApiError(400, 'Le client ne peut plus etre modifie');
  db.prepare('UPDATE orders SET fk_client = ?, order_type = ?, priority = ?, note = ? WHERE id = ?')
    .run(b.fk_client !== undefined && o.status === 0 ? Number(b.fk_client) : o.fk_client,
      ORDER_TYPES.includes(b.order_type) ? b.order_type : o.order_type,
      b.priority !== undefined ? Math.min(9, Math.max(1, Number(b.priority))) : o.priority,
      b.note ?? o.note, o.id);
  return { ok: true };
});

route('POST', '/api/orders/:id/lines', async (ctx) => {
  const o = requireDraft(ctx.params.id);
  const b = ctx.body;
  let product = null;
  if (b.fk_product) product = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(b.fk_product));
  else if (b.isbn) product = findByIsbn(b.isbn);
  if (!product) throw new ApiError(404, 'Livre introuvable');
  const qty = Math.max(1, Number(b.qty) || 1);
  const price = b.price_ht !== undefined && b.price_ht !== '' ? Number(b.price_ht) : product.price_ht;
  const existing = db.prepare('SELECT * FROM order_lines WHERE fk_order = ? AND fk_product = ?').get(o.id, product.id);
  if (existing) {
    db.prepare('UPDATE order_lines SET qty = qty + ? WHERE id = ?').run(qty, existing.id);
  } else {
    const pos = db.prepare('SELECT COALESCE(MAX(position),0)+1 AS p FROM order_lines WHERE fk_order = ?').get(o.id).p;
    db.prepare('INSERT INTO order_lines (fk_order, fk_product, qty, price_ht, discount_pct, position) VALUES (?,?,?,?,?,?)')
      .run(o.id, product.id, qty, price, Number(b.discount_pct) || 0, pos);
  }
  return { ok: true };
});

route('PUT', '/api/orders/:id/lines/:lineId', async (ctx) => {
  const o = requireDraft(ctx.params.id);
  const l = db.prepare('SELECT * FROM order_lines WHERE id = ? AND fk_order = ?').get(Number(ctx.params.lineId), o.id);
  if (!l) throw new ApiError(404, 'Ligne introuvable');
  const b = ctx.body;
  const qty = b.qty !== undefined ? Number(b.qty) : l.qty;
  if (qty <= 0) throw new ApiError(400, 'La quantite doit etre superieure a zero');
  db.prepare('UPDATE order_lines SET qty = ?, price_ht = ?, discount_pct = ? WHERE id = ?')
    .run(qty, b.price_ht !== undefined ? Number(b.price_ht) : l.price_ht,
      b.discount_pct !== undefined ? Number(b.discount_pct) : l.discount_pct, l.id);
  return { ok: true };
});

route('DELETE', '/api/orders/:id/lines/:lineId', async (ctx) => {
  const o = requireDraft(ctx.params.id);
  db.prepare('DELETE FROM order_lines WHERE id = ? AND fk_order = ?').run(Number(ctx.params.lineId), o.id);
  return { ok: true };
});

route('POST', '/api/orders/:id/validate', async (ctx) => {
  const o = requireDraft(ctx.params.id);
  const n = db.prepare('SELECT COUNT(*) AS n FROM order_lines WHERE fk_order = ?').get(o.id).n;
  if (!n) throw new ApiError(400, 'La commande ne contient aucune ligne');
  db.prepare('UPDATE orders SET status = 1 WHERE id = ?').run(o.id);
  return { ok: true };
});

route('POST', '/api/orders/:id/start-picking', async (ctx) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(ctx.params.id));
  if (!o) throw new ApiError(404, 'Commande introuvable');
  if (o.status !== 1) throw new ApiError(400, 'Seule une commande validee peut passer en preparation');
  db.prepare('UPDATE orders SET status = 2 WHERE id = ?').run(o.id);
  return { ok: true };
});

/* Scan de picking : gisement + ISBN -> decompte stock principal et gisement, incremente qty_picked. */
route('POST', '/api/orders/:id/pick', async (ctx) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(ctx.params.id));
  if (!o) throw new ApiError(404, 'Commande introuvable');
  if (o.status !== 2) throw new ApiError(400, "La commande n'est pas en preparation");
  const { isbn, gisement_code, qty } = ctx.body;
  const p = findByIsbn(isbn);
  if (!p) throw new ApiError(404, `Livre introuvable pour l'ISBN "${isbn}"`);
  const line = db.prepare('SELECT * FROM order_lines WHERE fk_order = ? AND fk_product = ?').get(o.id, p.id);
  if (!line) throw new ApiError(400, `Ce livre (${p.title}) ne fait pas partie de cette commande`);
  const remaining = line.qty - line.qty_picked;
  if (remaining <= 0) throw new ApiError(400, `La ligne pour ${p.title} est deja entierement preparee`);
  const n = Math.min(remaining, Math.max(1, Number(qty) || 1));

  let g = null;
  if (gisement_code) {
    g = db.prepare('SELECT * FROM gisements WHERE UPPER(code) = UPPER(?)').get(String(gisement_code).trim());
    if (!g) throw new ApiError(404, `Gisement introuvable pour le code "${gisement_code}"`);
    const pg = db.prepare('SELECT qty FROM product_gisement WHERE product_id = ? AND gisement_id = ?').get(p.id, g.id);
    if (!pg || pg.qty < n) throw new ApiError(400, `Le livre ${p.title} n'est pas disponible en quantite suffisante dans le gisement ${g.code}`);
  }

  const result = tx(() => {
    stockMove(p.id, 'main', -n, 'Picking commande ' + o.ref, o.ref, ctx.session.user.id);
    if (g) gisementMove(p.id, g.id, -n);
    db.prepare('UPDATE order_lines SET qty_picked = qty_picked + ? WHERE id = ?').run(n, line.id);
    const t = orderTotals(o.id);
    let done = false;
    if (t.qty_picked >= t.qty_total) {
      db.prepare('UPDATE orders SET status = 3 WHERE id = ?').run(o.id);
      done = true;
    }
    return { done, picked: t.qty_picked, total: t.qty_total };
  });
  return { ok: true, product: { id: p.id, title: p.title }, qty: n, ...result };
});

/* Cloture manuelle de la preparation (reliquats non servis). */
route('POST', '/api/orders/:id/close-picking', async (ctx) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(ctx.params.id));
  if (!o) throw new ApiError(404, 'Commande introuvable');
  if (o.status !== 2) throw new ApiError(400, "La commande n'est pas en preparation");
  db.prepare('UPDATE orders SET status = 3 WHERE id = ?').run(o.id);
  return { ok: true };
});

route('POST', '/api/orders/:id/ship', async (ctx) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(ctx.params.id));
  if (!o) throw new ApiError(404, 'Commande introuvable');
  if (o.status !== 3) throw new ApiError(400, 'Seule une commande preparee peut etre expediee');
  db.prepare("UPDATE orders SET status = 4, date_shipped = date('now') WHERE id = ?").run(o.id);
  return { ok: true };
});

/* Facturation : quantites reellement preparees (ou commandees si preparation non passee par le picking). */
route('POST', '/api/orders/:id/invoice', async (ctx) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(ctx.params.id));
  if (!o) throw new ApiError(404, 'Commande introuvable');
  if (o.fk_invoice) throw new ApiError(400, 'Une facture a deja ete generee pour cette commande');
  if (![3, 4].includes(o.status)) throw new ApiError(400, 'La commande doit etre preparee ou expediee pour etre facturee');
  const lines = db.prepare(`SELECT l.*, p.title, p.isbn, p.tva_rate FROM order_lines l
    JOIN products p ON p.id = l.fk_product WHERE l.fk_order = ?`).all(o.id);
  const invLines = lines
    .map((l) => ({
      fk_product: l.fk_product,
      label: `${l.title} (${l.isbn})`,
      qty: l.qty_picked > 0 ? l.qty_picked : l.qty,
      price_ht: round2(l.price_ht * (1 - l.discount_pct / 100)),
      tva_rate: l.tva_rate
    }))
    .filter((l) => l.qty > 0);
  const inv = tx(() => {
    const created = createInvoice({
      type: 'facture', fk_client: o.fk_client, lines: invLines,
      source_type: 'commande', source_id: o.id, note: 'Commande ' + o.ref, userId: ctx.session.user.id
    });
    db.prepare('UPDATE orders SET status = 5, fk_invoice = ? WHERE id = ?').run(created.id, o.id);
    return created;
  });
  return { ok: true, invoice: inv };
});

route('POST', '/api/orders/:id/cancel', async (ctx) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(ctx.params.id));
  if (!o) throw new ApiError(404, 'Commande introuvable');
  if (o.status >= 4) throw new ApiError(400, 'Une commande expediee ou facturee ne peut plus etre annulee');
  const picked = db.prepare('SELECT COALESCE(SUM(qty_picked),0) AS s FROM order_lines WHERE fk_order = ?').get(o.id).s;
  if (picked > 0) throw new ApiError(400, 'Des articles ont deja ete preleves : terminez la preparation ou reintegrez le stock');
  db.prepare('UPDATE orders SET status = -1 WHERE id = ?').run(o.id);
  return { ok: true };
});

route('DELETE', '/api/orders/:id', async (ctx) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(ctx.params.id));
  if (!o) throw new ApiError(404, 'Commande introuvable');
  if (o.status !== 0 && o.status !== -1) throw new ApiError(400, 'Seule une commande en brouillon ou annulee peut etre supprimee');
  db.prepare('DELETE FROM orders WHERE id = ?').run(o.id);
  return { ok: true };
});

module.exports = { getOrder };
