import { GET, POST, PUT, DEL } from '../api.js';
import {
  esc, eur, num, fdate, icon, toast, toastErr, modal, confirmDialog, readForm,
  field, input, select, dataTable
} from '../ui.js';
import { shipModal } from './orders.js';

/* ==================== Inventaires ==================== */
export async function viewInventories(el, params, ctx) {
  let status = '';
  const render = async () => {
    const rows = await GET('/api/inventories?status=' + status);
    el.querySelector('#invlist').innerHTML = dataTable({
      empty: 'Aucun inventaire',
      columns: [
        { label: 'Ref', render: (i) => `<span class="main-cell">${esc(i.ref)}</span><span class="sub">${fdate(i.date_creation)}</span>` },
        { label: 'Gisement', render: (i) => `<span class="badge">${esc(i.gisement_code)}</span>` },
        { label: 'Lignes', cls: 'num', render: (i) => num(i.nb_lines) },
        { label: 'Ecart', cls: 'num', render: (i) => i.ecart === 0 ? '<span class="badge green">0</span>'
            : `<span class="badge ${i.ecart < 0 ? 'red' : 'orange'}">${i.ecart > 0 ? '+' : ''}${num(i.ecart)}</span>` },
        { label: 'Statut', render: (i) => i.status === 1 ? '<span class="badge dot green">Valide</span>' : '<span class="badge dot orange">En cours</span>' }
      ],
      rows,
      onRow: true,
      rowAttrs: (i) => `onclick="location.hash='#/inventaires/${i.id}'"`
    });
  };

  el.innerHTML = `<div class="card">
    <div class="card-head">
      <select class="input" id="invstatus" style="width:170px">
        <option value="">Tous</option><option value="0">En cours</option><option value="1">Valides</option>
      </select>
      <div class="spacer"></div>
      <button class="btn primary" id="invnew">${icon('plus', 15)} Nouvel inventaire</button>
    </div>
    <div class="card-body flush" id="invlist"></div>
  </div>`;

  el.querySelector('#invstatus').addEventListener('change', (e) => { status = e.target.value; render(); });
  el.querySelector('#invnew').addEventListener('click', async () => {
    const gisements = await GET('/api/gisements');
    if (!gisements.length) return toast('Creez d\'abord un gisement.', 'error');
    const opts = gisements.map((g) => ({ value: g.id, label: `${g.code} (${num(g.qty_total)} ex.)` }));
    const { overlay, close } = modal({
      title: 'Nouvel inventaire de gisement',
      body: `<div class="form-grid">
        ${field('Gisement a compter', select('fk_gisement', opts, opts[0].value), 'wide')}
        ${field('Note', input('note', ''), 'wide')}
      </div>`,
      footer: `<button class="btn" data-act="c">Annuler</button><button class="btn primary" data-act="s">Commencer le comptage</button>`
    });
    overlay.querySelector('[data-act=c]').onclick = close;
    overlay.querySelector('[data-act=s]').onclick = async () => {
      try {
        const r = await POST('/api/inventories', readForm(overlay));
        toast(`Inventaire ${r.ref} ouvert.`);
        close();
        ctx.navigate('inventaires/' + r.id);
      } catch (e) { toastErr(e); }
    };
  });
  await render();
}

export async function viewInventory(el, params, ctx) {
  let statusHtml = '';
  const render = async () => {
    const inv = await GET('/api/inventories/' + params.id);
    const open = inv.status === 0;

    el.innerHTML = `
      <div style="margin-bottom:14px"><a href="#/inventaires">${icon('returns', 13)} Retour aux inventaires</a></div>
      <div class="card">
        <div class="card-head">
          <h2 style="font-size:17px">Inventaire ${esc(inv.ref)} — ${esc(inv.gisement_code)}</h2>
          ${inv.status === 1 ? '<span class="badge dot green">Valide</span>' : '<span class="badge dot orange">Comptage en cours</span>'}
          <span class="badge ${inv.ecart_total === 0 ? 'green' : inv.ecart_total < 0 ? 'red' : 'orange'}">Ecart : ${inv.ecart_total > 0 ? '+' : ''}${num(inv.ecart_total)}</span>
          <div class="spacer"></div>
          ${open ? `<button class="btn" id="invmissing">Ajouter les non-comptes a 0</button>
            <button class="btn primary" id="invvalidate">${icon('check', 14)} Valider (appliquer les ecarts)</button>
            <button class="btn danger" id="invdelete">${icon('trash', 14)}</button>` : ''}
        </div>
        ${open ? `<div class="card-body">
          <div id="invstatusbox">${statusHtml}</div>
          <form id="invscan" class="form-grid" style="grid-template-columns:2fr 1fr auto;align-items:end">
            ${field('ISBN du livre', input('isbn', '', 'class="input big" autocomplete="off" required'))}
            ${field('Quantite comptee', input('qty', 1, 'class="input big" type="number" min="1"'))}
            <button class="btn primary lg">${icon('check', 16)} Compter</button>
          </form>
          <p style="color:var(--text-3);font-size:12px;margin-bottom:0">
            Scannez chaque pile : les scans successifs du meme livre s'additionnent.
            « Ajouter les non-comptes a 0 » declare manquants les livres theoriquement presents que vous n'avez pas trouves.</p>
        </div>` : ''}
      </div>

      <div class="card" style="margin-top:18px">
        <div class="card-head"><h2>Comptage (${inv.lines.length} lignes)</h2></div>
        <div class="card-body flush">
          ${inv.lines.length ? `<table class="table">
            <thead><tr><th>Livre</th><th class="num">Theorique</th><th class="num">Compte</th><th class="num">Ecart</th>${open ? '<th></th>' : ''}</tr></thead>
            <tbody>${inv.lines.map((l) => {
              const ecart = l.qty_counted - l.qty_theoretical;
              return `<tr>
                <td class="main-cell"><a href="#/products/${l.fk_product}">${esc(l.title)}</a><span class="sub">${esc(l.isbn)}</span></td>
                <td class="num">${num(l.qty_theoretical)}</td>
                <td class="num">${open ? `<input class="input" style="width:80px" type="number" min="0" value="${l.qty_counted}" data-lqty="${l.id}">` : num(l.qty_counted)}</td>
                <td class="num">${ecart === 0 ? '<span class="badge green">0</span>' : `<span class="badge ${ecart < 0 ? 'red' : 'orange'}">${ecart > 0 ? '+' : ''}${num(ecart)}</span>`}</td>
                ${open ? `<td class="actions"><button class="btn sm danger" data-ldel="${l.id}">${icon('trash', 13)}</button></td>` : ''}
              </tr>`;
            }).join('')}</tbody></table>` : '<div class="empty">Aucun comptage saisi</div>'}
        </div>
      </div>

      ${open && inv.not_counted && inv.not_counted.length ? `<div class="card" style="margin-top:18px">
        <div class="card-head"><h2>Theoriquement presents, pas encore comptes (${inv.not_counted.length})</h2></div>
        <div class="card-body flush"><table class="table"><tbody>
          ${inv.not_counted.map((l) => `<tr>
            <td class="main-cell">${esc(l.title)}<span class="sub">${esc(l.isbn)}</span></td>
            <td class="num">${num(l.qty_theoretical)} attendus</td></tr>`).join('')}
        </tbody></table></div>
      </div>` : ''}`;

    const scanForm = el.querySelector('#invscan');
    if (scanForm) {
      scanForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = readForm(scanForm);
        if (!f.isbn) return;
        try {
          const r = await POST(`/api/inventories/${inv.id}/scan`, f);
          statusHtml = `<div class="scan-status ok"><div class="big-line">✓ ${esc(r.product.title)}</div>
            Compte : ${num(r.qty_counted)} — theorique : ${num(r.qty_theoretical)}</div>`;
        } catch (err) {
          statusHtml = `<div class="scan-status ko"><div class="big-line">✗ Refus</div>${esc(err.message)}</div>`;
        }
        render();
      });
      scanForm.querySelector('[name=isbn]').focus();
    }

    const on = (sel, fn) => { const b = el.querySelector(sel); if (b) b.onclick = fn; };
    on('#invmissing', async () => {
      try {
        const r = await POST(`/api/inventories/${inv.id}/add-missing`);
        toast(`${r.added} ligne(s) ajoutee(s) a zero.`);
        render();
      } catch (e) { toastErr(e); }
    });
    on('#invvalidate', async () => {
      if (!await confirmDialog(`Valider l'inventaire ? Les emplacements et le stock principal seront ajustes selon le comptage (ecart total : ${inv.ecart_total > 0 ? '+' : ''}${inv.ecart_total}). Cette action est definitive.`)) return;
      try { await POST(`/api/inventories/${inv.id}/validate`); toast('Inventaire valide, ajustements appliques.'); render(); }
      catch (e) { toastErr(e); }
    });
    on('#invdelete', async () => {
      if (!await confirmDialog('Supprimer cet inventaire ?', { danger: true, okLabel: 'Supprimer' })) return;
      try { await DEL('/api/inventories/' + inv.id); ctx.navigate('inventaires'); } catch (e) { toastErr(e); }
    });
    el.querySelectorAll('[data-lqty]').forEach((inp) => inp.addEventListener('change', async () => {
      try { await PUT(`/api/inventories/${inv.id}/lines/${inp.dataset.lqty}`, { qty_counted: inp.value }); render(); }
      catch (e) { toastErr(e); render(); }
    }));
    el.querySelectorAll('[data-ldel]').forEach((b) => b.addEventListener('click', async () => {
      try { await DEL(`/api/inventories/${inv.id}/lines/${b.dataset.ldel}`); render(); }
      catch (e) { toastErr(e); }
    }));
  };
  await render();
}

/* ==================== Expeditions (emballage + bons de livraison) ==================== */
export async function viewShipments(el) {
  let q = '';
  const render = async () => {
    /* Poste emballage : commandes preparees en attente d'expedition */
    const toPack = await GET('/api/orders?status=3');
    el.querySelector('#packlist').innerHTML = dataTable({
      empty: 'Aucune commande en attente d\'emballage',
      columns: [
        { label: 'Commande', render: (o) => `<a href="#/orders/${o.id}" class="main-cell">${esc(o.ref)}</a><span class="sub">${fdate(o.date_order)}</span>` },
        { label: 'Client', render: (o) => esc(o.client_name) },
        { label: 'Caisses', render: (o) => o.crates
            ? o.crates.split(', ').map((c) => `<span class="badge green">${esc(c)}</span>`).join(' ')
            : '—' },
        { label: 'Exemplaires', cls: 'num', render: (o) => num(o.qty_picked) },
        { label: '', cls: 'actions', render: (o) => `<button class="btn primary sm" data-pack="${o.id}">${icon('truck', 13)} Expedier</button>` }
      ],
      rows: toPack
    });
    el.querySelectorAll('[data-pack]').forEach((b) => b.addEventListener('click', async () => {
      const o = toPack.find((x) => x.id === Number(b.dataset.pack));
      // La modale attend les caisses en objets {code}
      o.crates = o.crates ? o.crates.split(', ').map((code) => ({ code })) : [];
      shipModal(o, render);
    }));

    const rows = await GET('/api/shipments' + (q ? '?q=' + encodeURIComponent(q) : ''));
    el.querySelector('#shlist').innerHTML = dataTable({
      empty: 'Aucune expedition',
      columns: [
        { label: 'BL', render: (s) => `<span class="main-cell">${esc(s.ref)}</span><span class="sub">${fdate(s.date_shipment)}</span>` },
        { label: 'Commande', render: (s) => `<a href="#/orders/${s.fk_order}">${esc(s.order_ref)}</a>` },
        { label: 'Client', render: (s) => esc(s.client_name) },
        { label: 'Transporteur', render: (s) => `${esc(s.carrier || '—')}${s.tracking ? `<span class="sub">${esc(s.tracking)}</span>` : ''}` },
        { label: 'Colis', cls: 'num', render: (s) => num(s.nb_colis) },
        { label: 'Poids', cls: 'num', render: (s) => s.weight_kg ? s.weight_kg + ' kg' : '—' },
        { label: 'Exemplaires', cls: 'num', render: (s) => num(s.qty_shipped) },
        { label: '', cls: 'actions', render: (s) => `<a class="btn sm" href="/print/shipment/${s.id}" target="_blank">${icon('print', 13)} BL</a>` }
      ],
      rows
    });
  };
  el.innerHTML = `<div class="card" style="margin-bottom:18px">
    <div class="card-head"><h2>${icon('box', 16)} A emballer — commandes preparees</h2></div>
    <div class="card-body flush" id="packlist"></div>
  </div>
  <div class="card">
    <div class="card-head">
      <h2>Bons de livraison</h2>
      <div class="searchbar" style="width:320px;margin-left:14px">${icon('search')}<input class="input" id="shsearch" placeholder="BL, commande, client, n° de suivi…"></div>
      <div class="spacer"></div>
    </div>
    <div class="card-body flush" id="shlist"></div>
  </div>`;
  let t;
  el.querySelector('#shsearch').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { q = e.target.value; render(); }, 250); });
  await render();
}
