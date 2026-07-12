'use strict';
/*
 * Inventaires par gisement : comptage scanne, ecarts theorique/compte,
 * validation avec ajustement des emplacements et du stock principal.
 */
const { db, tx, nextRef } = require('../lib/db');
const { route, ApiError } = require('../lib/web');
const { round2, findByIsbn } = require('../lib/services');

function getInventory(id) {
  const inv = db.prepare(`SELECT i.*, g.code AS gisement_code, g.etage FROM inventories i
    JOIN gisements g ON g.id = i.fk_gisement WHERE i.id = ?`).get(Number(id));
  if (!inv) throw new ApiError(404, 'Inventaire introuvable');
  inv.lines = db.prepare(`SELECT l.*, p.isbn, p.title, p.author FROM inventory_lines l
    JOIN products p ON p.id = l.fk_product WHERE l.fk_inventory = ? ORDER BY l.id DESC`).all(inv.id);
  // Livres presents en theorie dans le gisement mais pas encore comptes
  if (inv.status === 0) {
    inv.not_counted = db.prepare(`SELECT p.id AS fk_product, p.isbn, p.title, pg.qty AS qty_theoretical
      FROM product_gisement pg JOIN products p ON p.id = pg.product_id
      WHERE pg.gisement_id = ? AND pg.qty > 0
        AND p.id NOT IN (SELECT fk_product FROM inventory_lines WHERE fk_inventory = ?)
      ORDER BY p.title`).all(inv.fk_gisement, inv.id);
  }
  inv.ecart_total = round2(inv.lines.reduce((s, l) => s + (l.qty_counted - l.qty_theoretical), 0));
  return inv;
}

route('GET', '/api/inventories', async (ctx) => {
  const { status } = ctx.query;
  let sql = `SELECT i.*, g.code AS gisement_code,
      (SELECT COUNT(*) FROM inventory_lines WHERE fk_inventory = i.id) AS nb_lines,
      (SELECT COALESCE(SUM(qty_counted - qty_theoretical),0) FROM inventory_lines WHERE fk_inventory = i.id) AS ecart
    FROM inventories i JOIN gisements g ON g.id = i.fk_gisement WHERE 1=1`;
  const args = [];
  if (status !== undefined && status !== '') { sql += ' AND i.status = ?'; args.push(Number(status)); }
  sql += ' ORDER BY i.id DESC LIMIT 200';
  return db.prepare(sql).all(...args);
});

route('GET', '/api/inventories/:id', async (ctx) => getInventory(ctx.params.id));

route('POST', '/api/inventories', async (ctx) => {
  const g = db.prepare('SELECT * FROM gisements WHERE id = ?').get(Number(ctx.body.fk_gisement));
  if (!g) throw new ApiError(404, 'Gisement introuvable');
  const open = db.prepare('SELECT id FROM inventories WHERE fk_gisement = ? AND status = 0').get(g.id);
  if (open) throw new ApiError(400, `Un inventaire est deja en cours sur ${g.code}`);
  const ref = nextRef('INV');
  const r = db.prepare('INSERT INTO inventories (ref, fk_gisement, note, fk_user_creat) VALUES (?,?,?,?)')
    .run(ref, g.id, ctx.body.note || null, ctx.session.user.id);
  return { id: Number(r.lastInsertRowid), ref };
});

function requireOpen(id) {
  const inv = db.prepare('SELECT * FROM inventories WHERE id = ?').get(Number(id));
  if (!inv) throw new ApiError(404, 'Inventaire introuvable');
  if (inv.status !== 0) throw new ApiError(400, 'Cet inventaire est deja valide');
  return inv;
}

/* Scan de comptage : chaque scan ajoute qty au compte du livre (theorique fige au premier scan). */
route('POST', '/api/inventories/:id/scan', async (ctx) => {
  const inv = requireOpen(ctx.params.id);
  const p = findByIsbn(ctx.body.isbn);
  if (!p) throw new ApiError(404, `Livre introuvable pour l'ISBN "${ctx.body.isbn}"`);
  const qty = Math.max(1, Number(ctx.body.qty) || 1);
  const existing = db.prepare('SELECT * FROM inventory_lines WHERE fk_inventory = ? AND fk_product = ?').get(inv.id, p.id);
  let counted;
  if (existing) {
    db.prepare('UPDATE inventory_lines SET qty_counted = qty_counted + ? WHERE id = ?').run(qty, existing.id);
    counted = existing.qty_counted + qty;
  } else {
    const pg = db.prepare('SELECT qty FROM product_gisement WHERE product_id = ? AND gisement_id = ?').get(p.id, inv.fk_gisement);
    db.prepare('INSERT INTO inventory_lines (fk_inventory, fk_product, qty_counted, qty_theoretical) VALUES (?,?,?,?)')
      .run(inv.id, p.id, qty, pg ? pg.qty : 0);
    counted = qty;
  }
  const line = db.prepare('SELECT * FROM inventory_lines WHERE fk_inventory = ? AND fk_product = ?').get(inv.id, p.id);
  return { ok: true, product: { id: p.id, title: p.title }, qty_counted: counted, qty_theoretical: line.qty_theoretical };
});

route('PUT', '/api/inventories/:id/lines/:lineId', async (ctx) => {
  const inv = requireOpen(ctx.params.id);
  const l = db.prepare('SELECT * FROM inventory_lines WHERE id = ? AND fk_inventory = ?').get(Number(ctx.params.lineId), inv.id);
  if (!l) throw new ApiError(404, 'Ligne introuvable');
  const qty = Number(ctx.body.qty_counted);
  if (isNaN(qty) || qty < 0) throw new ApiError(400, 'Quantite invalide');
  db.prepare('UPDATE inventory_lines SET qty_counted = ? WHERE id = ?').run(qty, l.id);
  return { ok: true };
});

route('DELETE', '/api/inventories/:id/lines/:lineId', async (ctx) => {
  const inv = requireOpen(ctx.params.id);
  db.prepare('DELETE FROM inventory_lines WHERE id = ? AND fk_inventory = ?').run(Number(ctx.params.lineId), inv.id);
  return { ok: true };
});

/* Ajoute a zero tous les livres theoriquement presents non comptes (avant validation). */
route('POST', '/api/inventories/:id/add-missing', async (ctx) => {
  const inv = requireOpen(ctx.params.id);
  const r = db.prepare(`INSERT INTO inventory_lines (fk_inventory, fk_product, qty_counted, qty_theoretical)
    SELECT ?, pg.product_id, 0, pg.qty FROM product_gisement pg
    WHERE pg.gisement_id = ? AND pg.qty > 0
      AND pg.product_id NOT IN (SELECT fk_product FROM inventory_lines WHERE fk_inventory = ?)`)
    .run(inv.id, inv.fk_gisement, inv.id);
  return { ok: true, added: Number(r.changes) };
});

/*
 * Validation : pour chaque ligne, l'emplacement passe a la quantite comptee et
 * le stock principal est ajuste de l'ecart (mouvement trace "Ajustement inventaire").
 */
route('POST', '/api/inventories/:id/validate', async (ctx) => {
  const inv = requireOpen(ctx.params.id);
  const lines = db.prepare('SELECT * FROM inventory_lines WHERE fk_inventory = ?').all(inv.id);
  if (!lines.length) throw new ApiError(400, 'Aucun comptage saisi');
  const g = db.prepare('SELECT code FROM gisements WHERE id = ?').get(inv.fk_gisement);
  tx(() => {
    for (const l of lines) {
      const delta = l.qty_counted - l.qty_theoretical;
      // Emplacement : quantite comptee
      db.prepare('DELETE FROM product_gisement WHERE product_id = ? AND gisement_id = ?').run(l.fk_product, inv.fk_gisement);
      if (l.qty_counted > 0) {
        db.prepare('INSERT INTO product_gisement (product_id, gisement_id, qty) VALUES (?,?,?)')
          .run(l.fk_product, inv.fk_gisement, l.qty_counted);
      }
      if (delta !== 0) {
        // Ajustement du stock principal (peut passer sous les autres gisements : trace comptable de l'ecart)
        db.prepare('UPDATE products SET stock_main = MAX(0, stock_main + ?) WHERE id = ?').run(delta, l.fk_product);
        db.prepare('INSERT INTO stock_movements (fk_product, warehouse, qty, label, ref_doc, fk_user) VALUES (?,?,?,?,?,?)')
          .run(l.fk_product, 'main', delta, `Ajustement inventaire ${inv.ref} (${g.code})`, inv.ref, ctx.session.user.id);
      }
    }
    db.prepare('UPDATE inventories SET status = 1 WHERE id = ?').run(inv.id);
  });
  return { ok: true };
});

route('DELETE', '/api/inventories/:id', async (ctx) => {
  const inv = db.prepare('SELECT * FROM inventories WHERE id = ?').get(Number(ctx.params.id));
  if (!inv) throw new ApiError(404, 'Inventaire introuvable');
  if (inv.status !== 0) throw new ApiError(400, 'Un inventaire valide ne peut pas etre supprime');
  db.prepare('DELETE FROM inventories WHERE id = ?').run(inv.id);
  return { ok: true };
});

module.exports = { getInventory };
