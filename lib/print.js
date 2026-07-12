'use strict';
/* Documents imprimables (HTML optimise impression / export PDF via le navigateur). */
const { db, getSetting } = require('./db');
const { route, ApiError, getSession } = require('./web');
const { round2 } = require('./services');
const { getInvoice } = require('../api/invoices');
const { getContainer } = require('../api/containers');
const { getOrder } = require('../api/orders');
const { getConsignment } = require('../api/consignments');

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const eur = (n) => (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const fdate = (d) => d ? new Date(d).toLocaleDateString('fr-FR') : '';

function company() {
  return {
    name: getSetting('company_name', 'ERPSOFT'),
    address: getSetting('company_address', ''),
    zip: getSetting('company_zip', ''),
    town: getSetting('company_town', ''),
    phone: getSetting('company_phone', ''),
    email: getSetting('company_email', ''),
    siret: getSetting('company_siret', ''),
    tva: getSetting('company_tva', '')
  };
}

function page(title, body) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font: 13px/1.5 'Segoe UI', Arial, sans-serif; color: #1a2233; margin: 0; padding: 40px; }
  .doc { max-width: 800px; margin: 0 auto; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; }
  .brand { font-size: 22px; font-weight: 700; color: #14532d; }
  .brand small { display: block; font-size: 11px; font-weight: 400; color: #64748b; margin-top: 4px; white-space: pre-line; }
  .doctitle { text-align: right; }
  .doctitle h1 { margin: 0; font-size: 20px; letter-spacing: 0.5px; }
  .doctitle .ref { font-size: 15px; color: #334155; font-weight: 600; }
  .doctitle .date { color: #64748b; font-size: 12px; }
  .parties { display: flex; justify-content: flex-end; margin-bottom: 28px; }
  .party { border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 18px; min-width: 260px; }
  .party h3 { margin: 0 0 6px; font-size: 11px; text-transform: uppercase; color: #64748b; letter-spacing: 1px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #475569; border-bottom: 2px solid #14532d; padding: 8px 10px; }
  td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  .num { text-align: right; white-space: nowrap; }
  .totals { margin-left: auto; width: 280px; }
  .totals td { border: none; padding: 5px 10px; }
  .totals .grand td { border-top: 2px solid #14532d; font-weight: 700; font-size: 15px; }
  .footer { margin-top: 48px; padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 10px; color: #94a3b8; text-align: center; }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; background: #f1f5f9; }
  .note { background: #f8fafc; border-radius: 8px; padding: 10px 14px; color: #475569; margin-bottom: 20px; }
  .toolbar { position: fixed; top: 12px; right: 12px; }
  .toolbar button { background: #14532d; color: #fff; border: 0; border-radius: 8px; padding: 10px 20px; font-size: 14px; cursor: pointer; }
  @media print { .toolbar { display: none; } body { padding: 0; } }
</style></head><body>
<div class="toolbar"><button onclick="window.print()">Imprimer / PDF</button></div>
<div class="doc">${body}</div>
</body></html>`;
}

function header(doctitle, ref, date, extra = '') {
  const co = company();
  return `<div class="head">
    <div class="brand">${esc(co.name)}<small>${esc(co.address)}
${esc(co.zip)} ${esc(co.town)}
${esc(co.phone)} — ${esc(co.email)}</small></div>
    <div class="doctitle"><h1>${esc(doctitle)}</h1>
      <div class="ref">${esc(ref)}</div>
      <div class="date">${fdate(date)}</div>${extra}</div>
  </div>`;
}

function partyBlock(label, t) {
  return `<div class="parties"><div class="party"><h3>${esc(label)}</h3>
    <strong>${esc(t.name)}</strong><br>${esc(t.address || '')}<br>${esc(t.zip || '')} ${esc(t.town || '')}<br>${esc(t.country || '')}</div></div>`;
}

function sendHtml(ctx, html) {
  ctx.res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  ctx.res.end(html);
}

/* --------- Facture / Avoir --------- */
route('GET', '/print/invoice/:id', async (ctx) => {
  const i = getInvoice(ctx.params.id);
  // Un client du portail ne peut imprimer que ses propres factures.
  if (ctx.session.type === 'portal' && ctx.session.client.id !== i.fk_client) throw new ApiError(403, 'Acces refuse');
  const co = company();
  const isAvoir = i.type === 'avoir';
  const rows = i.lines.map((l) => `<tr>
      <td>${esc(l.label)}</td>
      <td class="num">${l.qty}</td>
      <td class="num">${eur(l.price_ht)}</td>
      <td class="num">${l.tva_rate}%</td>
      <td class="num">${eur(l.total_ht)}</td></tr>`).join('');
  const body = header(isAvoir ? 'AVOIR' : 'FACTURE', i.ref, i.date_invoice,
    i.status === 2 ? '<div style="margin-top:6px"><span class="badge" style="background:#dcfce7;color:#14532d">Reglee</span></div>' : '')
    + partyBlock(isAvoir ? 'Avoir au profit de' : 'Facture a', i)
    + (i.note ? `<div class="note">${esc(i.note)}</div>` : '')
    + `<table><thead><tr><th>Designation</th><th class="num">Qte</th><th class="num">PU HT</th><th class="num">TVA</th><th class="num">Total HT</th></tr></thead>
      <tbody>${rows}</tbody></table>
    <table class="totals">
      <tr><td>Total HT</td><td class="num">${eur(i.total_ht)}</td></tr>
      <tr><td>TVA</td><td class="num">${eur(i.total_tva)}</td></tr>
      <tr class="grand"><td>Total TTC${isAvoir ? ' (avoir)' : ''}</td><td class="num">${eur(i.total_ttc)}</td></tr>
    </table>
    <div class="footer">${esc(co.name)} — SIRET ${esc(co.siret)} — TVA ${esc(co.tva)}</div>`;
  sendHtml(ctx, page(`${isAvoir ? 'Avoir' : 'Facture'} ${i.ref}`, body));
}, { auth: 'any' });

/* --------- Bordereau conteneur fournisseur --------- */
route('GET', '/print/container/:id', async (ctx) => {
  const c = getContainer(ctx.params.id);
  const supplier = db.prepare('SELECT * FROM thirdparties WHERE id = ?').get(c.fk_supplier);
  const rows = c.lines.map((l) => `<tr>
      <td>${esc(l.isbn)}</td><td>${esc(l.title)}</td><td>${esc(l.publisher || '')}</td>
      <td>${esc(l.return_ref)}</td><td class="num">${l.qty}</td></tr>`).join('');
  const body = header('BORDEREAU DE RETOUR FOURNISSEUR', c.ref, c.date_shipped || c.date_creation,
    c.supplier_return_number ? `<div style="margin-top:6px">N° retour fournisseur : <strong>${esc(c.supplier_return_number)}</strong></div>` : '')
    + partyBlock('Destinataire', supplier)
    + `<table><thead><tr><th>ISBN</th><th>Titre</th><th>Editeur</th><th>Retour</th><th class="num">Qte</th></tr></thead>
      <tbody>${rows}</tbody></table>
    <table class="totals"><tr class="grand"><td>Total exemplaires</td><td class="num">${c.nb_books}</td></tr></table>
    <div class="footer">Conteneur ${esc(c.ref)} — ${c.status === 1 ? 'Expedie le ' + fdate(c.date_shipped) : 'Ouvert'}</div>`;
  sendHtml(ctx, page(`Bordereau ${c.ref}`, body));
});

/* --------- Bon de preparation d'une commande --------- */
route('GET', '/print/order/:id', async (ctx) => {
  const o = getOrder(ctx.params.id);
  const client = db.prepare('SELECT * FROM thirdparties WHERE id = ?').get(o.fk_client);
  const rows = o.lines.map((l) => `<tr>
      <td>${esc(l.isbn)}</td><td>${esc(l.title)}<br><small style="color:#64748b">${esc(l.author || '')}</small></td>
      <td>${esc(l.locations || '—')}</td>
      <td class="num">${l.qty}</td><td class="num">${l.qty_picked}</td></tr>`).join('');
  const body = header('BON DE PREPARATION', o.ref, o.date_order,
    `<div style="margin-top:6px"><span class="badge">${esc(o.order_type)}</span> <span class="badge">Priorite ${o.priority}</span></div>`)
    + partyBlock('Client', client)
    + (o.note ? `<div class="note">${esc(o.note)}</div>` : '')
    + `<table><thead><tr><th>ISBN</th><th>Titre</th><th>Gisements</th><th class="num">Qte</th><th class="num">Preparee</th></tr></thead>
      <tbody>${rows}</tbody></table>
    <table class="totals"><tr class="grand"><td>Total exemplaires</td><td class="num">${o.qty_total}</td></tr></table>`;
  sendHtml(ctx, page(`Bon de preparation ${o.ref}`, body));
});

/* --------- Releve de compte client --------- */
route('GET', '/print/statement/:clientId', async (ctx) => {
  const client = db.prepare("SELECT * FROM thirdparties WHERE id = ? AND type = 'client'").get(Number(ctx.params.clientId));
  if (!client) throw new ApiError(404, 'Client introuvable');

  const invoices = db.prepare(`SELECT date_invoice AS d, ref, type, total_ttc FROM invoices
    WHERE fk_client = ? AND status >= 1`).all(client.id)
    .map((i) => ({
      d: i.d, ref: i.ref,
      label: i.type === 'avoir' ? 'Avoir' : 'Facture',
      debit: i.type === 'avoir' ? 0 : i.total_ttc,
      credit: i.type === 'avoir' ? i.total_ttc : 0
    }));
  const payments = db.prepare(`SELECT date_payment AS d, ref, mode, amount FROM payments
    WHERE fk_client = ? AND mode != 'avoir'`).all(client.id)
    .map((p) => ({ d: p.d, ref: p.ref, label: 'Reglement (' + p.mode + ')', debit: 0, credit: p.amount }));
  const rows = invoices.concat(payments).sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : a.ref < b.ref ? -1 : 1);

  let balance = 0;
  const body = header('RELEVE DE COMPTE', client.code, new Date().toISOString().slice(0, 10))
    + partyBlock('Client', client)
    + `<table><thead><tr><th>Date</th><th>Piece</th><th>Libelle</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Solde</th></tr></thead>
      <tbody>${rows.map((r) => {
        balance = round2(balance + r.debit - r.credit);
        return `<tr><td>${fdate(r.d)}</td><td>${esc(r.ref)}</td><td>${esc(r.label)}</td>
          <td class="num">${r.debit ? eur(r.debit) : ''}</td><td class="num">${r.credit ? eur(r.credit) : ''}</td>
          <td class="num">${eur(balance)}</td></tr>`;
      }).join('')}</tbody></table>
    <table class="totals"><tr class="grand"><td>Solde du (TTC)</td><td class="num">${eur(balance)}</td></tr></table>
    <div class="footer">Un solde positif correspond aux sommes restant a regler par le client.</div>`;
  sendHtml(ctx, page(`Releve ${client.code}`, body));
});

/* --------- Bon de depot-vente --------- */
route('GET', '/print/consignment/:id', async (ctx) => {
  const c = getConsignment(ctx.params.id);
  const client = db.prepare('SELECT * FROM thirdparties WHERE id = ?').get(c.fk_client);
  const rows = c.lines.map((l) => `<tr>
      <td>${esc(l.isbn)}</td><td>${esc(l.title)}</td>
      <td class="num">${l.qty_delivered}</td><td class="num">${l.qty_returned}</td>
      <td class="num">${l.qty_delivered - l.qty_returned}</td>
      <td class="num">${eur(l.price_ht)}</td>
      <td class="num">${eur(round2((l.qty_delivered - l.qty_returned) * l.price_ht))}</td></tr>`).join('');
  const body = header('BON DE DEPOT-VENTE', c.ref, c.date_consignment)
    + partyBlock('Depositaire', client)
    + (c.note ? `<div class="note">${esc(c.note)}</div>` : '')
    + `<table><thead><tr><th>ISBN</th><th>Titre</th><th class="num">Livree</th><th class="num">Retournee</th><th class="num">Restante</th><th class="num">PU HT</th><th class="num">Total HT</th></tr></thead>
      <tbody>${rows}</tbody></table>
    <table class="totals">
      <tr><td>Valeur deposee HT</td><td class="num">${eur(c.total_ht)}</td></tr>
      <tr class="grand"><td>Valeur restante HT</td><td class="num">${eur(c.sold_ht)}</td></tr>
    </table>`;
  sendHtml(ctx, page(`Depot-vente ${c.ref}`, body));
});
