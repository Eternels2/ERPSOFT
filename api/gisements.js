'use strict';
/* Gisements + operations d'entrepot scannees : rangement, transfert, reintegration. */
const { db, tx } = require('../lib/db');
const { route, ApiError } = require('../lib/web');
const { stockMove, gisementMove, findByIsbn } = require('../lib/services');

route('GET', '/api/gisements', async (ctx) => {
  const { q } = ctx.query;
  let sql = `SELECT g.*,
      COALESCE((SELECT SUM(qty) FROM product_gisement WHERE gisement_id = g.id), 0) AS qty_total,
      (SELECT COUNT(*) FROM product_gisement WHERE gisement_id = g.id) AS nb_refs
    FROM gisements g`;
  const args = [];
  if (q) { sql += ' WHERE g.code LIKE ?'; args.push(`%${q}%`); }
  sql += ' ORDER BY g.code';
  return db.prepare(sql).all(...args);
});

route('GET', '/api/gisements/:id', async (ctx) => {
  const g = db.prepare('SELECT * FROM gisements WHERE id = ?').get(Number(ctx.params.id));
  if (!g) throw new ApiError(404, 'Gisement introuvable');
  g.products = db.prepare(`SELECT p.id, p.isbn, p.title, p.author, p.publisher, pg.qty
    FROM product_gisement pg JOIN products p ON p.id = pg.product_id
    WHERE pg.gisement_id = ? ORDER BY p.title`).all(g.id);
  return g;
});

route('POST', '/api/gisements', async (ctx) => {
  const { code, etage } = ctx.body;
  if (!code) throw new ApiError(400, 'Le code du gisement est obligatoire');
  try {
    const r = db.prepare('INSERT INTO gisements (code, etage) VALUES (?,?)').run(String(code).trim().toUpperCase(), etage || null);
    return { id: Number(r.lastInsertRowid) };
  } catch { throw new ApiError(400, 'Ce code de gisement existe deja'); }
});

route('PUT', '/api/gisements/:id', async (ctx) => {
  const id = Number(ctx.params.id);
  const g = db.prepare('SELECT * FROM gisements WHERE id = ?').get(id);
  if (!g) throw new ApiError(404, 'Gisement introuvable');
  const { code, etage } = ctx.body;
  db.prepare('UPDATE gisements SET code = ?, etage = ? WHERE id = ?')
    .run(code ? String(code).trim().toUpperCase() : g.code, etage ?? g.etage, id);
  return { ok: true };
});

route('DELETE', '/api/gisements/:id', async (ctx) => {
  const id = Number(ctx.params.id);
  const n = db.prepare('SELECT COALESCE(SUM(qty),0) AS s FROM product_gisement WHERE gisement_id = ?').get(id);
  if (n.s > 0) throw new ApiError(400, 'Ce gisement contient encore des livres, il ne peut pas etre supprime');
  db.prepare('DELETE FROM product_gisement WHERE gisement_id = ?').run(id);
  db.prepare('DELETE FROM gisements WHERE id = ?').run(id);
  return { ok: true };
});

function findGisement(code) {
  const g = db.prepare('SELECT * FROM gisements WHERE UPPER(code) = UPPER(?)').get(String(code || '').trim());
  if (!g) throw new ApiError(404, `Gisement introuvable pour le code "${code}"`);
  return g;
}

/* Rangement : reception de livres dans un gisement -> entree stock principal + emplacement. */
route('POST', '/api/warehouse/rangement', async (ctx) => {
  const { gisement_code, isbn, qty } = ctx.body;
  const g = findGisement(gisement_code);
  const p = findByIsbn(isbn);
  if (!p) throw new ApiError(404, `Livre introuvable pour l'ISBN "${isbn}"`);
  const n = Math.max(1, Number(qty) || 1);
  tx(() => {
    stockMove(p.id, 'main', n, 'Rangement gisement ' + g.code, g.code, ctx.session.user.id);
    gisementMove(p.id, g.id, n);
  });
  return { ok: true, product: { id: p.id, title: p.title, isbn: p.isbn }, gisement: g.code, qty: n };
});

/* Transfert entre gisements (le stock principal ne bouge pas). */
route('POST', '/api/warehouse/transfer', async (ctx) => {
  const { isbn, from_code, to_code, qty } = ctx.body;
  const from = findGisement(from_code);
  const to = findGisement(to_code);
  if (from.id === to.id) throw new ApiError(400, 'Le gisement source et destination sont identiques');
  const p = findByIsbn(isbn);
  if (!p) throw new ApiError(404, `Livre introuvable pour l'ISBN "${isbn}"`);
  const n = Math.max(1, Number(qty) || 1);
  tx(() => {
    gisementMove(p.id, from.id, -n);
    gisementMove(p.id, to.id, n);
  });
  return { ok: true, product: { id: p.id, title: p.title }, from: from.code, to: to.code, qty: n };
});

/* Reintegration : stock retour -> stock principal (+ gisement optionnel). */
route('POST', '/api/warehouse/reintegration', async (ctx) => {
  const { isbn, qty, gisement_code } = ctx.body;
  const p = findByIsbn(isbn);
  if (!p) throw new ApiError(404, `Livre introuvable pour l'ISBN "${isbn}"`);
  const n = Math.max(1, Number(qty) || 1);
  if (p.stock_return < n) throw new ApiError(400, `${p.title} n'est pas present en quantite suffisante dans le stock retour (${p.stock_return})`);
  let g = null;
  if (gisement_code) g = findGisement(gisement_code);
  tx(() => {
    stockMove(p.id, 'return', -n, 'Reintegration vers stock principal', 'REINTEGRATION', ctx.session.user.id);
    stockMove(p.id, 'main', n, 'Reintegration depuis stock retour', 'REINTEGRATION', ctx.session.user.id);
    if (g) gisementMove(p.id, g.id, n);
  });
  return { ok: true, product: { id: p.id, title: p.title }, qty: n, gisement: g ? g.code : null };
});

/* Affectation manuelle d'un livre a un gisement depuis la fiche produit (correction d'inventaire d'emplacement). */
route('POST', '/api/warehouse/assign', async (ctx) => {
  const { product_id, gisement_id, qty } = ctx.body;
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(product_id));
  if (!p) throw new ApiError(404, 'Produit introuvable');
  const g = db.prepare('SELECT * FROM gisements WHERE id = ?').get(Number(gisement_id));
  if (!g) throw new ApiError(404, 'Gisement introuvable');
  const n = Number(qty);
  if (!n) throw new ApiError(400, 'Quantite invalide');
  const placed = db.prepare('SELECT COALESCE(SUM(qty),0) AS s FROM product_gisement WHERE product_id = ?').get(p.id);
  if (n > 0 && placed.s + n > p.stock_main) {
    throw new ApiError(400, `Impossible : ${placed.s} deja places sur ${p.stock_main} en stock principal`);
  }
  gisementMove(p.id, g.id, n);
  return { ok: true };
});
