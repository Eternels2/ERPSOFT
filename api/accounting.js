'use strict';
/*
 * Comptabilite : reglements (avec imputation d'avoirs), encours et balance agee,
 * journaux en partie double (ventes / banque), declaration de TVA, exports CSV et FEC.
 */
const { db, tx, nextRef, getSetting } = require('../lib/db');
const { route, ApiError } = require('../lib/web');
const { round2, invoicePaidAmount, avoirUsedAmount, recomputeInvoiceStatus } = require('../lib/services');

const PAYMENT_MODES = ['virement', 'cheque', 'cb', 'especes', 'avoir'];
const MODE_LABELS = { virement: 'Virement', cheque: 'Cheque', cb: 'Carte bancaire', especes: 'Especes', avoir: 'Imputation avoir' };

/* Echeance effective : date_due, sinon date facture + delai configure. */
const DUE_SQL = `COALESCE(i.date_due, date(i.date_invoice, '+' || (SELECT COALESCE(value,'30') FROM settings WHERE key='payment_terms_days') || ' day'))`;

/* ------------------------------------------------------------- reglements */
route('GET', '/api/payments', async (ctx) => {
  const { client, q } = ctx.query;
  let sql = `SELECT p.*, t.name AS client_name, av.ref AS avoir_ref,
      (SELECT COALESCE(SUM(amount),0) FROM payment_allocations WHERE fk_payment = p.id) AS allocated
    FROM payments p JOIN thirdparties t ON t.id = p.fk_client
    LEFT JOIN invoices av ON av.id = p.fk_avoir WHERE 1=1`;
  const args = [];
  if (client) { sql += ' AND p.fk_client = ?'; args.push(Number(client)); }
  if (q) { sql += ' AND (p.ref LIKE ? OR t.name LIKE ? OR p.reference LIKE ?)'; args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  sql += ' ORDER BY p.id DESC LIMIT 300';
  return db.prepare(sql).all(...args);
});

route('GET', '/api/payments/:id', async (ctx) => {
  const p = db.prepare(`SELECT p.*, t.name AS client_name, av.ref AS avoir_ref FROM payments p
    JOIN thirdparties t ON t.id = p.fk_client LEFT JOIN invoices av ON av.id = p.fk_avoir
    WHERE p.id = ?`).get(Number(ctx.params.id));
  if (!p) throw new ApiError(404, 'Reglement introuvable');
  p.allocations = db.prepare(`SELECT a.*, i.ref AS invoice_ref, i.total_ttc FROM payment_allocations a
    JOIN invoices i ON i.id = a.fk_invoice WHERE a.fk_payment = ? ORDER BY a.id`).all(p.id);
  return p;
});

/*
 * Factures en attente + avoirs disponibles d'un client (ecran de saisie de reglement).
 */
route('GET', '/api/accounting/unpaid', async (ctx) => {
  const clientId = Number(ctx.query.client);
  if (!clientId) throw new ApiError(400, 'Client requis');
  const invoices = db.prepare(`SELECT i.id, i.ref, i.date_invoice, ${DUE_SQL} AS date_due, i.total_ttc,
      (SELECT COALESCE(SUM(amount),0) FROM payment_allocations WHERE fk_invoice = i.id) AS paid
    FROM invoices i WHERE i.fk_client = ? AND i.type = 'facture' AND i.status >= 1
    ORDER BY i.date_invoice, i.id`).all(clientId)
    .map((i) => ({ ...i, remaining: round2(i.total_ttc - i.paid) }))
    .filter((i) => i.remaining > 0.005);
  const avoirs = db.prepare(`SELECT i.id, i.ref, i.date_invoice, i.total_ttc FROM invoices i
    WHERE i.fk_client = ? AND i.type = 'avoir' AND i.status >= 1 ORDER BY i.date_invoice`).all(clientId)
    .map((a) => ({ ...a, used: round2(avoirUsedAmount(a.id)), remaining: round2(a.total_ttc - avoirUsedAmount(a.id)) }))
    .filter((a) => a.remaining > 0.005);
  return { invoices, avoirs };
});

/*
 * Saisie d'un reglement.
 * body: { fk_client, date_payment, mode, amount, reference, note, fk_avoir?, allocations: [{fk_invoice, amount}] }
 * mode 'avoir' : le montant est preleve sur l'avoir fk_avoir (imputation, pas d'encaissement).
 */
route('POST', '/api/payments', async (ctx) => {
  const b = ctx.body;
  const client = db.prepare("SELECT id FROM thirdparties WHERE id = ? AND type = 'client'").get(Number(b.fk_client));
  if (!client) throw new ApiError(400, 'Client invalide');
  const mode = PAYMENT_MODES.includes(b.mode) ? b.mode : 'virement';
  const amount = round2(Number(b.amount));
  if (!amount || amount <= 0) throw new ApiError(400, 'Le montant doit etre superieur a zero');

  let avoir = null;
  if (mode === 'avoir') {
    avoir = db.prepare("SELECT * FROM invoices WHERE id = ? AND type = 'avoir' AND fk_client = ? AND status >= 1")
      .get(Number(b.fk_avoir), client.id);
    if (!avoir) throw new ApiError(400, 'Avoir introuvable pour ce client');
    const remaining = round2(avoir.total_ttc - avoirUsedAmount(avoir.id));
    if (amount > remaining + 0.005) throw new ApiError(400, `Le montant depasse le solde de l'avoir (${remaining.toFixed(2)} €)`);
  }

  const allocations = Array.isArray(b.allocations) ? b.allocations : [];
  const allocTotal = round2(allocations.reduce((s, a) => s + Number(a.amount || 0), 0));
  if (allocTotal > amount + 0.005) throw new ApiError(400, 'Les affectations depassent le montant du reglement');

  const result = tx(() => {
    const ref = nextRef('RG');
    const r = db.prepare(`INSERT INTO payments (ref, fk_client, date_payment, mode, amount, fk_avoir, reference, note, fk_user_creat)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(ref, client.id, b.date_payment || new Date().toISOString().slice(0, 10), mode, amount,
        avoir ? avoir.id : null, b.reference || null, b.note || null, ctx.session.user.id);
    const paymentId = Number(r.lastInsertRowid);
    const ins = db.prepare('INSERT INTO payment_allocations (fk_payment, fk_invoice, amount) VALUES (?,?,?)');
    for (const a of allocations) {
      const alloc = round2(Number(a.amount));
      if (!alloc || alloc <= 0) continue;
      const inv = db.prepare("SELECT * FROM invoices WHERE id = ? AND type = 'facture' AND fk_client = ? AND status >= 1")
        .get(Number(a.fk_invoice), client.id);
      if (!inv) throw new ApiError(400, 'Facture invalide dans les affectations');
      const remaining = round2(inv.total_ttc - invoicePaidAmount(inv.id));
      if (alloc > remaining + 0.005) throw new ApiError(400, `L'affectation sur ${inv.ref} depasse le restant du (${remaining.toFixed(2)} €)`);
      ins.run(paymentId, inv.id, alloc);
      recomputeInvoiceStatus(inv.id);
    }
    if (avoir) recomputeInvoiceStatus(avoir.id);
    return { id: paymentId, ref };
  });
  return { ok: true, payment: result };
});

route('DELETE', '/api/payments/:id', async (ctx) => {
  const p = db.prepare('SELECT * FROM payments WHERE id = ?').get(Number(ctx.params.id));
  if (!p) throw new ApiError(404, 'Reglement introuvable');
  tx(() => {
    const invoiceIds = db.prepare('SELECT DISTINCT fk_invoice AS id FROM payment_allocations WHERE fk_payment = ?').all(p.id);
    db.prepare('DELETE FROM payment_allocations WHERE fk_payment = ?').run(p.id);
    db.prepare('DELETE FROM payments WHERE id = ?').run(p.id);
    for (const { id } of invoiceIds) recomputeInvoiceStatus(id);
    if (p.fk_avoir) recomputeInvoiceStatus(p.fk_avoir);
  });
  return { ok: true };
});

/* ------------------------------------------------------------- synthese */
route('GET', '/api/accounting/dashboard', async () => {
  const now = new Date();
  const y0 = `${now.getFullYear()}-01-01`;
  const m0 = now.toISOString().slice(0, 8) + '01';

  const factures = db.prepare(`SELECT COALESCE(SUM(total_ttc),0) AS s FROM invoices WHERE type='facture' AND status >= 1`).get().s;
  const paid = db.prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM payment_allocations`).get().s;
  const avoirsTotal = db.prepare(`SELECT COALESCE(SUM(total_ttc),0) AS s FROM invoices WHERE type='avoir' AND status >= 1`).get().s;
  const avoirsUsed = db.prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE mode = 'avoir'`).get().s;

  const overdue = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(i.total_ttc - (SELECT COALESCE(SUM(amount),0) FROM payment_allocations WHERE fk_invoice = i.id)),0) AS s
    FROM invoices i WHERE i.type='facture' AND i.status = 1 AND ${DUE_SQL} < date('now')
      AND i.total_ttc - (SELECT COALESCE(SUM(amount),0) FROM payment_allocations WHERE fk_invoice = i.id) > 0.005`).get();

  return {
    encours: round2(factures - paid),                    // restant du sur factures
    avoirs_non_imputes: round2(avoirsTotal - avoirsUsed), // credit disponible pour les clients
    encaissements_mois: round2(db.prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE mode != 'avoir' AND date_payment >= ?`).get(m0).s),
    encaissements_annee: round2(db.prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE mode != 'avoir' AND date_payment >= ?`).get(y0).s),
    retards: { nb: overdue.n, montant: round2(overdue.s) },
    avoirs_imputes: round2(avoirsUsed)
  };
});

/* ------------------------------------------------------------- balance agee */
route('GET', '/api/accounting/aged', async () => {
  const invoices = db.prepare(`SELECT i.id, i.fk_client, t.name AS client_name, i.total_ttc, ${DUE_SQL} AS due,
      (SELECT COALESCE(SUM(amount),0) FROM payment_allocations WHERE fk_invoice = i.id) AS paid
    FROM invoices i JOIN thirdparties t ON t.id = i.fk_client
    WHERE i.type = 'facture' AND i.status >= 1`).all();
  const avoirs = db.prepare(`SELECT i.fk_client, SUM(i.total_ttc) AS s FROM invoices i
    WHERE i.type = 'avoir' AND i.status = 1 GROUP BY i.fk_client`).all();
  const today = new Date().toISOString().slice(0, 10);
  const days = (d) => Math.floor((new Date(today) - new Date(d)) / 86400000);

  const byClient = {};
  for (const i of invoices) {
    const remaining = round2(i.total_ttc - i.paid);
    if (remaining <= 0.005) continue;
    const c = byClient[i.fk_client] || (byClient[i.fk_client] = {
      client_id: i.fk_client, client_name: i.client_name,
      not_due: 0, d30: 0, d60: 0, d90: 0, d90p: 0, total: 0, avoirs: 0
    });
    const late = days(i.due);
    if (late <= 0) c.not_due = round2(c.not_due + remaining);
    else if (late <= 30) c.d30 = round2(c.d30 + remaining);
    else if (late <= 60) c.d60 = round2(c.d60 + remaining);
    else if (late <= 90) c.d90 = round2(c.d90 + remaining);
    else c.d90p = round2(c.d90p + remaining);
    c.total = round2(c.total + remaining);
  }
  for (const a of avoirs) {
    // avoirs valides non imputes = credit disponible
    const used = db.prepare(`SELECT COALESCE(SUM(p.amount),0) AS s FROM payments p
      JOIN invoices av ON av.id = p.fk_avoir WHERE av.fk_client = ?`).get(a.fk_client).s;
    const credit = round2(a.s - used);
    if (credit <= 0.005) continue;
    const row = byClient[a.fk_client];
    if (row) row.avoirs = credit;
    else {
      const t = db.prepare('SELECT name FROM thirdparties WHERE id = ?').get(a.fk_client);
      byClient[a.fk_client] = { client_id: a.fk_client, client_name: t ? t.name : '?', not_due: 0, d30: 0, d60: 0, d90: 0, d90p: 0, total: 0, avoirs: credit };
    }
  }
  const rows = Object.values(byClient).sort((a, b) => b.total - a.total);
  const totals = rows.reduce((s, r) => ({
    not_due: round2(s.not_due + r.not_due), d30: round2(s.d30 + r.d30), d60: round2(s.d60 + r.d60),
    d90: round2(s.d90 + r.d90), d90p: round2(s.d90p + r.d90p), total: round2(s.total + r.total), avoirs: round2(s.avoirs + r.avoirs)
  }), { not_due: 0, d30: 0, d60: 0, d90: 0, d90p: 0, total: 0, avoirs: 0 });
  return { rows, totals };
});

/* ------------------------------------------------------- ecritures comptables */
function accounts() {
  return {
    client: { num: getSetting('acc_client', '411000'), lib: 'Clients' },
    sales: { num: getSetting('acc_sales', '701100'), lib: 'Ventes de livres' },
    fees: { num: getSetting('acc_fees', '708500'), lib: 'Frais et ports factures' },
    vat: { num: getSetting('acc_vat', '445710'), lib: 'TVA collectee' },
    bank: { num: getSetting('acc_bank', '512000'), lib: 'Banque' },
    cash: { num: getSetting('acc_cash', '530000'), lib: 'Caisse' }
  };
}

/*
 * Genere les ecritures en partie double a la volee.
 * Facture : 411 (D TTC) / 701+708 (C HT) / 44571 (C TVA). Avoir : inverse.
 * Reglement (hors imputation avoir) : 512 ou 530 (D) / 411 (C).
 */
function buildEntries(from, to) {
  const acc = accounts();
  const entries = [];
  const invoices = db.prepare(`SELECT i.*, t.code AS client_code, t.name AS client_name FROM invoices i
    JOIN thirdparties t ON t.id = i.fk_client
    WHERE i.status >= 1 AND i.date_invoice >= ? AND i.date_invoice <= ? ORDER BY i.date_invoice, i.id`).all(from, to);
  for (const i of invoices) {
    const sign = i.type === 'avoir' ? -1 : 1;
    const lines = db.prepare('SELECT * FROM invoice_lines WHERE fk_invoice = ?').all(i.id);
    const push = (compte, lib, debit, credit) => entries.push({
      journal: 'VE', journal_lib: 'Ventes', num: i.ref, date: i.date_invoice,
      compte_num: compte.num, compte_lib: compte.lib,
      aux_num: compte === acc.client ? i.client_code : '', aux_lib: compte === acc.client ? i.client_name : '',
      piece: i.ref, piece_date: i.date_invoice,
      libelle: `${i.type === 'avoir' ? 'Avoir' : 'Facture'} ${i.ref} - ${i.client_name}`,
      debit: round2(Math.max(0, debit)), credit: round2(Math.max(0, credit))
    });
    // 411 : debit TTC pour facture, credit TTC pour avoir
    push(acc.client, '', sign > 0 ? i.total_ttc : 0, sign > 0 ? 0 : i.total_ttc);
    // Produits par type de ligne (ventes vs frais)
    const salesHt = round2(lines.filter((l) => l.fk_product).reduce((s, l) => s + l.total_ht, 0));
    const feesHt = round2(lines.filter((l) => !l.fk_product).reduce((s, l) => s + l.total_ht, 0));
    if (Math.abs(salesHt) > 0.005) push(acc.sales, '', sign * salesHt < 0 ? Math.abs(salesHt) : 0, sign * salesHt > 0 ? Math.abs(salesHt) : 0);
    if (Math.abs(feesHt) > 0.005) push(acc.fees, '', sign * feesHt < 0 ? Math.abs(feesHt) : 0, sign * feesHt > 0 ? Math.abs(feesHt) : 0);
    if (Math.abs(i.total_tva) > 0.005) push(acc.vat, '', sign > 0 ? 0 : i.total_tva, sign > 0 ? i.total_tva : 0);
  }
  const payments = db.prepare(`SELECT p.*, t.code AS client_code, t.name AS client_name FROM payments p
    JOIN thirdparties t ON t.id = p.fk_client
    WHERE p.mode != 'avoir' AND p.date_payment >= ? AND p.date_payment <= ? ORDER BY p.date_payment, p.id`).all(from, to);
  for (const p of payments) {
    const bankAcc = p.mode === 'especes' ? acc.cash : acc.bank;
    const lib = `Reglement ${p.ref} - ${p.client_name} (${MODE_LABELS[p.mode] || p.mode})`;
    entries.push({
      journal: 'BQ', journal_lib: 'Banque', num: p.ref, date: p.date_payment,
      compte_num: bankAcc.num, compte_lib: bankAcc.lib, aux_num: '', aux_lib: '',
      piece: p.ref, piece_date: p.date_payment, libelle: lib, debit: round2(p.amount), credit: 0
    });
    entries.push({
      journal: 'BQ', journal_lib: 'Banque', num: p.ref, date: p.date_payment,
      compte_num: acc.client.num, compte_lib: acc.client.lib, aux_num: p.client_code, aux_lib: p.client_name,
      piece: p.ref, piece_date: p.date_payment, libelle: lib, debit: 0, credit: round2(p.amount)
    });
  }
  return entries;
}

function periodOf(ctx) {
  const from = ctx.query.from || '1900-01-01';
  const to = ctx.query.to || '2999-12-31';
  return { from, to };
}

route('GET', '/api/accounting/journal', async (ctx) => {
  const { from, to } = periodOf(ctx);
  let entries = buildEntries(from, to);
  if (ctx.query.journal) entries = entries.filter((e) => e.journal === ctx.query.journal);
  const totals = entries.reduce((s, e) => ({ debit: round2(s.debit + e.debit), credit: round2(s.credit + e.credit) }), { debit: 0, credit: 0 });
  return { entries, totals };
});

/* ------------------------------------------------------------- TVA */
route('GET', '/api/accounting/vat', async (ctx) => {
  const { from, to } = periodOf(ctx);
  const rows = db.prepare(`SELECT l.tva_rate,
      SUM(CASE WHEN i.type='facture' THEN l.total_ht ELSE -l.total_ht END) AS base_ht
    FROM invoice_lines l JOIN invoices i ON i.id = l.fk_invoice
    WHERE i.status >= 1 AND i.date_invoice >= ? AND i.date_invoice <= ?
    GROUP BY l.tva_rate ORDER BY l.tva_rate`).all(from, to)
    .map((r) => ({ tva_rate: r.tva_rate, base_ht: round2(r.base_ht), tva: round2(r.base_ht * r.tva_rate / 100) }));
  const total = rows.reduce((s, r) => ({ base_ht: round2(s.base_ht + r.base_ht), tva: round2(s.tva + r.tva) }), { base_ht: 0, tva: 0 });
  return { rows, total };
});

/* ------------------------------------------------------------- exports */
function sendCsv(ctx, filename, header, rows) {
  const SEP = ';';
  const escCsv = (v) => {
    const s = String(v ?? '');
    return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const body = [header.join(SEP)].concat(rows.map((r) => r.map(escCsv).join(SEP))).join('\r\n');
  ctx.res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`
  });
  // BOM pour Excel
  ctx.res.end('﻿' + body);
}

const fr = (n) => (Number(n) || 0).toFixed(2).replace('.', ',');

route('GET', '/api/accounting/export/journal.csv', async (ctx) => {
  const { from, to } = periodOf(ctx);
  const entries = buildEntries(from, to);
  sendCsv(ctx, `journal_${from}_${to}.csv`,
    ['Journal', 'Date', 'Piece', 'Compte', 'Libelle compte', 'Compte aux.', 'Libelle', 'Debit', 'Credit'],
    entries.map((e) => [e.journal, e.date, e.piece, e.compte_num, e.compte_lib, e.aux_num, e.libelle, fr(e.debit), fr(e.credit)]));
});

route('GET', '/api/accounting/export/ventes.csv', async (ctx) => {
  const { from, to } = periodOf(ctx);
  const rows = db.prepare(`SELECT i.ref, i.type, i.date_invoice, t.code, t.name, i.total_ht, i.total_tva, i.total_ttc, i.status
    FROM invoices i JOIN thirdparties t ON t.id = i.fk_client
    WHERE i.status >= 1 AND i.date_invoice >= ? AND i.date_invoice <= ? ORDER BY i.date_invoice, i.id`).all(from, to);
  sendCsv(ctx, `ventes_${from}_${to}.csv`,
    ['Ref', 'Type', 'Date', 'Code client', 'Client', 'Total HT', 'Total TVA', 'Total TTC', 'Statut'],
    rows.map((r) => [r.ref, r.type, r.date_invoice, r.code, r.name, fr(r.total_ht), fr(r.total_tva), fr(r.total_ttc),
      r.status === 2 ? 'Reglee' : 'Validee']));
});

/* Export FEC (Fichier des Ecritures Comptables) — format officiel 18 colonnes, separateur tabulation. */
route('GET', '/api/accounting/export/fec.txt', async (ctx) => {
  const { from, to } = periodOf(ctx);
  const entries = buildEntries(from, to);
  const cols = ['JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib',
    'CompAuxNum', 'CompAuxLib', 'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit',
    'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise'];
  const d8 = (d) => String(d || '').replace(/-/g, '');
  const lines = [cols.join('\t')].concat(entries.map((e) => [
    e.journal, e.journal_lib, e.num, d8(e.date), e.compte_num, e.compte_lib,
    e.aux_num, e.aux_lib, e.piece, d8(e.piece_date), e.libelle.replace(/\t/g, ' '),
    fr(e.debit), fr(e.credit), '', '', d8(e.date), '', ''
  ].join('\t')));
  ctx.res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Disposition': `attachment; filename="FEC_${from.replace(/-/g, '')}_${to.replace(/-/g, '')}.txt"`
  });
  ctx.res.end(lines.join('\r\n'));
});
