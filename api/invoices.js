'use strict';
const { db } = require('../lib/db');
const { route, ApiError } = require('../lib/web');
const { round2, invoicePaidAmount, avoirUsedAmount } = require('../lib/services');

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

route('GET', '/api/invoices/:id', async (ctx) => getInvoice(ctx.params.id));

module.exports = { getInvoice };
