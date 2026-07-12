import { GET } from '../api.js';
import { esc, eur, fdate, icon, dataTable } from '../ui.js';
import { paymentModal } from './accounting.js';

const sourceLink = (i) => {
  if (i.source_type === 'commande') return `#/orders/${i.source_id}`;
  if (i.source_type === 'depot-vente') return `#/consignments/${i.source_id}`;
  if (i.source_type === 'retour') return `#/returns/${i.source_id}`;
  return null;
};

const statusBadge = (i) => {
  if (i.status === 2) return i.type === 'avoir' ? '<span class="badge dot green">Impute</span>' : '<span class="badge dot green">Reglee</span>';
  if (i.overdue) return '<span class="badge dot red">En retard</span>';
  if (i.paid > 0.005) return '<span class="badge dot orange">Partiellement reglee</span>';
  return '<span class="badge dot blue">Validee</span>';
};

export async function viewInvoices(el) {
  let type = '', status = '', q = '', unpaidOnly = false;
  const render = async () => {
    const rows = await GET(`/api/invoices?type=${type}&status=${status}${unpaidOnly ? '&unpaid=1' : ''}` + (q ? '&q=' + encodeURIComponent(q) : ''));
    el.querySelector('#ilist').innerHTML = dataTable({
      empty: 'Aucune facture',
      columns: [
        { label: 'Ref', render: (i) => `<span class="main-cell">${esc(i.ref)}</span><span class="sub">${fdate(i.date_invoice)}</span>` },
        { label: 'Type', render: (i) => i.type === 'avoir' ? '<span class="badge orange">Avoir</span>' : '<span class="badge">Facture</span>' },
        { label: 'Client', render: (i) => esc(i.client_name) },
        { label: 'Origine', render: (i) => {
            const link = sourceLink(i);
            return link ? `<a href="${link}">${esc(i.note || i.source_type)}</a>` : esc(i.source_type || '—');
          } },
        { label: 'Echeance', render: (i) => i.type === 'avoir' ? '—'
            : (i.overdue ? `<span class="badge red">${fdate(i.date_due_eff)}</span>` : fdate(i.date_due_eff)) },
        { label: 'Total TTC', cls: 'num', render: (i) => `<b>${eur(i.total_ttc)}</b>` },
        { label: (unpaidOnly ? 'Restant du' : 'Restant'), cls: 'num', render: (i) =>
            i.remaining > 0.005 ? `<span class="badge ${i.type === 'avoir' ? 'orange' : i.overdue ? 'red' : 'blue'}">${eur(i.remaining)}</span>` : '—' },
        { label: 'Statut', render: (i) => statusBadge(i) },
        { label: '', cls: 'actions', render: (i) => `
            <a class="btn sm" href="/print/invoice/${i.id}" target="_blank">${icon('print', 13)}</a>
            ${i.type === 'facture' && i.remaining > 0.005 ? `<button class="btn sm primary" data-pay="${i.fk_client}">Regler</button>` : ''}` }
      ],
      rows
    });
    el.querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', () =>
      paymentModal({ clientId: Number(b.dataset.pay), onSaved: render })));
  };

  el.innerHTML = `<div class="card">
    <div class="card-head">
      <div class="searchbar" style="width:240px">${icon('search')}<input class="input" id="isearch" placeholder="Ref, client…"></div>
      <select class="input" id="itype" style="width:140px">
        <option value="">Tous types</option><option value="facture">Factures</option><option value="avoir">Avoirs</option>
      </select>
      <select class="input" id="istatus" style="width:150px">
        <option value="">Tous statuts</option><option value="1">Validees</option><option value="2">Reglees</option>
      </select>
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-2)">
        <input type="checkbox" id="iunpaid"> Restant du uniquement</label>
      <div class="spacer"></div>
      <a class="btn" href="#/compta/reglements">${icon('euro', 14)} Reglements</a>
    </div>
    <div class="card-body flush" id="ilist"></div>
  </div>`;

  let t;
  el.querySelector('#isearch').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { q = e.target.value; render(); }, 250); });
  el.querySelector('#itype').addEventListener('change', (e) => { type = e.target.value; render(); });
  el.querySelector('#istatus').addEventListener('change', (e) => { status = e.target.value; render(); });
  el.querySelector('#iunpaid').addEventListener('change', (e) => { unpaidOnly = e.target.checked; render(); });
  await render();
}
