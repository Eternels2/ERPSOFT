'use strict';
/*
 * Caisses & chariots de picking : chaque contenant porte un code-barres.
 * Scanner une caisse la lie a la commande en preparation ; elle suit la commande
 * jusqu'a l'emballage et se libere a l'expedition.
 * Fournit aussi le resolveur de scan global (/api/scan) : caisse, gisement ou ISBN.
 */
const { db } = require('../lib/db');
const { route, ApiError } = require('../lib/web');
const { findByIsbn } = require('../lib/services');

const CRATE_TYPES = ['caisse', 'chariot'];

function findCrateByCode(code) {
  return db.prepare('SELECT * FROM crates WHERE UPPER(code) = UPPER(?) AND active = 1')
    .get(String(code || '').trim());
}

route('GET', '/api/crates', async (ctx) => {
  return db.prepare(`SELECT cr.*, o.ref AS order_ref, o.status AS order_status, c.name AS client_name
    FROM crates cr
    LEFT JOIN orders o ON o.id = cr.fk_order
    LEFT JOIN thirdparties c ON c.id = o.fk_client
    WHERE cr.active = 1 ORDER BY cr.type, cr.code`).all();
});

route('POST', '/api/crates', async (ctx) => {
  const code = String(ctx.body.code || '').trim().toUpperCase();
  if (!code) throw new ApiError(400, 'Le code de la caisse est obligatoire');
  const type = CRATE_TYPES.includes(ctx.body.type) ? ctx.body.type : 'caisse';
  try {
    const r = db.prepare('INSERT INTO crates (code, type) VALUES (?,?)').run(code, type);
    return { id: Number(r.lastInsertRowid), code, type };
  } catch {
    throw new ApiError(400, `Le code "${code}" existe deja`);
  }
});

route('PUT', '/api/crates/:id', async (ctx) => {
  const cr = db.prepare('SELECT * FROM crates WHERE id = ?').get(Number(ctx.params.id));
  if (!cr) throw new ApiError(404, 'Caisse introuvable');
  const b = ctx.body;
  const code = b.code !== undefined ? String(b.code).trim().toUpperCase() : cr.code;
  if (!code) throw new ApiError(400, 'Le code de la caisse est obligatoire');
  try {
    db.prepare('UPDATE crates SET code = ?, type = ? WHERE id = ?')
      .run(code, CRATE_TYPES.includes(b.type) ? b.type : cr.type, cr.id);
  } catch {
    throw new ApiError(400, `Le code "${code}" existe deja`);
  }
  return { ok: true };
});

/* Liberation manuelle (la liberation normale se fait a l'expedition de la commande). */
route('POST', '/api/crates/:id/release', async (ctx) => {
  const cr = db.prepare('SELECT * FROM crates WHERE id = ?').get(Number(ctx.params.id));
  if (!cr) throw new ApiError(404, 'Caisse introuvable');
  db.prepare('UPDATE crates SET fk_order = NULL WHERE id = ?').run(cr.id);
  return { ok: true };
});

route('DELETE', '/api/crates/:id', async (ctx) => {
  const cr = db.prepare('SELECT * FROM crates WHERE id = ?').get(Number(ctx.params.id));
  if (!cr) throw new ApiError(404, 'Caisse introuvable');
  if (cr.fk_order) throw new ApiError(400, 'Cette caisse est liee a une commande : liberez-la d\'abord');
  db.prepare('DELETE FROM crates WHERE id = ?').run(cr.id);
  return { ok: true };
});

/*
 * Resolveur de scan global : identifie un code-barres quel que soit l'ecran.
 * Priorite : caisse/chariot, puis gisement, puis ISBN livre.
 */
route('POST', '/api/scan', async (ctx) => {
  const code = String(ctx.body.code || '').trim();
  if (!code) throw new ApiError(400, 'Code vide');

  const crate = findCrateByCode(code);
  if (crate) {
    let order = null;
    if (crate.fk_order) {
      order = db.prepare(`SELECT o.id, o.ref, o.status, c.name AS client_name
        FROM orders o JOIN thirdparties c ON c.id = o.fk_client WHERE o.id = ?`).get(crate.fk_order);
    }
    return { kind: 'crate', crate: { id: crate.id, code: crate.code, type: crate.type }, order };
  }

  const g = db.prepare('SELECT id, code FROM gisements WHERE UPPER(code) = UPPER(?)').get(code);
  if (g) return { kind: 'gisement', gisement: g };

  const p = findByIsbn(code);
  if (p) return { kind: 'product', product: { id: p.id, isbn: p.isbn, title: p.title, stock_main: p.stock_main } };

  throw new ApiError(404, `Code "${code}" inconnu : ni caisse/chariot, ni gisement, ni ISBN du catalogue`);
});

module.exports = { findCrateByCode };
