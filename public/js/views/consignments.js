import { GET, POST, PUT, DEL } from '../api.js';
import {
  esc, eur, num, fdate, icon, toast, toastErr, modal, confirmDialog, readForm,
  field, input, select, dataTable
} from '../ui.js';
import { productPicker, clientSelectOptions } from './orders.js';

const statusBadge = (s) => s === 2 ? '<span class="badge dot green">Facture</span>'
  : s === 1 ? '<span class="badge dot blue">Valide — en depot</span>'
    : '<span class="badge dot">Brouillon</span>';

export async function viewConsignments(el, params, ctx) {
  let status = '', q = '';
  const render = async () => {
    const rows = await GET(`/api/consignments?status=${status}` + (q ? '&q=' + encodeURIComponent(q) : ''));
    el.querySelector('#clist').innerHTML = dataTable({
      empty: 'Aucun depot-vente',
      columns: [
        { label: 'Ref', render: (c) => `<span class="main-cell">${esc(c.ref)}</span><span class="sub">${fdate(c.date_consignment)}</span>` },
        { label: 'Client', render: (c) => esc(c.client_name) },
        { label: 'Livree', cls: 'num', render: (c) => num(c.qty_delivered) },
        { label: 'Retournee', cls: 'num', render: (c) => num(c.qty_returned) },
        { label: 'Restante', cls: 'num', render: (c) => `<span class="badge blue">${num(c.qty_delivered - c.qty_returned)}</span>` },
        { label: 'Valeur HT', cls: 'num', render: (c) => eur(c.total_ht) },
        { label: 'Statut', render: (c) => statusBadge(c.status) }
      ],
      rows,
      onRow: true,
      rowAttrs: (c) => `onclick="location.hash='#/consignments/${c.id}'"`
    });
  };

  el.innerHTML = `<div class="card">
    <div class="card-head">
      <div class="searchbar" style="width:280px">${icon('search')}<input class="input" id="csearch" placeholder="Ref, client…"></div>
      <select class="input" id="cstatus" style="width:190px">
        <option value="">Tous les statuts</option>
        <option value="0">Brouillon</option><option value="1">Valide — en depot</option><option value="2">Facture</option>
      </select>
      <div class="spacer"></div>
      <button class="btn primary" id="cnew">${icon('plus', 15)} Nouveau depot-vente</button>
    </div>
    <div class="card-body flush" id="clist"></div>
  </div>`;

  let t;
  el.querySelector('#csearch').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { q = e.target.value; render(); }, 250); });
  el.querySelector('#cstatus').addEventListener('change', (e) => { status = e.target.value; render(); });
  el.querySelector('#cnew').addEventListener('click', async () => {
    const opts = await clientSelectOptions();
    if (!opts.length) return toast('Creez d\'abord un client.', 'error');
    const { overlay, close } = modal({
      title: 'Nouveau depot-vente',
      body: `<div class="form-grid">
        ${field('Client depositaire', select('fk_client', opts, opts[0].value), 'wide')}
        ${field('Date du depot', input('date_consignment', new Date().toISOString().slice(0, 10), 'type="date"'))}
        ${field('Note', `<textarea class="input" name="note" rows="2"></textarea>`, 'wide')}
      </div>`,
      footer: `<button class="btn" data-act="c">Annuler</button><button class="btn primary" data-act="s">Creer</button>`
    });
    overlay.querySelector('[data-act=c]').onclick = close;
    overlay.querySelector('[data-act=s]').onclick = async () => {
      try {
        const r = await POST('/api/consignments', readForm(overlay));
        toast(`Depot-vente ${r.ref} cree.`);
        close();
        ctx.navigate('consignments/' + r.id);
      } catch (e) { toastErr(e); }
    };
  });
  await render();
}

export async function viewConsignment(el, params, ctx) {
  const render = async () => {
    const c = await GET('/api/consignments/' + params.id);
    const isDraft = c.status === 0;
    const isActive = c.status === 1;

    el.innerHTML = `
      <div style="margin-bottom:14px"><a href="#/consignments">${icon('returns', 13)} Retour aux depots-vente</a></div>
      <div class="card">
        <div class="card-head">
          <h2 style="font-size:17px">Depot-vente ${esc(c.ref)}</h2>
          ${statusBadge(c.status)}
          <div class="spacer"></div>
          <a class="btn" href="/print/consignment/${c.id}" target="_blank">${icon('print', 14)} Bon de depot</a>
          ${isDraft ? `<button class="btn primary" id="cvalidate">${icon('check', 14)} Valider (sortie stock)</button>` : ''}
          ${isActive && !c.fk_invoice ? `<button class="btn primary" id="cinvoice">${icon('invoice', 14)} Generer la facture</button>` : ''}
          ${c.fk_invoice ? `<a class="btn" href="/print/invoice/${c.fk_invoice}" target="_blank">${icon('invoice', 14)} ${esc(c.invoice_ref)}</a>` : ''}
          ${isDraft ? `<button class="btn danger" id="cdelete">${icon('trash', 14)}</button>` : ''}
        </div>
        <div class="card-body">
          <div class="detail-grid">
            <div class="item"><b>Client</b><a href="#/tiers/${c.fk_client}">${esc(c.client_name)}</a></div>
            <div class="item"><b>Date du depot</b>${fdate(c.date_consignment)}</div>
            <div class="item"><b>Valeur deposee HT</b>${eur(c.total_ht)}</div>
            <div class="item"><b>Valeur restante HT</b>${eur(c.sold_ht)}</div>
          </div>
          ${c.note ? `<p style="color:var(--text-2);margin-bottom:0"><b>Note :</b> ${esc(c.note)}</p>` : ''}
        </div>
      </div>

      <div class="card" style="margin-top:18px">
        <div class="card-head"><h2>Lignes (${c.lines.length})</h2>
          <div class="spacer"></div>
          ${isDraft ? `<button class="btn primary sm" id="caddline">${icon('plus', 13)} Ajouter un livre</button>` : ''}
        </div>
        <div class="card-body flush">
          ${c.lines.length ? `<table class="table">
            <thead><tr><th>Livre</th><th class="num">Livree</th><th class="num">Retournee</th><th class="num">Restante</th>
              <th class="num">PU HT</th><th class="num">Total restant HT</th><th class="actions">${isActive ? 'Retour' : ''}</th></tr></thead>
            <tbody>${c.lines.map((l) => {
              const remaining = l.qty_delivered - l.qty_returned;
              return `<tr>
                <td class="main-cell"><a href="#/products/${l.fk_product}">${esc(l.title)}</a><span class="sub">${esc(l.isbn)}</span></td>
                <td class="num">${isDraft ? `<input class="input" style="width:75px" type="number" min="1" value="${l.qty_delivered}" data-lqty="${l.id}">` : num(l.qty_delivered)}</td>
                <td class="num">${num(l.qty_returned)}</td>
                <td class="num"><span class="badge ${remaining > 0 ? 'blue' : ''}">${num(remaining)}</span></td>
                <td class="num">${isDraft ? `<input class="input" style="width:90px" type="number" step="0.01" value="${l.price_ht}" data-lprice="${l.id}">` : eur(l.price_ht)}</td>
                <td class="num">${eur(remaining * l.price_ht)}</td>
                <td class="actions">
                  ${isActive && remaining > 0 ? `<span style="display:inline-flex;gap:6px;align-items:center">
                    <input class="input" style="width:70px" type="number" min="1" max="${remaining}" placeholder="Qte" data-rqty="${l.id}">
                    <button class="btn sm" data-rbtn="${l.id}">${icon('returns', 13)} Retour</button></span>` : ''}
                  ${isDraft ? `<button class="btn sm danger" data-ldel="${l.id}">${icon('trash', 13)}</button>` : ''}
                </td></tr>`;
            }).join('')}</tbody></table>` : '<div class="empty">Aucune ligne — ajoutez des livres</div>'}
        </div>
      </div>`;

    const on = (sel, fn) => { const b = el.querySelector(sel); if (b) b.onclick = fn; };

    on('#cvalidate', async () => {
      if (!await confirmDialog('Valider le depot-vente ? Le stock sortira de l\'entrepot.')) return;
      try { await POST(`/api/consignments/${c.id}/validate`); toast('Depot-vente valide, stock sorti.'); render(); }
      catch (e) { toastErr(e); }
    });
    on('#cinvoice', async () => {
      if (!await confirmDialog('Generer la facture pour la quantite vendue (livree - retournee) ?')) return;
      try {
        const r = await POST(`/api/consignments/${c.id}/invoice`);
        toast(`Facture ${r.invoice.ref} generee (${eur(r.invoice.total_ttc)} TTC).`);
        render();
      } catch (e) { toastErr(e); }
    });
    on('#cdelete', async () => {
      if (!await confirmDialog('Supprimer ce depot-vente ?', { danger: true, okLabel: 'Supprimer' })) return;
      try { await DEL('/api/consignments/' + c.id); toast('Depot-vente supprime.'); ctx.navigate('consignments'); }
      catch (e) { toastErr(e); }
    });
    on('#caddline', () => productPicker(async (p, qty) => {
      try { await POST(`/api/consignments/${c.id}/lines`, { fk_product: p.id, qty }); toast(`${p.title} ajoute.`); render(); }
      catch (e) { toastErr(e); }
    }));

    el.querySelectorAll('[data-lqty]').forEach((inp) => inp.addEventListener('change', async () => {
      try { await PUT(`/api/consignments/${c.id}/lines/${inp.dataset.lqty}`, { qty_delivered: inp.value }); render(); }
      catch (e) { toastErr(e); render(); }
    }));
    el.querySelectorAll('[data-lprice]').forEach((inp) => inp.addEventListener('change', async () => {
      try { await PUT(`/api/consignments/${c.id}/lines/${inp.dataset.lprice}`, { price_ht: inp.value }); render(); }
      catch (e) { toastErr(e); render(); }
    }));
    el.querySelectorAll('[data-ldel]').forEach((btn) => btn.addEventListener('click', async () => {
      try { await DEL(`/api/consignments/${c.id}/lines/${btn.dataset.ldel}`); render(); }
      catch (e) { toastErr(e); }
    }));
    el.querySelectorAll('[data-rbtn]').forEach((btn) => btn.addEventListener('click', async () => {
      const inp = el.querySelector(`[data-rqty="${btn.dataset.rbtn}"]`);
      const qty = Number(inp.value);
      if (!qty || qty <= 0) return toast('Saisissez la quantite de retour.', 'error');
      try {
        await POST(`/api/consignments/${c.id}/return`, { line_id: btn.dataset.rbtn, qty });
        toast('Retour enregistre, stock reintegre.');
        render();
      } catch (e) { toastErr(e); }
    }));
  };
  await render();
}
