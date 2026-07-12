'use strict';
/*
 * Achats : commandes fournisseurs (CF), receptions scannees contre commande (RC),
 * suggestions de reassort par fournisseur.
 */
const { db, tx, nextRef } = require('../lib/db');
const { route, ApiError } = require('../lib/web');
const { round2, stockMove, findByIsbn } = require('../lib/services');

/* ==================== Commandes fournisseurs ==================== */
function getPO(id) {
  const po = db.prepare(`SELECT po.*, s.name AS supplier_name, s.code AS supplier_code
    FROM purchase_orders po JOIN thirdparties s ON s.id = po.fk_supplier WHERE po.id = ?`).get(Number(id));
  if (!po) throw new ApiError(404, 'Commande fournisseur introuvable');
  po.lines = db.prepare(`SELECT l.*, p.isbn, p.title, p.author FROM purchase_order_lines l
    JOIN products p ON p.id = l.fk_product WHERE l.fk_po = ? ORDER BY l.position, l.id`).all(po.id);
  po.total_ht = round2(po.lines.reduce((s, l) => s + l.qty * l.buy_price_ht, 0));
  po.qty_total = po.lines.reduce((s, l) => s + l.qty, 0);
  po.qty_received = po.lines.reduce((s, l) => s + l.qty_received, 0);
  po.receptions = db.prepare('SELECT id, ref, status, date_creation FROM receptions WHERE fk_po = ? ORDER BY id DESC').all(po.id);
  return po;
}

route('GET', '/api/purchase-orders', async (ctx) => {
  const { status, supplier, q } = ctx.query;
  let sql = `SELECT po.*, s.name AS supplier_name,
      (SELECT COALESCE(SUM(qty),0) FROM purchase_order_lines WHERE fk_po = po.id) AS qty_total,
      (SELECT COALESCE(SUM(qty_received),0) FROM purchase_order_lines WHERE fk_po = po.id) AS qty_received,
      (SELECT COALESCE(SUM(qty*buy_price_ht),0) FROM purchase_order_lines WHERE fk_po = po.id) AS total_ht
    FROM purchase_orders po JOIN thirdparties s ON s.id = po.fk_supplier WHERE 1=1`;
  const args = [];
  if (status !== undefined && status !== '') { sql += ' AND po.status = ?'; args.push(Number(status)); }
  if (supplier) { sql += ' AND po.fk_supplier = ?'; args.push(Number(supplier)); }
  if (q) { sql += ' AND (po.ref LIKE ? OR s.name LIKE ?)'; args.push(`%${q}%`, `%${q}%`); }
  sql += ' ORDER BY po.id DESC LIMIT 300';
  return db.prepare(sql).all(...args);
});

route('GET', '/api/purchase-orders/:id', async (ctx) => getPO(ctx.params.id));

route('POST', '/api/purchase-orders', async (ctx) => {
  const supplier = db.prepare("SELECT id FROM thirdparties WHERE id = ? AND type = 'fournisseur'").get(Number(ctx.body.fk_supplier));
  if (!supplier) throw new ApiError(400, 'Fournisseur invalide');
  const ref = nextRef('CF');
  const r = db.prepare('INSERT INTO purchase_orders (ref, fk_supplier, note, fk_user_creat) VALUES (?,?,?,?)')
    .run(ref, supplier.id, ctx.body.note || null, ctx.session.user.id);
  const poId = Number(r.lastInsertRowid);
  // Lignes initiales optionnelles (utilisees par le reassort)
  if (Array.isArray(ctx.body.lines)) {
    const ins = db.prepare('INSERT INTO purchase_order_lines (fk_po, fk_product, qty, buy_price_ht, position) VALUES (?,?,?,?,?)');
    let pos = 0;
    for (const l of ctx.body.lines) {
      const p = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(l.fk_product));
      if (!p) continue;
      ins.run(poId, p.id, Math.max(1, Number(l.qty) || 1), l.buy_price_ht !== undefined ? Number(l.buy_price_ht) : p.buy_price_ht, ++pos);
    }
  }
  return { id: poId, ref };
});

function requirePODraft(id) {
  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(Number(id));
  if (!po) throw new ApiError(404, 'Commande fournisseur introuvable');
  if (po.status !== 0) throw new ApiError(400, 'Cette action necessite une commande fournisseur en brouillon');
  return po;
}

route('PUT', '/api/purchase-orders/:id', async (ctx) => {
  const po = requirePODraft(ctx.params.id);
  db.prepare('UPDATE purchase_orders SET note = ? WHERE id = ?').run(ctx.body.note ?? po.note, po.id);
  return { ok: true };
});

route('POST', '/api/purchase-orders/:id/lines', async (ctx) => {
  const po = requirePODraft(ctx.params.id);
  const b = ctx.body;
  let product = null;
  if (b.fk_product) product = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(b.fk_product));
  else if (b.isbn) product = findByIsbn(b.isbn);
  if (!product) throw new ApiError(404, 'Livre introuvable');
  const qty = Math.max(1, Number(b.qty) || 1);
  const price = b.buy_price_ht !== undefined && b.buy_price_ht !== '' ? Number(b.buy_price_ht) : product.buy_price_ht;
  const existing = db.prepare('SELECT * FROM purchase_order_lines WHERE fk_po = ? AND fk_product = ?').get(po.id, product.id);
  if (existing) db.prepare('UPDATE purchase_order_lines SET qty = qty + ? WHERE id = ?').run(qty, existing.id);
  else {
    const pos = db.prepare('SELECT COALESCE(MAX(position),0)+1 AS p FROM purchase_order_lines WHERE fk_po = ?').get(po.id).p;
    db.prepare('INSERT INTO purchase_order_lines (fk_po, fk_product, qty, buy_price_ht, position) VALUES (?,?,?,?,?)')
      .run(po.id, product.id, qty, price, pos);
  }
  return { ok: true };
});

route('PUT', '/api/purchase-orders/:id/lines/:lineId', async (ctx) => {
  const po = requirePODraft(ctx.params.id);
  const l = db.prepare('SELECT * FROM purchase_order_lines WHERE id = ? AND fk_po = ?').get(Number(ctx.params.lineId), po.id);
  if (!l) throw new ApiError(404, 'Ligne introuvable');
  const qty = ctx.body.qty !== undefined ? Number(ctx.body.qty) : l.qty;
  if (qty <= 0) throw new ApiError(400, 'La quantite doit etre superieure a zero');
  db.prepare('UPDATE purchase_order_lines SET qty = ?, buy_price_ht = ? WHERE id = ?')
    .run(qty, ctx.body.buy_price_ht !== undefined ? Number(ctx.body.buy_price_ht) : l.buy_price_ht, l.id);
  return { ok: true };
});

route('DELETE', '/api/purchase-orders/:id/lines/:lineId', async (ctx) => {
  const po = requirePODraft(ctx.params.id);
  db.prepare('DELETE FROM purchase_order_lines WHERE id = ? AND fk_po = ?').run(Number(ctx.params.lineId), po.id);
  return { ok: true };
});

route('POST', '/api/purchase-orders/:id/validate', async (ctx) => {
  const po = requirePODraft(ctx.params.id);
  const n = db.prepare('SELECT COUNT(*) AS n FROM purchase_order_lines WHERE fk_po = ?').get(po.id).n;
  if (!n) throw new ApiError(400, 'La commande ne contient aucune ligne');
  db.prepare('UPDATE purchase_orders SET status = 1 WHERE id = ?').run(po.id);
  return { ok: true };
});

route('POST', '/api/purchase-orders/:id/cancel', async (ctx) => {
  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(Number(ctx.params.id));
  if (!po) throw new ApiError(404, 'Commande fournisseur introuvable');
  if (po.status >= 2) throw new ApiError(400, 'Une commande deja recue ne peut plus etre annulee');
  db.prepare('UPDATE purchase_orders SET status = -1 WHERE id = ?').run(po.id);
  return { ok: true };
});

route('DELETE', '/api/purchase-orders/:id', async (ctx) => {
  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(Number(ctx.params.id));
  if (!po) throw new ApiError(404, 'Commande fournisseur introuvable');
  if (po.status !== 0 && po.status !== -1) throw new ApiError(400, 'Seule une commande en brouillon ou annulee peut etre supprimee');
  const used = db.prepare('SELECT COUNT(*) AS n FROM receptions WHERE fk_po = ?').get(po.id).n;
  if (used) throw new ApiError(400, 'Des receptions sont liees a cette commande');
  db.prepare('DELETE FROM purchase_orders WHERE id = ?').run(po.id);
  return { ok: true };
});

/* ==================== Receptions ==================== */
function getReception(id) {
  const rc = db.prepare(`SELECT r.*, s.name AS supplier_name, po.ref AS po_ref
    FROM receptions r JOIN thirdparties s ON s.id = r.fk_supplier
    LEFT JOIN purchase_orders po ON po.id = r.fk_po WHERE r.id = ?`).get(Number(id));
  if (!rc) throw new ApiError(404, 'Reception introuvable');
  rc.lines = db.prepare(`SELECT l.*, p.isbn, p.title, p.author FROM reception_lines l
    JOIN products p ON p.id = l.fk_product WHERE l.fk_reception = ? ORDER BY l.id DESC`).all(rc.id);
  rc.qty_total = rc.lines.reduce((s, l) => s + l.qty, 0);
  // Comparaison avec la commande fournisseur : commande / deja recu (autres receptions) / cette reception
  if (rc.fk_po) {
    const poLines = db.prepare(`SELECT l.fk_product, l.qty, l.qty_received, p.isbn, p.title
      FROM purchase_order_lines l JOIN products p ON p.id = l.fk_product WHERE l.fk_po = ?`).all(rc.fk_po);
    const here = {};
    for (const l of rc.lines) here[l.fk_product] = (here[l.fk_product] || 0) + l.qty;
    rc.po_compare = poLines.map((pl) => ({
      fk_product: pl.fk_product, isbn: pl.isbn, title: pl.title,
      qty_ordered: pl.qty,
      qty_received_before: pl.qty_received,
      qty_this: here[pl.fk_product] || 0,
      ecart: round2((pl.qty_received + (rc.status === 0 ? (here[pl.fk_product] || 0) : 0)) - pl.qty)
    }));
    // Livres scannes hors commande
    const poProducts = new Set(poLines.map((l) => l.fk_product));
    rc.hors_commande = rc.lines.filter((l) => !poProducts.has(l.fk_product));
  }
  return rc;
}

route('GET', '/api/receptions', async (ctx) => {
  const { status, q } = ctx.query;
  let sql = `SELECT r.*, s.name AS supplier_name, po.ref AS po_ref,
      (SELECT COALESCE(SUM(qty),0) FROM reception_lines WHERE fk_reception = r.id) AS qty_total,
      (SELECT COUNT(*) FROM reception_lines WHERE fk_reception = r.id) AS nb_lines
    FROM receptions r JOIN thirdparties s ON s.id = r.fk_supplier
    LEFT JOIN purchase_orders po ON po.id = r.fk_po WHERE 1=1`;
  const args = [];
  if (status !== undefined && status !== '') { sql += ' AND r.status = ?'; args.push(Number(status)); }
  if (q) { sql += ' AND (r.ref LIKE ? OR s.name LIKE ?)'; args.push(`%${q}%`, `%${q}%`); }
  sql += ' ORDER BY r.id DESC LIMIT 300';
  return db.prepare(sql).all(...args);
});

route('GET', '/api/receptions/:id', async (ctx) => getReception(ctx.params.id));

route('POST', '/api/receptions', async (ctx) => {
  const b = ctx.body;
  let supplierId, poId = null;
  if (b.fk_po) {
    const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND status IN (1,2)').get(Number(b.fk_po));
    if (!po) throw new ApiError(400, 'Commande fournisseur invalide (elle doit etre validee et non totalement recue)');
    supplierId = po.fk_supplier;
    poId = po.id;
  } else {
    const supplier = db.prepare("SELECT id FROM thirdparties WHERE id = ? AND type = 'fournisseur'").get(Number(b.fk_supplier));
    if (!supplier) throw new ApiError(400, 'Fournisseur invalide');
    supplierId = supplier.id;
  }
  const ref = nextRef('RC');
  const r = db.prepare('INSERT INTO receptions (ref, fk_supplier, fk_po, note, fk_user_creat) VALUES (?,?,?,?,?)')
    .run(ref, supplierId, poId, b.note || null, ctx.session.user.id);
  return { id: Number(r.lastInsertRowid), ref };
});

function requireRcOpen(id) {
  const rc = db.prepare('SELECT * FROM receptions WHERE id = ?').get(Number(id));
  if (!rc) throw new ApiError(404, 'Reception introuvable');
  if (rc.status !== 0) throw new ApiError(400, 'Cette reception est deja validee');
  return rc;
}

/* Scan d'un livre a la reception. */
route('POST', '/api/receptions/:id/scan', async (ctx) => {
  const rc = requireRcOpen(ctx.params.id);
  const p = findByIsbn(ctx.body.isbn);
  if (!p) throw new ApiError(404, `Livre introuvable pour l'ISBN "${ctx.body.isbn}" — creez-le d'abord au catalogue`);
  const qty = Math.max(1, Number(ctx.body.qty) || 1);
  const existing = db.prepare('SELECT * FROM reception_lines WHERE fk_reception = ? AND fk_product = ?').get(rc.id, p.id);
  if (existing) db.prepare('UPDATE reception_lines SET qty = qty + ? WHERE id = ?').run(qty, existing.id);
  else db.prepare('INSERT INTO reception_lines (fk_reception, fk_product, qty, buy_price_ht) VALUES (?,?,?,?)')
    .run(rc.id, p.id, qty, ctx.body.buy_price_ht !== undefined && ctx.body.buy_price_ht !== '' ? Number(ctx.body.buy_price_ht) : null);

  // Info commande pour le retour visuel
  let ordered = null;
  if (rc.fk_po) {
    const pl = db.prepare('SELECT qty, qty_received FROM purchase_order_lines WHERE fk_po = ? AND fk_product = ?').get(rc.fk_po, p.id);
    const here = db.prepare('SELECT COALESCE(SUM(qty),0) AS s FROM reception_lines WHERE fk_reception = ? AND fk_product = ?').get(rc.id, p.id).s;
    ordered = pl ? { qty_ordered: pl.qty, qty_received: pl.qty_received + here, hors_commande: false }
      : { hors_commande: true };
  }
  return { ok: true, product: { id: p.id, title: p.title, isbn: p.isbn }, qty, ordered };
});

route('PUT', '/api/receptions/:id/lines/:lineId', async (ctx) => {
  const rc = requireRcOpen(ctx.params.id);
  const l = db.prepare('SELECT * FROM reception_lines WHERE id = ? AND fk_reception = ?').get(Number(ctx.params.lineId), rc.id);
  if (!l) throw new ApiError(404, 'Ligne introuvable');
  const qty = ctx.body.qty !== undefined ? Number(ctx.body.qty) : l.qty;
  if (qty <= 0) throw new ApiError(400, 'La quantite doit etre superieure a zero');
  db.prepare('UPDATE reception_lines SET qty = ?, buy_price_ht = ? WHERE id = ?')
    .run(qty, ctx.body.buy_price_ht !== undefined && ctx.body.buy_price_ht !== '' ? Number(ctx.body.buy_price_ht) : l.buy_price_ht, l.id);
  return { ok: true };
});

route('DELETE', '/api/receptions/:id/lines/:lineId', async (ctx) => {
  const rc = requireRcOpen(ctx.params.id);
  db.prepare('DELETE FROM reception_lines WHERE id = ? AND fk_reception = ?').run(Number(ctx.params.lineId), rc.id);
  return { ok: true };
});

/*
 * Validation : entree en stock principal, mise a jour du prix d'achat,
 * imputation sur la commande fournisseur (qty_received + statut).
 */
route('POST', '/api/receptions/:id/validate', async (ctx) => {
  const rc = requireRcOpen(ctx.params.id);
  const lines = db.prepare('SELECT * FROM reception_lines WHERE fk_reception = ?').all(rc.id);
  if (!lines.length) throw new ApiError(400, "Aucun livre n'a ete scanne");
  tx(() => {
    for (const l of lines) {
      stockMove(l.fk_product, 'main', l.qty, 'Reception ' + rc.ref, rc.ref, ctx.session.user.id);
      // Prix d'achat : celui saisi au scan, sinon celui de la ligne de commande fournisseur
      let newPrice = l.buy_price_ht;
      if ((newPrice === null || newPrice === undefined) && rc.fk_po) {
        const pl = db.prepare('SELECT buy_price_ht FROM purchase_order_lines WHERE fk_po = ? AND fk_product = ?').get(rc.fk_po, l.fk_product);
        if (pl) newPrice = pl.buy_price_ht;
      }
      if (newPrice !== null && newPrice !== undefined) {
        db.prepare('UPDATE products SET buy_price_ht = ? WHERE id = ?').run(newPrice, l.fk_product);
      }
      if (rc.fk_po) {
        db.prepare('UPDATE purchase_order_lines SET qty_received = qty_received + ? WHERE fk_po = ? AND fk_product = ?')
          .run(l.qty, rc.fk_po, l.fk_product);
      }
    }
    if (rc.fk_po) {
      const t = db.prepare('SELECT COALESCE(SUM(qty),0) AS q, COALESCE(SUM(qty_received),0) AS r FROM purchase_order_lines WHERE fk_po = ?').get(rc.fk_po);
      db.prepare('UPDATE purchase_orders SET status = ? WHERE id = ?').run(t.r >= t.q ? 3 : 2, rc.fk_po);
    }
    db.prepare('UPDATE receptions SET status = 1 WHERE id = ?').run(rc.id);
  });
  return { ok: true };
});

route('DELETE', '/api/receptions/:id', async (ctx) => {
  const rc = db.prepare('SELECT * FROM receptions WHERE id = ?').get(Number(ctx.params.id));
  if (!rc) throw new ApiError(404, 'Reception introuvable');
  if (rc.status !== 0) throw new ApiError(400, 'Une reception validee ne peut pas etre supprimee');
  db.prepare('DELETE FROM receptions WHERE id = ?').run(rc.id);
  return { ok: true };
});

/* ==================== Reassort ==================== */
/* Livres sous le seuil de stock mini, groupes par fournisseur, avec quantite suggeree. */
route('GET', '/api/purchasing/restock', async () => {
  const rows = db.prepare(`SELECT p.id, p.isbn, p.title, p.stock_main, p.stock_min, p.buy_price_ht,
      p.fk_supplier, s.name AS supplier_name,
      COALESCE((SELECT SUM(l.qty - l.qty_received) FROM purchase_order_lines l
        JOIN purchase_orders po ON po.id = l.fk_po
        WHERE l.fk_product = p.id AND po.status IN (1,2)), 0) AS qty_on_order
    FROM products p LEFT JOIN thirdparties s ON s.id = p.fk_supplier
    WHERE p.active = 1 AND p.stock_min > 0 AND p.stock_main <= p.stock_min
    ORDER BY s.name, p.title`).all();
  const suggestions = rows
    .map((r) => ({ ...r, qty_suggested: Math.max(0, Math.round(r.stock_min * 2 - r.stock_main - r.qty_on_order)) }))
    .filter((r) => r.qty_suggested > 0);
  const bySupplier = {};
  for (const r of suggestions) {
    const key = r.fk_supplier || 0;
    if (!bySupplier[key]) bySupplier[key] = { fk_supplier: r.fk_supplier, supplier_name: r.supplier_name || 'Sans fournisseur', products: [] };
    bySupplier[key].products.push(r);
  }
  return Object.values(bySupplier);
});

module.exports = { getPO, getReception };
