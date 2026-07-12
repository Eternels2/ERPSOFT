'use strict';
/* Portail B2B libraires : catalogue, commandes, avoirs — session distincte du back-office. */
const { db, tx, nextRef, hashPassword } = require('../lib/db');
const { route, ApiError, createSession, destroySession } = require('../lib/web');
const { round2 } = require('../lib/services');

route('POST', '/portal/api/login', async (ctx) => {
  const { login, password } = ctx.body;
  const soc = db.prepare("SELECT * FROM thirdparties WHERE portal_login = ? AND active = 1 AND type = 'client'")
    .get(String(login || '').trim());
  if (!soc || !soc.portal_password_hash || hashPassword(password || '', soc.portal_salt) !== soc.portal_password_hash) {
    throw new ApiError(401, 'Identifiant ou mot de passe incorrect');
  }
  createSession(ctx.res, 'portal', soc.id);
  return { client: { id: soc.id, name: soc.name, code: soc.code } };
}, { auth: 'public' });

route('POST', '/portal/api/logout', async (ctx) => {
  destroySession(ctx.req, ctx.res, 'portal');
  return { ok: true };
}, { auth: 'public' });

route('GET', '/portal/api/me', async (ctx) => ({ client: ctx.session.client }), { auth: 'portal' });

route('GET', '/portal/api/catalog', async (ctx) => {
  const { q } = ctx.query;
  let sql = `SELECT id, isbn, title, author, publisher, collection, format, pages, date_parution, price_ht, tva_rate,
      CASE WHEN stock_main > 20 THEN 'en-stock' WHEN stock_main > 0 THEN 'stock-faible' ELSE 'epuise' END AS dispo
    FROM products WHERE active = 1`;
  const args = [];
  if (q) {
    sql += ` AND (title LIKE ? OR author LIKE ? OR publisher LIKE ? OR replace(replace(isbn,'-',''),' ','') LIKE ?)`;
    const clean = q.replace(/[\s-]/g, '');
    args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${clean}%`);
  }
  sql += ' ORDER BY title LIMIT 500';
  return db.prepare(sql).all(...args);
}, { auth: 'portal' });

/* Passage de commande : { lines: [{product_id, qty}], note } -> commande validee (en file). */
route('POST', '/portal/api/orders', async (ctx) => {
  const { lines, note } = ctx.body;
  if (!Array.isArray(lines) || !lines.length) throw new ApiError(400, 'Aucune quantite saisie');
  const clientId = ctx.session.client.id;
  const order = tx(() => {
    const ref = nextRef('CO');
    const r = db.prepare(`INSERT INTO orders (ref, fk_client, order_type, priority, status, source, note)
      VALUES (?,?,'livraison',5,1,'portail',?)`).run(ref, clientId, note || null);
    const orderId = Number(r.lastInsertRowid);
    const ins = db.prepare('INSERT INTO order_lines (fk_order, fk_product, qty, price_ht, position) VALUES (?,?,?,?,?)');
    let pos = 0, any = false;
    for (const l of lines) {
      const qty = Math.floor(Number(l.qty));
      if (!qty || qty <= 0) continue;
      const p = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(Number(l.product_id));
      if (!p) throw new ApiError(400, 'Produit invalide dans la commande');
      ins.run(orderId, p.id, qty, p.price_ht, ++pos);
      any = true;
    }
    if (!any) throw new ApiError(400, 'Aucune quantite saisie');
    return { id: orderId, ref };
  });
  return { ok: true, order };
}, { auth: 'portal' });

route('GET', '/portal/api/orders', async (ctx) => {
  return db.prepare(`SELECT o.id, o.ref, o.date_order, o.order_type, o.status, o.date_shipped,
      (SELECT COALESCE(SUM(qty),0) FROM order_lines WHERE fk_order = o.id) AS qty_total,
      (SELECT COALESCE(SUM(qty * price_ht),0) FROM order_lines WHERE fk_order = o.id) AS total_ht
    FROM orders o WHERE o.fk_client = ? ORDER BY o.id DESC LIMIT 100`).all(ctx.session.client.id);
}, { auth: 'portal' });

route('GET', '/portal/api/orders/:id', async (ctx) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ? AND fk_client = ?')
    .get(Number(ctx.params.id), ctx.session.client.id);
  if (!o) throw new ApiError(404, 'Commande introuvable');
  o.lines = db.prepare(`SELECT l.qty, l.qty_picked, l.price_ht, p.isbn, p.title, p.author
    FROM order_lines l JOIN products p ON p.id = l.fk_product WHERE l.fk_order = ? ORDER BY l.position`).all(o.id);
  o.total_ht = round2(o.lines.reduce((s, l) => s + l.qty * l.price_ht, 0));
  return o;
}, { auth: 'portal' });

route('GET', '/portal/api/invoices', async (ctx) => {
  return db.prepare(`SELECT id, ref, type, date_invoice, status, total_ht, total_ttc
    FROM invoices WHERE fk_client = ? ORDER BY id DESC LIMIT 100`).all(ctx.session.client.id);
}, { auth: 'portal' });
