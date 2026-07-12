'use strict';
const { db, tx } = require('../lib/db');
const { route, ApiError } = require('../lib/web');
const { round2, invoicePaidAmount, avoirUsedAmount, createInvoice } = require('../lib/services');

const DUE_SQL = `COALESCE(i.date_due, date(i.date_invoice, '+' || (SELECT COALESCE(value,'30') FROM settings WHERE key='payment_terms_days') || ' day'))`;

function getInvoice(id) {
  const i = db.prepare(`SELECT i.*, ${DUE_SQL} AS date_due_eff, t.name AS client_name, t.code AS client_code,
      t.address, t.zip, t.town, t.country, t.email
    FROM invoices i JOIN thirdparties t ON t.id = i.fk_client WHERE i.id = ?`).get(Number(id));
  if (!i) throw new ApiError(404, 'Facture introuvable');
  i.lines = db.prepare('SELECT * FROM invoice_lines WHERE fk_invoice = ? ORDER BY position, id').all(i.id);
  if (i.type === 'avoir') {
    i.used = round2(avoirUsedAmount(i.id));
    i.remaining = round2(i.total_ttc - i.used);
  } else {
    i.paid = round2(invoicePaidAmount(i.id));
    i.remaining = round2(i.total_ttc - i.paid);
  }
  i.payments = db.prepare(`SELECT p.id, p.ref, p.date_payment, p.mode, a.amount FROM payment_allocations a
    JOIN payments p ON p.id = a.fk_payment WHERE a.fk_invoice = ? ORDER BY p.date_payment`).all(i.id);
  return i;
}

route('GET', '/api/invoices', async (ctx) => {
  const { type, status, client, q, unpaid } = ctx.query;
  let sql = `SELECT i.*, ${DUE_SQL} AS date_due_eff, t.name AS client_name,
      CASE WHEN i.type = 'avoir'
        THEN (SELECT COALESCE(SUM(amount),0) FROM payments WHERE fk_avoir = i.id)
        ELSE (SELECT COALESCE(SUM(amount),0) FROM payment_allocations WHERE fk_invoice = i.id)
      END AS paid
    FROM invoices i JOIN thirdparties t ON t.id = i.fk_client WHERE 1=1`;
  const args = [];
  if (type) { sql += ' AND i.type = ?'; args.push(type); }
  if (status !== undefined && status !== '') { sql += ' AND i.status = ?'; args.push(Number(status)); }
  if (client) { sql += ' AND i.fk_client = ?'; args.push(Number(client)); }
  if (q) { sql += ' AND (i.ref LIKE ? OR t.name LIKE ?)'; args.push(`%${q}%`, `%${q}%`); }
  sql += ' ORDER BY i.id DESC LIMIT 300';
  let rows = db.prepare(sql).all(...args).map((i) => ({
    ...i,
    remaining: round2(i.total_ttc - i.paid),
    overdue: i.type === 'facture' && i.status === 1 && i.date_due_eff < new Date().toISOString().slice(0, 10)
      && round2(i.total_ttc - i.paid) > 0.005
  }));
  if (unpaid) rows = rows.filter((i) => i.remaining > 0.005);
  return rows;
});

/* Commandes expediees non facturees d'un client (candidates a la facture recapitulative). */
route('GET', '/api/invoices/recapable', async (ctx) => {
  const clientId = Number(ctx.query.client);
  if (!clientId) throw new ApiError(400, 'Client requis');
  return db.prepare(`SELECT o.id, o.ref, o.date_shipped,
      (SELECT COALESCE(SUM(CASE WHEN qty_picked > 0 THEN qty_picked ELSE qty END * price_ht * (1 - discount_pct/100.0)),0)
       FROM order_lines WHERE fk_order = o.id) AS total_ht
    FROM orders o WHERE o.fk_client = ? AND o.status = 4 AND o.fk_invoice IS NULL
    ORDER BY o.date_shipped, o.id`).all(clientId);
});

/* Facture recapitulative : une facture unique pour plusieurs commandes expediees du meme client. */
route('POST', '/api/invoices/recap', async (ctx) => {
  const { fk_client, order_ids } = ctx.body;
  const clientId = Number(fk_client);
  if (!Array.isArray(order_ids) || !order_ids.length) throw new ApiError(400, 'Aucune commande selectionnee');
  const orders = order_ids.map((id) => {
    const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(id));
    if (!o || o.fk_client !== clientId) throw new ApiError(400, 'Commande invalide dans la selection');
    if (o.status !== 4 || o.fk_invoice) throw new ApiError(400, `${o.ref} : la commande doit etre expediee et non facturee`);
    return o;
  });
  const invLines = [];
  for (const o of orders) {
    const lines = db.prepare(`SELECT l.*, p.title, p.isbn, p.tva_rate FROM order_lines l
      JOIN products p ON p.id = l.fk_product WHERE l.fk_order = ?`).all(o.id);
    for (const l of lines) {
      const qty = l.qty_picked > 0 ? l.qty_picked : l.qty;
      if (qty <= 0) continue;
      invLines.push({
        fk_product: l.fk_product,
        label: `[${o.ref}] ${l.title} (${l.isbn})`,
        qty,
        price_ht: round2(l.price_ht * (1 - l.discount_pct / 100)),
        tva_rate: l.tva_rate
      });
    }
  }
  if (!invLines.length) throw new ApiError(400, 'Rien a facturer');
  const inv = tx(() => {
    const created = createInvoice({
      type: 'facture', fk_client: clientId, lines: invLines,
      source_type: 'manuel', note: 'Facture recapitulative : ' + orders.map((o) => o.ref).join(', '),
      userId: ctx.session.user.id
    });
    for (const o of orders) db.prepare('UPDATE orders SET status = 5, fk_invoice = ? WHERE id = ?').run(created.id, o.id);
    return created;
  });
  return { ok: true, invoice: inv };
});

/* Doit rester APRES /api/invoices/recapable : les routes se resolvent dans l'ordre de declaration. */
route('GET', '/api/invoices/:id', async (ctx) => getInvoice(ctx.params.id));

module.exports = { getInvoice };
