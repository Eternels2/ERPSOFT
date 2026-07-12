import { GET, POST, DEL } from '../api.js';
import {
  esc, eur, num, fdate, icon, toast, toastErr, modal, confirmDialog, readForm,
  field, input, select, dataTable
} from '../ui.js';

const MODES = [
  { value: 'virement', label: 'Virement' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'cb', label: 'Carte bancaire' },
  { value: 'especes', label: 'Especes' },
  { value: 'avoir', label: 'Imputation d\'un avoir' }
];
const modeLabel = (m) => (MODES.find((x) => x.value === m) || { label: m }).label;

/* ==================== Modale de saisie d'un reglement (partagee) ==================== */
export async function paymentModal({ clientId, onSaved } = {}) {
  const clients = await GET('/api/thirdparties?type=client');
  if (!clients.length) return toast('Aucun client.', 'error');
  const clientOpts = clients.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }));
  const initial = clientId || clientOpts[0].value;

  const { overlay, close } = modal({
    title: 'Nouveau reglement',
    wide: true,
    body: `<div class="form-grid">
        ${field('Client', select('fk_client', clientOpts, initial, clientId ? 'disabled' : ''))}
        ${field('Mode', select('mode', MODES, 'virement'))}
        ${field('Date', input('date_payment', new Date().toISOString().slice(0, 10), 'type="date"'))}
        <span id="pm-avoir-slot"></span>
        ${field('Montant (€)', input('amount', '', 'type="number" step="0.01" min="0.01" required'))}
        ${field('Reference (n° cheque, virement…)', input('reference', ''))}
      </div>
      <div style="display:flex;align-items:center;gap:10px;margin:16px 0 8px">
        <h3 style="font-size:13px;margin:0">Affectation aux factures</h3>
        <button type="button" class="btn sm" id="pm-auto">Repartir automatiquement (plus anciennes d'abord)</button>
        <span style="margin-left:auto;font-size:12.5px;color:var(--text-2)">Affecte : <b id="pm-alloc">0,00 €</b></span>
      </div>
      <div id="pm-invoices"></div>
      <p style="font-size:12px;color:var(--text-3);margin-bottom:0">
        Le montant non affecte reste en credit sur le compte du client (acompte).</p>`,
    footer: `<button class="btn" data-act="c">Annuler</button>
      <button class="btn primary" data-act="s">${icon('check', 14)} Enregistrer le reglement</button>`
  });

  let unpaid = { invoices: [], avoirs: [] };
  const q = (sel) => overlay.querySelector(sel);

  const refreshAlloc = () => {
    let total = 0;
    overlay.querySelectorAll('[data-alloc]').forEach((i) => { total += Number(i.value) || 0; });
    q('#pm-alloc').textContent = eur(total).replace(' €', ' €');
  };

  const renderInvoices = () => {
    q('#pm-invoices').innerHTML = unpaid.invoices.length ? `<div style="max-height:260px;overflow-y:auto"><table class="table">
      <thead><tr><th>Facture</th><th>Echeance</th><th class="num">TTC</th><th class="num">Restant du</th><th class="num" style="width:130px">Affecter (€)</th></tr></thead>
      <tbody>${unpaid.invoices.map((i) => `<tr>
        <td class="main-cell">${esc(i.ref)}<span class="sub">${fdate(i.date_invoice)}</span></td>
        <td>${i.date_due < new Date().toISOString().slice(0, 10) ? `<span class="badge red">${fdate(i.date_due)}</span>` : fdate(i.date_due)}</td>
        <td class="num">${eur(i.total_ttc)}</td>
        <td class="num"><b>${eur(i.remaining)}</b></td>
        <td class="num"><input class="input" type="number" step="0.01" min="0" max="${i.remaining}" data-alloc="${i.id}" style="width:110px"></td>
      </tr>`).join('')}</tbody></table></div>`
      : '<div class="empty" style="padding:18px">Aucune facture en attente pour ce client</div>';
    overlay.querySelectorAll('[data-alloc]').forEach((i) => i.addEventListener('input', refreshAlloc));
    refreshAlloc();
  };

  const renderAvoirSlot = () => {
    const isAvoir = q('[name=mode]').value === 'avoir';
    q('#pm-avoir-slot').innerHTML = isAvoir
      ? field('Avoir a imputer', unpaid.avoirs.length
        ? select('fk_avoir', unpaid.avoirs.map((a) => ({ value: a.id, label: `${a.ref} — solde ${eur(a.remaining)}` })), unpaid.avoirs[0].id)
        : '<div style="color:var(--danger);font-size:13px;padding:8px 0">Aucun avoir disponible pour ce client</div>')
      : '';
    if (isAvoir && unpaid.avoirs.length) {
      const setAmt = () => {
        const a = unpaid.avoirs.find((x) => x.id === Number(q('[name=fk_avoir]').value));
        if (a) q('[name=amount]').value = a.remaining.toFixed(2);
      };
      q('[name=fk_avoir]').addEventListener('change', setAmt);
      setAmt();
    }
  };

  const loadClient = async () => {
    const cid = Number(q('[name=fk_client]').value);
    unpaid = await GET('/api/accounting/unpaid?client=' + cid);
    renderInvoices();
    renderAvoirSlot();
  };

  q('[name=fk_client]').addEventListener('change', loadClient);
  q('[name=mode]').addEventListener('change', renderAvoirSlot);
  q('#pm-auto').addEventListener('click', () => {
    let rest = Number(q('[name=amount]').value) || 0;
    for (const i of unpaid.invoices) {
      const inp = overlay.querySelector(`[data-alloc="${i.id}"]`);
      const a = Math.min(rest, i.remaining);
      inp.value = a > 0 ? a.toFixed(2) : '';
      rest = Math.max(0, rest - a);
    }
    refreshAlloc();
  });
  q('[data-act=c]').onclick = close;
  q('[data-act=s]').onclick = async () => {
    const f = readForm(overlay);
    const allocations = [];
    overlay.querySelectorAll('[data-alloc]').forEach((i) => {
      const a = Number(i.value);
      if (a > 0) allocations.push({ fk_invoice: Number(i.dataset.alloc), amount: a });
    });
    try {
      const r = await POST('/api/payments', { ...f, fk_client: Number(q('[name=fk_client]').value), allocations });
      toast(`Reglement ${r.payment.ref} enregistre.`);
      close();
      if (onSaved) onSaved();
    } catch (e) { toastErr(e); }
  };

  await loadClient();
}

/* ==================== Vue Comptabilite (onglets) ==================== */
const TABS = [
  { key: 'synthese', label: 'Synthese' },
  { key: 'reglements', label: 'Reglements' },
  { key: 'balance', label: 'Balance agee' },
  { key: 'journaux', label: 'Journaux' },
  { key: 'tva', label: 'TVA & exports' }
];

export async function viewAccounting(el, params, ctx) {
  const tab = params.tab && TABS.some((t) => t.key === params.tab) ? params.tab : 'synthese';
  el.innerHTML = `<div class="card">
    <div class="tabs">${TABS.map((t) => `<div class="tab ${t.key === tab ? 'active' : ''}" data-tab="${t.key}">${esc(t.label)}</div>`).join('')}</div>
    <div id="acc-body"></div>
  </div>`;
  el.querySelectorAll('[data-tab]').forEach((t) => t.addEventListener('click', () => ctx.navigate('compta/' + t.dataset.tab)));
  const body = el.querySelector('#acc-body');
  body.innerHTML = '<div class="empty">Chargement…</div>';
  await ({ synthese: tabSynthese, reglements: tabReglements, balance: tabBalance, journaux: tabJournaux, tva: tabTva })[tab](body, ctx);
}

/* -------------------- Synthese -------------------- */
async function tabSynthese(el, ctx) {
  const d = await GET('/api/accounting/dashboard');
  const aged = await GET('/api/accounting/aged');
  el.innerHTML = `<div class="card-body">
    <div class="kpi-grid">
      <div class="kpi"><div class="kpi-label">${icon('euro', 15)} Encours clients (restant du TTC)</div>
        <div class="kpi-value">${eur(d.encours)}</div></div>
      <div class="kpi"><div class="kpi-label">${icon('invoice', 15)} Factures en retard</div>
        <div class="kpi-value" style="color:${d.retards.nb ? 'var(--danger)' : 'inherit'}">${eur(d.retards.montant)}</div>
        <div class="kpi-sub">${num(d.retards.nb)} facture(s) echues</div></div>
      <div class="kpi"><div class="kpi-label">${icon('check', 15)} Encaissements du mois</div>
        <div class="kpi-value">${eur(d.encaissements_mois)}</div>
        <div class="kpi-sub">${eur(d.encaissements_annee)} sur l'annee</div></div>
      <div class="kpi"><div class="kpi-label">${icon('returns', 15)} Avoirs non imputes</div>
        <div class="kpi-value">${eur(d.avoirs_non_imputes)}</div>
        <div class="kpi-sub">${eur(d.avoirs_imputes)} deja imputes</div></div>
    </div>
    <div style="display:flex;gap:10px;margin-bottom:16px">
      <button class="btn primary" id="acc-newpay">${icon('plus', 14)} Nouveau reglement</button>
      <a class="btn" href="#/compta/balance">Voir la balance agee ${icon('arrow', 13)}</a>
    </div>
    <h3 style="font-size:14px;margin-bottom:10px">Encours les plus eleves</h3>
    ${aged.rows.length ? `<table class="table"><thead><tr><th>Client</th><th class="num">Non echu</th><th class="num">En retard</th><th class="num">Total du</th><th class="num">Avoirs dispo</th><th></th></tr></thead>
      <tbody>${aged.rows.slice(0, 8).map((r) => `<tr>
        <td class="main-cell"><a href="#/tiers/${r.client_id}">${esc(r.client_name)}</a></td>
        <td class="num">${eur(r.not_due)}</td>
        <td class="num">${r.total - r.not_due > 0.005 ? `<span class="badge red">${eur(r.d30 + r.d60 + r.d90 + r.d90p)}</span>` : '—'}</td>
        <td class="num"><b>${eur(r.total)}</b></td>
        <td class="num">${r.avoirs ? eur(r.avoirs) : '—'}</td>
        <td class="actions"><a class="btn sm" href="/print/statement/${r.client_id}" target="_blank">${icon('print', 13)} Releve</a></td>
      </tr>`).join('')}</tbody></table>` : '<div class="empty">Aucun encours — tout est regle 🎉</div>'}
  </div>`;
  el.querySelector('#acc-newpay').onclick = () => paymentModal({ onSaved: () => tabSynthese(el, ctx) });
}

/* -------------------- Reglements -------------------- */
async function tabReglements(el, ctx) {
  let q = '';
  const render = async () => {
    const rows = await GET('/api/payments' + (q ? '?q=' + encodeURIComponent(q) : ''));
    el.querySelector('#pay-list').innerHTML = dataTable({
      empty: 'Aucun reglement enregistre',
      columns: [
        { label: 'Ref', render: (p) => `<span class="main-cell">${esc(p.ref)}</span><span class="sub">${fdate(p.date_payment)}</span>` },
        { label: 'Client', render: (p) => esc(p.client_name) },
        { label: 'Mode', render: (p) => `<span class="badge ${p.mode === 'avoir' ? 'orange' : 'blue'}">${esc(modeLabel(p.mode))}${p.avoir_ref ? ' — ' + esc(p.avoir_ref) : ''}</span>` },
        { label: 'Reference', render: (p) => esc(p.reference || '—') },
        { label: 'Montant', cls: 'num', render: (p) => `<b>${eur(p.amount)}</b>` },
        { label: 'Affecte', cls: 'num', render: (p) => p.allocated < p.amount - 0.005
            ? `${eur(p.allocated)} <span class="badge orange">acompte ${eur(p.amount - p.allocated)}</span>` : eur(p.allocated) },
        { label: '', cls: 'actions', render: (p) => `<button class="btn sm" data-detail="${p.id}">Detail</button>
            <button class="btn sm danger" data-del="${p.id}">${icon('trash', 13)}</button>` }
      ],
      rows
    });
    el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!await confirmDialog('Supprimer ce reglement ? Les factures affectees redeviendront dues.', { danger: true, okLabel: 'Supprimer' })) return;
      try { await DEL('/api/payments/' + b.dataset.del); toast('Reglement supprime.'); render(); }
      catch (e) { toastErr(e); }
    }));
    el.querySelectorAll('[data-detail]').forEach((b) => b.addEventListener('click', async () => {
      const p = await GET('/api/payments/' + b.dataset.detail);
      modal({
        title: `Reglement ${p.ref} — ${p.client_name}`,
        body: `<div class="detail-grid" style="margin-bottom:14px">
            <div class="item"><b>Date</b>${fdate(p.date_payment)}</div>
            <div class="item"><b>Mode</b>${esc(modeLabel(p.mode))}${p.avoir_ref ? ' (' + esc(p.avoir_ref) + ')' : ''}</div>
            <div class="item"><b>Montant</b>${eur(p.amount)}</div>
            <div class="item"><b>Reference</b>${esc(p.reference || '—')}</div>
          </div>
          ${p.allocations.length ? `<table class="table"><thead><tr><th>Facture</th><th class="num">TTC</th><th class="num">Affecte</th></tr></thead>
            <tbody>${p.allocations.map((a) => `<tr><td>${esc(a.invoice_ref)}</td><td class="num">${eur(a.total_ttc)}</td><td class="num">${eur(a.amount)}</td></tr>`).join('')}</tbody>
          </table>` : '<div class="empty" style="padding:14px">Non affecte (acompte)</div>'}`,
        footer: '<button class="btn" onclick="this.closest(\'.modal-overlay\').remove()">Fermer</button>'
      });
    }));
  };

  el.innerHTML = `<div class="card-head" style="border-top:1px solid var(--border)">
      <div class="searchbar" style="width:280px">${icon('search')}<input class="input" id="pay-q" placeholder="Ref, client, reference…"></div>
      <div class="spacer"></div>
      <button class="btn primary" id="pay-new">${icon('plus', 14)} Nouveau reglement</button>
    </div>
    <div id="pay-list"></div>`;
  let t;
  el.querySelector('#pay-q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { q = e.target.value; render(); }, 250); });
  el.querySelector('#pay-new').onclick = () => paymentModal({ onSaved: render });
  await render();
}

/* -------------------- Balance agee -------------------- */
async function tabBalance(el) {
  const { rows, totals } = await GET('/api/accounting/aged');
  const cell = (v, danger) => v > 0.005 ? (danger ? `<span class="badge red">${eur(v)}</span>` : eur(v)) : '—';
  el.innerHTML = `<div class="card-body flush">
    ${rows.length ? `<div style="overflow-x:auto"><table class="table">
      <thead><tr><th>Client</th><th class="num">Non echu</th><th class="num">1-30 j</th><th class="num">31-60 j</th>
        <th class="num">61-90 j</th><th class="num">+90 j</th><th class="num">Total du</th><th class="num">Avoirs dispo</th><th></th></tr></thead>
      <tbody>
        ${rows.map((r) => `<tr>
          <td class="main-cell"><a href="#/tiers/${r.client_id}">${esc(r.client_name)}</a></td>
          <td class="num">${cell(r.not_due)}</td>
          <td class="num">${cell(r.d30, true)}</td>
          <td class="num">${cell(r.d60, true)}</td>
          <td class="num">${cell(r.d90, true)}</td>
          <td class="num">${cell(r.d90p, true)}</td>
          <td class="num"><b>${eur(r.total)}</b></td>
          <td class="num">${r.avoirs ? eur(r.avoirs) : '—'}</td>
          <td class="actions"><a class="btn sm" href="/print/statement/${r.client_id}" target="_blank">${icon('print', 13)}</a></td>
        </tr>`).join('')}
        <tr style="background:#fafbfc;font-weight:700">
          <td>TOTAL</td><td class="num">${eur(totals.not_due)}</td><td class="num">${eur(totals.d30)}</td>
          <td class="num">${eur(totals.d60)}</td><td class="num">${eur(totals.d90)}</td><td class="num">${eur(totals.d90p)}</td>
          <td class="num">${eur(totals.total)}</td><td class="num">${eur(totals.avoirs)}</td><td></td></tr>
      </tbody></table></div>` : '<div class="empty">Aucun encours client — tout est regle 🎉</div>'}
  </div>`;
}

/* -------------------- Journaux -------------------- */
function periodInputs(prefix) {
  const y = new Date().getFullYear();
  return `<label class="field" style="width:160px"><span>Du</span><input class="input" type="date" id="${prefix}-from" value="${y}-01-01"></label>
    <label class="field" style="width:160px"><span>Au</span><input class="input" type="date" id="${prefix}-to" value="${y}-12-31"></label>`;
}

async function tabJournaux(el) {
  el.innerHTML = `<div class="card-head" style="border-top:1px solid var(--border)">
      ${periodInputs('jn')}
      <label class="field" style="width:170px"><span>Journal</span>
        <select class="input" id="jn-j"><option value="">Tous</option><option value="VE">VE — Ventes</option><option value="BQ">BQ — Banque</option></select></label>
      <button class="btn primary" id="jn-go" style="align-self:flex-end">Afficher</button>
      <div class="spacer"></div>
      <a class="btn" id="jn-csv" style="align-self:flex-end">${icon('invoice', 14)} Export CSV</a>
    </div>
    <div id="jn-list"><div class="empty">Choisissez une periode puis « Afficher »</div></div>`;

  const load = async () => {
    const from = el.querySelector('#jn-from').value, to = el.querySelector('#jn-to').value, j = el.querySelector('#jn-j').value;
    el.querySelector('#jn-csv').href = `/api/accounting/export/journal.csv?from=${from}&to=${to}`;
    const { entries, totals } = await GET(`/api/accounting/journal?from=${from}&to=${to}${j ? '&journal=' + j : ''}`);
    el.querySelector('#jn-list').innerHTML = entries.length ? `<div style="overflow-x:auto;max-height:520px;overflow-y:auto"><table class="table">
      <thead><tr><th>Jnl</th><th>Date</th><th>Piece</th><th>Compte</th><th>Tiers</th><th>Libelle</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
      <tbody>${entries.map((e) => `<tr>
        <td><span class="badge ${e.journal === 'VE' ? 'blue' : 'green'}">${e.journal}</span></td>
        <td>${fdate(e.date)}</td><td>${esc(e.piece)}</td>
        <td>${esc(e.compte_num)}<span class="sub">${esc(e.compte_lib)}</span></td>
        <td>${esc(e.aux_num || '')}</td>
        <td style="font-size:12.5px">${esc(e.libelle)}</td>
        <td class="num">${e.debit ? eur(e.debit) : ''}</td><td class="num">${e.credit ? eur(e.credit) : ''}</td></tr>`).join('')}
        <tr style="background:#fafbfc;font-weight:700"><td colspan="6">TOTAL (equilibre)</td>
          <td class="num">${eur(totals.debit)}</td><td class="num">${eur(totals.credit)}</td></tr>
      </tbody></table></div>` : '<div class="empty">Aucune ecriture sur la periode</div>';
  };
  el.querySelector('#jn-go').onclick = load;
  await load();
}

/* -------------------- TVA & exports -------------------- */
async function tabTva(el) {
  el.innerHTML = `<div class="card-head" style="border-top:1px solid var(--border)">
      ${periodInputs('tv')}
      <button class="btn primary" id="tv-go" style="align-self:flex-end">Calculer</button>
    </div>
    <div id="tv-body"></div>
    <div class="card-body" style="border-top:1px solid var(--border)">
      <h3 style="font-size:14px;margin-bottom:6px">Exports pour l'expert-comptable</h3>
      <p style="color:var(--text-2);font-size:13px;margin-top:0">Les exports portent sur la periode selectionnee ci-dessus.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <a class="btn" id="ex-ventes">${icon('invoice', 14)} Journal des ventes (CSV)</a>
        <a class="btn" id="ex-journal">${icon('queue', 14)} Ecritures comptables (CSV)</a>
        <a class="btn" id="ex-fec">${icon('check', 14)} Export FEC (format officiel)</a>
      </div>
    </div>`;

  const load = async () => {
    const from = el.querySelector('#tv-from').value, to = el.querySelector('#tv-to').value;
    el.querySelector('#ex-ventes').href = `/api/accounting/export/ventes.csv?from=${from}&to=${to}`;
    el.querySelector('#ex-journal').href = `/api/accounting/export/journal.csv?from=${from}&to=${to}`;
    el.querySelector('#ex-fec').href = `/api/accounting/export/fec.txt?from=${from}&to=${to}`;
    const { rows, total } = await GET(`/api/accounting/vat?from=${from}&to=${to}`);
    el.querySelector('#tv-body').innerHTML = `<div class="card-body flush">
      ${rows.length ? `<table class="table">
        <thead><tr><th>Taux de TVA</th><th class="num">Base HT (avoirs deduits)</th><th class="num">TVA collectee</th></tr></thead>
        <tbody>${rows.map((r) => `<tr>
          <td class="main-cell">${r.tva_rate} %</td>
          <td class="num">${eur(r.base_ht)}</td>
          <td class="num"><b>${eur(r.tva)}</b></td></tr>`).join('')}
          <tr style="background:#fafbfc;font-weight:700"><td>TOTAL</td>
            <td class="num">${eur(total.base_ht)}</td><td class="num">${eur(total.tva)}</td></tr>
        </tbody></table>` : '<div class="empty">Aucune facturation sur la periode</div>'}
    </div>`;
  };
  el.querySelector('#tv-go').onclick = load;
  await load();
}
