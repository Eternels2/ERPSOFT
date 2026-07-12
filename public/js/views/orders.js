import { GET, POST, PUT, DEL } from '../api.js';
import {
  esc, eur, num, fdate, icon, toast, toastErr, modal, confirmDialog, readForm,
  field, input, select, dataTable, orderStatusBadge, orderTypeLabel, ORDER_TYPES
} from '../ui.js';

/* Selecteur de livre avec recherche : appelle onPick(product, qty). */
export function productPicker(onPick, { withQty = true } = {}) {
  const { overlay, close } = modal({
    title: 'Ajouter un livre',
    wide: true,
    body: `<div class="searchbar" style="margin-bottom:12px">${icon('search')}
      <input class="input" id="ppk-q" placeholder="Titre, auteur, ISBN… (scannez un code-barres)"></div>
      ${withQty ? `<div style="display:flex;gap:10px;align-items:center;margin-bottom:12px">
        <span class="field-label" style="margin:0">Quantite :</span>
        <input class="input" id="ppk-qty" type="number" min="1" value="1" style="width:90px"></div>` : ''}
      <div id="ppk-list" style="max-height:380px;overflow-y:auto"></div>`
  });
  const listEl = overlay.querySelector('#ppk-list');
  const qEl = overlay.querySelector('#ppk-q');
  const getQty = () => withQty ? Math.max(1, Number(overlay.querySelector('#ppk-qty').value) || 1) : 1;

  const renderList = async (q) => {
    const rows = await GET('/api/products' + (q ? '?q=' + encodeURIComponent(q) : ''));
    listEl.innerHTML = dataTable({
      empty: 'Aucun livre trouve',
      columns: [
        { label: 'Titre', render: (p) => `<span class="main-cell">${esc(p.title)}</span><span class="sub">${esc(p.author || '')} — ${esc(p.isbn)}</span>` },
        { label: 'Prix HT', cls: 'num', render: (p) => eur(p.price_ht) },
        { label: 'Stock', cls: 'num', render: (p) => `<span class="badge ${p.stock_main <= 0 ? 'red' : p.stock_main <= 10 ? 'orange' : 'green'}">${num(p.stock_main)}</span>` }
      ],
      rows: rows.slice(0, 30),
      onRow: true,
      rowAttrs: (p, i) => `data-pick="${i}"`
    });
    listEl.querySelectorAll('[data-pick]').forEach((tr) => {
      tr.addEventListener('click', () => { onPick(rows[Number(tr.dataset.pick)], getQty()); close(); });
    });
  };
  let t;
  qEl.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => renderList(qEl.value), 220); });
  qEl.addEventListener('keydown', (e) => {
    // Scan douchette : Entree -> si un seul resultat, on le prend
    if (e.key === 'Enter') {
      const first = listEl.querySelector('[data-pick]');
      if (first) first.click();
    }
  });
  renderList('');
}

export async function clientSelectOptions() {
  const clients = await GET('/api/thirdparties?type=client');
  return clients.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }));
}

async function newOrderModal(ctx) {
  const opts = await clientSelectOptions();
  if (!opts.length) return toast('Creez d\'abord un client.', 'error');
  const { overlay, close } = modal({
    title: 'Nouvelle commande',
    body: `<div class="form-grid">
      ${field('Client', select('fk_client', opts, opts[0].value), 'wide')}
      ${field('Type de commande', select('order_type', ORDER_TYPES, 'livraison'))}
      ${field('Priorite (1 = urgent)', input('priority', 5, 'type="number" min="1" max="9"'))}
      ${field('Note', `<textarea class="input" name="note" rows="2"></textarea>`, 'wide')}
    </div>`,
    footer: `<button class="btn" data-act="c">Annuler</button><button class="btn primary" data-act="s">Creer la commande</button>`
  });
  overlay.querySelector('[data-act=c]').onclick = close;
  overlay.querySelector('[data-act=s]').onclick = async () => {
    try {
      const r = await POST('/api/orders', readForm(overlay));
      toast(`Commande ${r.ref} creee.`);
      close();
      ctx.navigate('orders/' + r.id);
    } catch (e) { toastErr(e); }
  };
}

export async function viewOrders(el, params, ctx) {
  let status = '', q = '';
  const render = async () => {
    const rows = await GET(`/api/orders?status=${status}` + (q ? '&q=' + encodeURIComponent(q) : ''));
    el.querySelector('#olist').innerHTML = dataTable({
      empty: 'Aucune commande',
      columns: [
        { label: 'Ref', render: (o) => `<span class="main-cell">${esc(o.ref)}</span><span class="sub">${fdate(o.date_order)}${o.source === 'portail' ? ' — portail' : ''}</span>` },
        { label: 'Client', render: (o) => esc(o.client_name) },
        { label: 'Type', render: (o) => `<span class="badge">${esc(orderTypeLabel(o.order_type))}</span>` },
        { label: 'Prio', cls: 'num', render: (o) => 'P' + o.priority },
        { label: 'Exemplaires', cls: 'num', render: (o) => `${num(o.qty_picked)} / ${num(o.qty_total)}` },
        { label: 'Total HT', cls: 'num', render: (o) => eur(o.total_ht) },
        { label: 'Statut', render: (o) => orderStatusBadge(o.status) }
      ],
      rows,
      onRow: true,
      rowAttrs: (o) => `onclick="location.hash='#/orders/${o.id}'"`
    });
  };

  el.innerHTML = `<div class="card">
    <div class="card-head">
      <div class="searchbar" style="width:280px">${icon('search')}<input class="input" id="osearch" placeholder="Ref, client…"></div>
      <select class="input" id="ostatus" style="width:200px">
        <option value="">Tous les statuts</option>
        <option value="0">Brouillon</option><option value="1">Validee — en file</option>
        <option value="2">En preparation</option><option value="3">Preparee</option>
        <option value="4">Expediee</option><option value="5">Facturee</option><option value="-1">Annulee</option>
      </select>
      <div class="spacer"></div>
      <button class="btn primary" id="onew">${icon('plus', 15)} Nouvelle commande</button>
    </div>
    <div class="card-body flush" id="olist"></div>
  </div>`;

  let t;
  el.querySelector('#osearch').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { q = e.target.value; render(); }, 250); });
  el.querySelector('#ostatus').addEventListener('change', (e) => { status = e.target.value; render(); });
  el.querySelector('#onew').addEventListener('click', () => newOrderModal(ctx));
  await render();
}

export async function viewOrder(el, params, ctx) {
  const render = async () => {
    const o = await GET('/api/orders/' + params.id);
    const isDraft = o.status === 0;
    const progress = o.qty_total ? Math.round(o.qty_picked / o.qty_total * 100) : 0;

    el.innerHTML = `
      <div style="margin-bottom:14px"><a href="#/orders">${icon('returns', 13)} Retour aux commandes</a></div>
      <div class="card">
        <div class="card-head">
          <h2 style="font-size:17px">Commande ${esc(o.ref)}</h2>
          ${orderStatusBadge(o.status)}
          <span class="badge">${esc(orderTypeLabel(o.order_type))}</span>
          <span class="badge">Priorite ${o.priority}</span>
          ${o.source === 'portail' ? '<span class="badge purple">Portail</span>' : ''}
          <div class="spacer"></div>
          <a class="btn" href="/print/order/${o.id}" target="_blank">${icon('print', 14)} Bon de preparation</a>
          ${isDraft ? `<button class="btn primary" id="ovalidate">${icon('check', 14)} Valider</button>` : ''}
          ${o.status === 1 ? `<button class="btn primary" id="opick">${icon('scan', 14)} Preparer</button>` : ''}
          ${o.status === 2 ? `<a class="btn primary" href="#/picking/${o.id}">${icon('scan', 14)} Reprendre le picking</a>` : ''}
          ${o.status === 3 ? `<button class="btn primary" id="oship">${icon('truck', 14)} Expedier</button>` : ''}
          ${(o.status === 3 || o.status === 4) && !o.fk_invoice ? `<button class="btn primary" id="oinvoice">${icon('invoice', 14)} Facturer</button>` : ''}
          ${o.fk_invoice ? `<a class="btn" href="/print/invoice/${o.fk_invoice}" target="_blank">${icon('invoice', 14)} ${esc(o.invoice_ref)}</a>` : ''}
          ${o.status >= 0 && o.status < 4 ? `<button class="btn danger" id="ocancel">Annuler</button>` : ''}
          ${isDraft || o.status === -1 ? `<button class="btn danger" id="odelete">${icon('trash', 14)}</button>` : ''}
        </div>
        <div class="card-body">
          <div class="detail-grid">
            <div class="item"><b>Client</b><a href="#/tiers/${o.fk_client}">${esc(o.client_name)}</a></div>
            <div class="item"><b>Date</b>${fdate(o.date_order)}</div>
            <div class="item"><b>Total HT</b>${eur(o.total_ht)}</div>
            <div class="item"><b>Preparation</b>${num(o.qty_picked)} / ${num(o.qty_total)} ex.</div>
            ${o.date_shipped ? `<div class="item"><b>Expediee le</b>${fdate(o.date_shipped)}</div>` : ''}
          </div>
          ${o.status >= 2 && o.status <= 3 ? `<div class="progress" style="margin-top:10px"><div style="width:${progress}%"></div></div>` : ''}
          ${o.note ? `<p style="color:var(--text-2);margin-bottom:0"><b>Note :</b> ${esc(o.note)}</p>` : ''}
        </div>
      </div>

      <div class="card" style="margin-top:18px">
        <div class="card-head"><h2>Lignes (${o.lines.length})</h2>
          <div class="spacer"></div>
          ${isDraft ? `<button class="btn primary sm" id="oaddline">${icon('plus', 13)} Ajouter un livre</button>` : ''}
        </div>
        <div class="card-body flush">
          ${o.lines.length ? `<table class="table">
            <thead><tr><th>Livre</th><th>Gisements</th><th class="num">Qte</th><th class="num">Preparee</th>
              <th class="num">PU HT</th><th class="num">Remise</th><th class="num">Total HT</th>${isDraft ? '<th></th>' : ''}</tr></thead>
            <tbody>${o.lines.map((l) => `<tr>
              <td class="main-cell"><a href="#/products/${l.fk_product}">${esc(l.title)}</a><span class="sub">${esc(l.isbn)}</span></td>
              <td style="font-size:12px;color:var(--text-2)">${esc(l.locations || '—')}</td>
              <td class="num">${isDraft ? `<input class="input" style="width:70px" type="number" min="1" value="${l.qty}" data-lqty="${l.id}">` : num(l.qty)}</td>
              <td class="num">${num(l.qty_picked)}</td>
              <td class="num">${isDraft ? `<input class="input" style="width:90px" type="number" step="0.01" value="${l.price_ht}" data-lprice="${l.id}">` : eur(l.price_ht)}</td>
              <td class="num">${l.discount_pct || 0} %</td>
              <td class="num">${eur(l.qty * l.price_ht * (1 - l.discount_pct / 100))}</td>
              ${isDraft ? `<td class="actions"><button class="btn sm danger" data-ldel="${l.id}">${icon('trash', 13)}</button></td>` : ''}
            </tr>`).join('')}</tbody></table>` : '<div class="empty">Aucune ligne — ajoutez des livres</div>'}
        </div>
      </div>`;

    const on = (sel, fn) => { const b = el.querySelector(sel); if (b) b.onclick = fn; };

    on('#ovalidate', async () => {
      try { await POST(`/api/orders/${o.id}/validate`); toast('Commande validee, ajoutee a la file de preparation.'); render(); }
      catch (e) { toastErr(e); }
    });
    on('#opick', async () => {
      try { await POST(`/api/orders/${o.id}/start-picking`); ctx.navigate('picking/' + o.id); }
      catch (e) { toastErr(e); }
    });
    on('#oship', async () => {
      try { await POST(`/api/orders/${o.id}/ship`); toast('Commande expediee.'); render(); }
      catch (e) { toastErr(e); }
    });
    on('#oinvoice', async () => {
      if (!await confirmDialog('Generer la facture pour les quantites preparees ?')) return;
      try {
        const r = await POST(`/api/orders/${o.id}/invoice`);
        toast(`Facture ${r.invoice.ref} generee (${eur(r.invoice.total_ttc)} TTC).`);
        render();
      } catch (e) { toastErr(e); }
    });
    on('#ocancel', async () => {
      if (!await confirmDialog('Annuler cette commande ?', { danger: true, okLabel: 'Annuler la commande' })) return;
      try { await POST(`/api/orders/${o.id}/cancel`); toast('Commande annulee.'); render(); }
      catch (e) { toastErr(e); }
    });
    on('#odelete', async () => {
      if (!await confirmDialog('Supprimer definitivement cette commande ?', { danger: true, okLabel: 'Supprimer' })) return;
      try { await DEL('/api/orders/' + o.id); toast('Commande supprimee.'); ctx.navigate('orders'); }
      catch (e) { toastErr(e); }
    });
    on('#oaddline', () => productPicker(async (p, qty) => {
      try { await POST(`/api/orders/${o.id}/lines`, { fk_product: p.id, qty }); toast(`${p.title} ajoute.`); render(); }
      catch (e) { toastErr(e); }
    }));

    el.querySelectorAll('[data-lqty]').forEach((inp) => inp.addEventListener('change', async () => {
      try { await PUT(`/api/orders/${o.id}/lines/${inp.dataset.lqty}`, { qty: inp.value }); render(); }
      catch (e) { toastErr(e); render(); }
    }));
    el.querySelectorAll('[data-lprice]').forEach((inp) => inp.addEventListener('change', async () => {
      try { await PUT(`/api/orders/${o.id}/lines/${inp.dataset.lprice}`, { price_ht: inp.value }); render(); }
      catch (e) { toastErr(e); render(); }
    }));
    el.querySelectorAll('[data-ldel]').forEach((btn) => btn.addEventListener('click', async () => {
      try { await DEL(`/api/orders/${o.id}/lines/${btn.dataset.ldel}`); render(); }
      catch (e) { toastErr(e); }
    }));
  };
  await render();
}
