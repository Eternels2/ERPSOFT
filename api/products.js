'use strict';
const { db } = require('../lib/db');
const { route, ApiError } = require('../lib/web');
const { findByIsbn } = require('../lib/services');

route('GET', '/api/products', async (ctx) => {
  const { q, supplier, low } = ctx.query;
  let sql = `SELECT p.*, s.name AS supplier_name FROM products p
    LEFT JOIN thirdparties s ON s.id = p.fk_supplier WHERE p.active = 1`;
  const args = [];
  if (q) {
    sql += ` AND (p.title LIKE ? OR p.author LIKE ? OR p.publisher LIKE ? OR replace(replace(p.isbn,'-',''),' ','') LIKE ?)`;
    const clean = q.replace(/[\s-]/g, '');
    args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${clean}%`);
  }
  if (supplier) { sql += ' AND p.fk_supplier = ?'; args.push(Number(supplier)); }
  if (low) sql += ' AND p.stock_main <= 10';
  sql += ' ORDER BY p.title LIMIT 500';
  return db.prepare(sql).all(...args);
});

route('GET', '/api/products/lookup', async (ctx) => {
  const p = findByIsbn(ctx.query.isbn);
  if (!p) throw new ApiError(404, `Aucun livre pour l'ISBN "${ctx.query.isbn}"`);
  return p;
});

route('GET', '/api/products/:id', async (ctx) => {
  const p = db.prepare(`SELECT p.*, s.name AS supplier_name FROM products p
    LEFT JOIN thirdparties s ON s.id = p.fk_supplier WHERE p.id = ?`).get(Number(ctx.params.id));
  if (!p) throw new ApiError(404, 'Produit introuvable');
  p.gisements = db.prepare(`SELECT g.id, g.code, g.etage, pg.qty FROM product_gisement pg
    JOIN gisements g ON g.id = pg.gisement_id WHERE pg.product_id = ? ORDER BY g.code`).all(p.id);
  p.movements = db.prepare(`SELECT m.*, u.name AS user_name FROM stock_movements m
    LEFT JOIN users u ON u.id = m.fk_user WHERE m.fk_product = ? ORDER BY m.id DESC LIMIT 30`).all(p.id);
  return p;
});

function validateBody(b, existing) {
  const isbn = String(b.isbn ?? existing?.isbn ?? '').replace(/[\s-]/g, '');
  if (!isbn) throw new ApiError(400, "L'ISBN / EAN13 est obligatoire");
  const title = b.title ?? existing?.title;
  if (!title) throw new ApiError(400, 'Le titre est obligatoire');
  return { isbn, title };
}

route('POST', '/api/products', async (ctx) => {
  const b = ctx.body;
  const { isbn, title } = validateBody(b);
  if (findByIsbn(isbn)) throw new ApiError(400, 'Un livre avec cet ISBN existe deja');
  const r = db.prepare(`INSERT INTO products (isbn, title, author, publisher, collection, format, pages, date_parution,
      remise_editeur, fk_supplier, price_ht, buy_price_ht, tva_rate, notes, stock_min)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(isbn, title, b.author || null, b.publisher || null, b.collection || null, b.format || null,
      b.pages ? Number(b.pages) : null, b.date_parution || null, Number(b.remise_editeur) || 0,
      b.fk_supplier ? Number(b.fk_supplier) : null, Number(b.price_ht) || 0, Number(b.buy_price_ht) || 0,
      b.tva_rate !== undefined ? Number(b.tva_rate) : 5.5, b.notes || null, Number(b.stock_min) || 0);
  return { id: Number(r.lastInsertRowid) };
});

route('PUT', '/api/products/:id', async (ctx) => {
  const id = Number(ctx.params.id);
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!p) throw new ApiError(404, 'Produit introuvable');
  const b = ctx.body;
  const { isbn, title } = validateBody(b, p);
  const dup = findByIsbn(isbn);
  if (dup && dup.id !== id) throw new ApiError(400, 'Un autre livre porte deja cet ISBN');
  db.prepare(`UPDATE products SET isbn=?, title=?, author=?, publisher=?, collection=?, format=?, pages=?, date_parution=?,
      remise_editeur=?, fk_supplier=?, price_ht=?, buy_price_ht=?, tva_rate=?, notes=?, stock_min=? WHERE id=?`)
    .run(isbn, title, b.author ?? p.author, b.publisher ?? p.publisher, b.collection ?? p.collection,
      b.format ?? p.format, b.pages !== undefined ? (b.pages ? Number(b.pages) : null) : p.pages,
      b.date_parution ?? p.date_parution,
      b.remise_editeur !== undefined ? Number(b.remise_editeur) : p.remise_editeur,
      b.fk_supplier !== undefined ? (b.fk_supplier ? Number(b.fk_supplier) : null) : p.fk_supplier,
      b.price_ht !== undefined ? Number(b.price_ht) : p.price_ht,
      b.buy_price_ht !== undefined ? Number(b.buy_price_ht) : p.buy_price_ht,
      b.tva_rate !== undefined ? Number(b.tva_rate) : p.tva_rate,
      b.notes ?? p.notes,
      b.stock_min !== undefined ? Number(b.stock_min) || 0 : p.stock_min, id);
  return { ok: true };
});

route('DELETE', '/api/products/:id', async (ctx) => {
  const id = Number(ctx.params.id);
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!p) throw new ApiError(404, 'Produit introuvable');
  if (p.stock_main > 0 || p.stock_return > 0) throw new ApiError(400, 'Impossible de supprimer un livre qui a du stock');
  db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(id);
  return { ok: true };
});
