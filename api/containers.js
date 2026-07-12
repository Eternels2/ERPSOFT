'use strict';
/* Conteneurs de retour fournisseur : regroupent les livres retournes acceptes, un fournisseur par conteneur. */
const { db, tx, nextRef } = require('../lib/db');
const { route, ApiError } = require('../lib/web');
const { round2, stockMove } = require('../lib/services');

function getContainer(id) {
  const c = db.prepare(`SELECT c.*, s.name AS supplier_name, s.code AS supplier_code
    FROM containers c JOIN thirdparties s ON s.id = c.fk_supplier WHERE c.id = ?`).get(Number(id));
  if (!c) throw new ApiError(404, 'Conteneur introuvable');
  c.lines = db.prepare(`SELECT l.id, l.qty, l.price_ht, p.id AS product_id, p.isbn, p.title, p.author, p.publisher,
      r.ref AS return_ref, t.name AS client_name
    FROM return_lines l
    JOIN products p ON p.id = l.fk_product
    JOIN returns r ON r.id = l.fk_return
    JOIN thirdparties t ON t.id = r.fk_client
    WHERE l.fk_container = ? ORDER BY p.title`).all(c.id);
  c.nb_books = c.lines.reduce((s, l) => s + l.qty, 0);
  c.total_ht = round2(c.lines.reduce((s, l) => s + l.qty * l.price_ht, 0));
  // Lignes acceptees de ce fournisseur, finalisees, non affectees a un conteneur.
  c.available = db.prepare(`SELECT l.id, l.qty, p.isbn, p.title, r.ref AS return_ref
    FROM return_lines l
    JOIN products p ON p.id = l.fk_product
    JOIN returns r ON r.id = l.fk_return
    WHERE l.fk_supplier = ? AND l.line_status = 1 AND l.fk_container IS NULL AND r.status = 1
    ORDER BY l.id DESC`).all(c.fk_supplier);
  return c;
}

route('GET', '/api/containers', async (ctx) => {
  const { status } = ctx.query;
  let sql = `SELECT c.*, s.name AS supplier_name,
      (SELECT COALESCE(SUM(qty),0) FROM return_lines WHERE fk_container = c.id) AS nb_books,
      (SELECT COALESCE(SUM(qty*price_ht),0) FROM return_lines WHERE fk_container = c.id) AS total_ht
    FROM containers c JOIN thirdparties s ON s.id = c.fk_supplier WHERE 1=1`;
  const args = [];
  if (status !== undefined && status !== '') { sql += ' AND c.status = ?'; args.push(Number(status)); }
  sql += ' ORDER BY c.id DESC LIMIT 200';
  return db.prepare(sql).all(...args);
});

route('GET', '/api/containers/:id', async (ctx) => getContainer(ctx.params.id));

route('POST', '/api/containers', async (ctx) => {
  const b = ctx.body;
  const supplier = db.prepare("SELECT id FROM thirdparties WHERE id = ? AND type = 'fournisseur'").get(Number(b.fk_supplier));
  if (!supplier) throw new ApiError(400, 'Fournisseur invalide');
  const ref = nextRef('CT');
  const r = db.prepare('INSERT INTO containers (ref, fk_supplier, supplier_return_number, fk_user_creat) VALUES (?,?,?,?)')
    .run(ref, supplier.id, b.supplier_return_number || null, ctx.session.user.id);
  return { id: Number(r.lastInsertRowid), ref };
});

route('PUT', '/api/containers/:id', async (ctx) => {
  const c = db.prepare('SELECT * FROM containers WHERE id = ?').get(Number(ctx.params.id));
  if (!c) throw new ApiError(404, 'Conteneur introuvable');
  if (c.status !== 0) throw new ApiError(400, 'Ce conteneur est deja expedie');
  db.prepare('UPDATE containers SET supplier_return_number = ? WHERE id = ?')
    .run(ctx.body.supplier_return_number ?? c.supplier_return_number, c.id);
  return { ok: true };
});

/* Rapatrie dans ce conteneur les lignes retournees acceptees du fournisseur non encore affectees. */
route('POST', '/api/containers/:id/pull', async (ctx) => {
  const c = db.prepare('SELECT * FROM containers WHERE id = ?').get(Number(ctx.params.id));
  if (!c) throw new ApiError(404, 'Conteneur introuvable');
  if (c.status !== 0) throw new ApiError(400, 'Ce conteneur est deja expedie');
  const r = db.prepare(`UPDATE return_lines SET fk_container = ?
    WHERE fk_supplier = ? AND line_status = 1 AND fk_container IS NULL
      AND fk_return IN (SELECT id FROM returns WHERE status = 1)`).run(c.id, c.fk_supplier);
  return { ok: true, added: Number(r.changes) };
});

route('POST', '/api/containers/:id/remove-line', async (ctx) => {
  const c = db.prepare('SELECT * FROM containers WHERE id = ?').get(Number(ctx.params.id));
  if (!c) throw new ApiError(404, 'Conteneur introuvable');
  if (c.status !== 0) throw new ApiError(400, 'Ce conteneur est deja expedie');
  db.prepare('UPDATE return_lines SET fk_container = NULL WHERE id = ? AND fk_container = ?')
    .run(Number(ctx.body.line_id), c.id);
  return { ok: true };
});

/* Expedition : le stock retour sort definitivement (repart chez le fournisseur). */
route('POST', '/api/containers/:id/ship', async (ctx) => {
  const c = db.prepare('SELECT * FROM containers WHERE id = ?').get(Number(ctx.params.id));
  if (!c) throw new ApiError(404, 'Conteneur introuvable');
  if (c.status !== 0) throw new ApiError(400, 'Ce conteneur est deja expedie');
  const lines = db.prepare('SELECT fk_product, SUM(qty) AS qty FROM return_lines WHERE fk_container = ? GROUP BY fk_product').all(c.id);
  if (!lines.length) throw new ApiError(400, 'Ce conteneur est vide');
  tx(() => {
    for (const l of lines) {
      stockMove(l.fk_product, 'return', -l.qty, 'Expedition conteneur ' + c.ref, c.ref, ctx.session.user.id);
    }
    db.prepare("UPDATE containers SET status = 1, date_shipped = date('now') WHERE id = ?").run(c.id);
  });
  return { ok: true };
});

route('DELETE', '/api/containers/:id', async (ctx) => {
  const c = db.prepare('SELECT * FROM containers WHERE id = ?').get(Number(ctx.params.id));
  if (!c) throw new ApiError(404, 'Conteneur introuvable');
  if (c.status !== 0) throw new ApiError(400, 'Un conteneur expedie ne peut pas etre supprime');
  tx(() => {
    db.prepare('UPDATE return_lines SET fk_container = NULL WHERE fk_container = ?').run(c.id);
    db.prepare('DELETE FROM containers WHERE id = ?').run(c.id);
  });
  return { ok: true };
});

module.exports = { getContainer };
