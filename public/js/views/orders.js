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

/* Modale d'emballage / expedition : transporteur, suivi, colisage -> genere le BL. */
export const CARRIERS = ['DPD', 'Exapad', 'Colissimo', 'Chronopost', 'GLS', 'Par nos soins', 'A dispo Gradignan'];

export function shipModal(o, onDone) {
  const crates = (o.crates || []).map((c) => `<span class="badge green">${esc(c.code)}</span>`).join(' ');
  const { overlay, close } = modal({
    title: `Expedier ${o.ref} — bon de livraison`,
    body: `${crates ? `<p style="margin-top:0;color:var(--text-2)">Contenu prepare dans : ${crates}</p>` : ''}
      <div class="form-grid">
      ${field('Transporteur', `<input class="input" name="carrier" list="carriers-dl" autocomplete="off" placeholder="DPD, Exapad, par nos soins…">
        <datalist id="carriers-dl">${CARRIERS.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>`)}
      ${field('N° de suivi', input('tracking', ''))}
      ${field('Nombre de colis', input('nb_colis', 1, 'type="number" min="1"'))}
      ${field('Poids (kg)', input('weight_kg', '', 'type="number" step="0.1" min="0"'))}
      ${field('Note', input('note', ''), 'wide')}
    </div>`,
    footer: `<button class="btn" data-act="c">Annuler</button>
      <button class="btn primary" data-act="s">${icon('truck', 14)} Expedier et generer le BL</button>`
  });
  overlay.querySelector('[data-act=c]').onclick = close;
  overlay.querySelector('[data-act=s]').onclick = async () => {
    try {
      const r = await POST(`/api/orders/${o.id}/ship`, readForm(overlay));
      toast(`Commande expediee — bon de livraison ${r.shipment.ref} genere.`);
      close();
      window.open('/print/shipment/' + r.shipment.id, '_blank');
      if (onDone) onDone(r);
    } catch (e) { toastErr(e); }
  };
}

export async function clientSelectOptions() {
  const clients = await GET('/api/thirdparties?type=client');
  return clients.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }));
}

/*
 * Selecteur de client par recherche (nom OU code, y compris un code personnalise) —
 * evite un menu deroulant listant tous les clients. Saisie manuelle avec suggestions.
 */
export function clientPickerField(label = 'Client * (nom ou code)', opts = {}) {
  return field(label, `
    <div class="autocomplete" data-role="client-picker">
      <input class="input" data-role="cp-search" autocomplete="off" placeholder="Tapez un nom ou un code…"
        value="${esc(opts.initialLabel || '')}" ${opts.required !== false ? 'required' : ''}>
      <input type="hidden" name="${opts.name || 'fk_client'}" data-role="cp-value" value="${opts.initialId || ''}">
      <div class="autocomplete-list" data-role="cp-list" hidden></div>
    </div>`, opts.cls ?? 'wide');
}

/* Attache le comportement du champ genere par clientPickerField(). A appeler apres l'insertion dans le DOM. */
export function wireClientPicker(root, { onPick } = {}) {
  const wrap = root.querySelector('[data-role=client-picker]');
  if (!wrap) return { getId: () => null };
  const searchEl = wrap.querySelector('[data-role=cp-search]');
  const valueEl = wrap.querySelector('[data-role=cp-value]');
  const listEl = wrap.querySelector('[data-role=cp-list]');
  let items = [];
  let t;

  const hide = () => { listEl.hidden = true; listEl.innerHTML = ''; };
  const pick = (c) => {
    valueEl.value = c.id;
    searchEl.value = `${c.name} (${c.code})`;
    hide();
    if (onPick) onPick(c);
  };
  const search = async (q) => (items = q ? await GET('/api/thirdparties?type=client&q=' + encodeURIComponent(q)) : []);
  const renderList = (list) => {
    if (!list.length) { listEl.innerHTML = '<div class="autocomplete-empty">Aucun client trouve</div>'; listEl.hidden = false; return; }
    listEl.innerHTML = list.slice(0, 8).map((c, i) => `<div class="autocomplete-item" data-i="${i}">
      <span class="main">${esc(c.name)}</span><span class="sub">${esc(c.code)}${c.town ? ' — ' + esc(c.town) : ''}</span></div>`).join('');
    listEl.hidden = false;
    listEl.querySelectorAll('[data-i]').forEach((el) => el.addEventListener('mousedown', (e) => {
      e.preventDefault(); // eviter que le blur ne ferme la liste avant le clic
      pick(list[Number(el.dataset.i)]);
    }));
  };
  searchEl.addEventListener('input', () => {
    valueEl.value = '';
    clearTimeout(t);
    const q = searchEl.value.trim();
    if (!q) { hide(); return; }
    t = setTimeout(async () => renderList(await search(q)), 220);
  });
  searchEl.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    clearTimeout(t);
    const q = searchEl.value.trim();
    if (!q) return;
    const list = await search(q);
    const exact = list.find((c) => c.code.toLowerCase() === q.toLowerCase());
    if (exact) { pick(exact); return; }
    if (list.length === 1) { pick(list[0]); return; }
    renderList(list);
  });
  searchEl.addEventListener('blur', () => setTimeout(hide, 150));
  return { getId: () => valueEl.value };
}

function newOrderModal(ctx) {
  const { overlay, close } = modal({
    title: 'Nouvelle commande',
    body: `<div class="form-grid">
      ${clientPickerField()}
      ${field('Type de commande', select('order_type', ORDER_TYPES, 'livraison'))}
      ${field('Priorite (1 = urgent)', input('priority', 5, 'type="number" min="1" max="9"'))}
      ${field('Note', `<textarea class="input" name="note" rows="2"></textarea>`, 'wide')}
    </div>`,
    footer: `<button class="btn" data-act="c">Annuler</button><button class="btn primary" data-act="s">Creer la commande</button>`
  });
  wireClientPicker(overlay);
  overlay.querySelector('[data-act=c]').onclick = close;
  overlay.querySelector('[data-act=s]').onclick = async () => {
    const data = readForm(overlay);
    if (!data.fk_client) return toast('Selectionnez un client dans la liste (tapez son nom ou son code).', 'error');
    try {
      const r = await POST('/api/orders', data);
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
          ${(o.crates || []).map((c) => `<span class="badge green">${icon('box', 12)} ${esc(c.code)}</span>`).join('')}
          <div class="spacer"></div>
          <a class="btn" href="/print/order/${o.id}" target="_blank">${icon('print', 14)} Bon de preparation</a>
          ${isDraft ? `<button class="btn primary" id="ovalidate">${icon('check', 14)} Valider</button>` : ''}
          ${o.status === 1 ? `<button class="btn primary" id="opick">${icon('scan', 14)} Preparer</button>` : ''}
          ${o.status === 2 ? `<a class="btn primary" href="#/picking/${o.id}">${icon('scan', 14)} Reprendre le picking</a>` : ''}
          ${o.status === 3 ? `<button class="btn primary" id="oship">${icon('truck', 14)} Expedier</button>` : ''}
          ${(o.status === 3 || o.status === 4) && !o.fk_invoice ? `<button class="btn primary" id="oinvoice">${icon('invoice', 14)} Facturer</button>` : ''}
          ${o.status >= 3 && o.qty_picked < o.qty_total && !o.fk_backorder ? `<button class="btn" id="obackorder">${icon('queue', 14)} Generer le reliquat</button>` : ''}
          ${o.backorder_ref ? `<a class="btn" href="#/orders/${o.fk_backorder}">${icon('queue', 14)} Reliquat ${esc(o.backorder_ref)}</a>` : ''}
          ${(o.shipments || []).map((s) => `<a class="btn" href="/print/shipment/${s.id}" target="_blank">${icon('truck', 14)} ${esc(s.ref)}</a>`).join('')}
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
              <td class="num">${num(l.qty_picked)}${l.unavailable ? ' <span class="badge red">Indispo.</span>' : ''}</td>
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
    on('#oship', () => shipModal(o, render));
    on('#obackorder', async () => {
      if (!await confirmDialog(`Generer une commande reliquat pour les ${o.qty_total - o.qty_picked} exemplaire(s) non servi(s) ? Elle entrera directement en file de preparation.`)) return;
      try {
        const r = await POST(`/api/orders/${o.id}/backorder`);
        toast(`Reliquat ${r.backorder.ref} genere et mis en file.`);
        render();
      } catch (e) { toastErr(e); }
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
