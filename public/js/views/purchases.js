import { GET, POST, PUT, DEL } from '../api.js';
import {
  esc, eur, num, fdate, icon, toast, toastErr, modal, confirmDialog, readForm,
  field, input, select, dataTable
} from '../ui.js';
import { productPicker } from './orders.js';

const PO_STATUS = {
  '-1': ['Annulee', 'red'], 0: ['Brouillon', ''], 1: ['Envoyee', 'blue'],
  2: ['Partiellement recue', 'orange'], 3: ['Recue', 'green']
};
const poBadge = (s) => {
  const [label, color] = PO_STATUS[s] || ['?', ''];
  return `<span class="badge dot ${color}">${label}</span>`;
};

async function supplierOptions() {
  const suppliers = await GET('/api/thirdparties?type=fournisseur');
  return suppliers.map((s) => ({ value: s.id, label: s.name }));
}

/* ==================== Commandes fournisseurs ==================== */
export async function viewPurchaseOrders(el, params, ctx) {
  let status = '', q = '';
  const render = async () => {
    const rows = await GET(`/api/purchase-orders?status=${status}` + (q ? '&q=' + encodeURIComponent(q) : ''));
    el.querySelector('#polist').innerHTML = dataTable({
      empty: 'Aucune commande fournisseur',
      columns: [
        { label: 'Ref', render: (po) => `<span class="main-cell">${esc(po.ref)}</span><span class="sub">${fdate(po.date_order)}</span>` },
        { label: 'Fournisseur', render: (po) => esc(po.supplier_name) },
        { label: 'Exemplaires', cls: 'num', render: (po) => `${num(po.qty_received)} / ${num(po.qty_total)}` },
        { label: 'Total HT', cls: 'num', render: (po) => eur(po.total_ht) },
        { label: 'Statut', render: (po) => poBadge(po.status) }
      ],
      rows,
      onRow: true,
      rowAttrs: (po) => `onclick="location.hash='#/achats/${po.id}'"`
    });
  };

  el.innerHTML = `<div class="card">
    <div class="card-head">
      <div class="searchbar" style="width:280px">${icon('search')}<input class="input" id="posearch" placeholder="Ref, fournisseur…"></div>
      <select class="input" id="postatus" style="width:200px">
        <option value="">Tous les statuts</option>
        <option value="0">Brouillon</option><option value="1">Envoyee</option>
        <option value="2">Partiellement recue</option><option value="3">Recue</option><option value="-1">Annulee</option>
      </select>
      <div class="spacer"></div>
      <a class="btn" href="#/reassort">${icon('warehouse', 14)} Reassort</a>
      <button class="btn primary" id="ponew">${icon('plus', 15)} Nouvelle commande</button>
    </div>
    <div class="card-body flush" id="polist"></div>
  </div>`;

  let t;
  el.querySelector('#posearch').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { q = e.target.value; render(); }, 250); });
  el.querySelector('#postatus').addEventListener('change', (e) => { status = e.target.value; render(); });
  el.querySelector('#ponew').addEventListener('click', async () => {
    const opts = await supplierOptions();
    if (!opts.length) return toast('Creez d\'abord un fournisseur.', 'error');
    const { overlay, close } = modal({
      title: 'Nouvelle commande fournisseur',
      body: `<div class="form-grid">
        ${field('Fournisseur', select('fk_supplier', opts, opts[0].value), 'wide')}
        ${field('Note', `<textarea class="input" name="note" rows="2"></textarea>`, 'wide')}
      </div>`,
      footer: `<button class="btn" data-act="c">Annuler</button><button class="btn primary" data-act="s">Creer</button>`
    });
    overlay.querySelector('[data-act=c]').onclick = close;
    overlay.querySelector('[data-act=s]').onclick = async () => {
      try {
        const r = await POST('/api/purchase-orders', readForm(overlay));
        toast(`Commande ${r.ref} creee.`);
        close();
        ctx.navigate('achats/' + r.id);
      } catch (e) { toastErr(e); }
    };
  });
  await render();
}

export async function viewPurchaseOrder(el, params, ctx) {
  const render = async () => {
    const po = await GET('/api/purchase-orders/' + params.id);
    const isDraft = po.status === 0;
    el.innerHTML = `
      <div style="margin-bottom:14px"><a href="#/achats">${icon('returns', 13)} Retour aux commandes fournisseurs</a></div>
      <div class="card">
        <div class="card-head">
          <h2 style="font-size:17px">Commande fournisseur ${esc(po.ref)}</h2>
          ${poBadge(po.status)}
          <div class="spacer"></div>
          <a class="btn" href="/print/purchase-order/${po.id}" target="_blank">${icon('print', 14)} Bon de commande</a>
          ${isDraft ? `<button class="btn primary" id="povalidate">${icon('check', 14)} Valider / envoyer</button>` : ''}
          ${po.status === 1 || po.status === 2 ? `<button class="btn primary" id="poreceive">${icon('scan', 14)} Receptionner</button>` : ''}
          ${po.status < 2 && po.status >= 0 ? `<button class="btn danger" id="pocancel">Annuler</button>` : ''}
          ${isDraft || po.status === -1 ? `<button class="btn danger" id="podelete">${icon('trash', 14)}</button>` : ''}
        </div>
        <div class="card-body">
          <div class="detail-grid">
            <div class="item"><b>Fournisseur</b><a href="#/tiers/${po.fk_supplier}">${esc(po.supplier_name)}</a></div>
            <div class="item"><b>Date</b>${fdate(po.date_order)}</div>
            <div class="item"><b>Total HT</b>${eur(po.total_ht)}</div>
            <div class="item"><b>Reception</b>${num(po.qty_received)} / ${num(po.qty_total)} ex.</div>
          </div>
          ${po.note ? `<p style="color:var(--text-2);margin-bottom:0"><b>Note :</b> ${esc(po.note)}</p>` : ''}
        </div>
      </div>

      <div class="card" style="margin-top:18px">
        <div class="card-head"><h2>Lignes (${po.lines.length})</h2>
          <div class="spacer"></div>
          ${isDraft ? `<button class="btn primary sm" id="poaddline">${icon('plus', 13)} Ajouter un livre</button>` : ''}
        </div>
        <div class="card-body flush">
          ${po.lines.length ? `<table class="table">
            <thead><tr><th>Livre</th><th class="num">Qte</th><th class="num">Recue</th><th class="num">PA HT</th><th class="num">Total HT</th>${isDraft ? '<th></th>' : ''}</tr></thead>
            <tbody>${po.lines.map((l) => `<tr>
              <td class="main-cell"><a href="#/products/${l.fk_product}">${esc(l.title)}</a><span class="sub">${esc(l.isbn)}</span></td>
              <td class="num">${isDraft ? `<input class="input" style="width:75px" type="number" min="1" value="${l.qty}" data-lqty="${l.id}">` : num(l.qty)}</td>
              <td class="num"><span class="badge ${l.qty_received >= l.qty ? 'green' : l.qty_received > 0 ? 'orange' : ''}">${num(l.qty_received)}</span></td>
              <td class="num">${isDraft ? `<input class="input" style="width:90px" type="number" step="0.01" value="${l.buy_price_ht}" data-lprice="${l.id}">` : eur(l.buy_price_ht)}</td>
              <td class="num">${eur(l.qty * l.buy_price_ht)}</td>
              ${isDraft ? `<td class="actions"><button class="btn sm danger" data-ldel="${l.id}">${icon('trash', 13)}</button></td>` : ''}
            </tr>`).join('')}</tbody></table>` : '<div class="empty">Aucune ligne — ajoutez des livres</div>'}
        </div>
      </div>

      ${po.receptions.length ? `<div class="card" style="margin-top:18px">
        <div class="card-head"><h2>Receptions liees</h2></div>
        <div class="card-body flush"><table class="table"><tbody>
          ${po.receptions.map((r) => `<tr class="clickable" onclick="location.hash='#/receptions/${r.id}'">
            <td class="main-cell">${esc(r.ref)}</td><td>${fdate(r.date_creation)}</td>
            <td>${r.status === 1 ? '<span class="badge green">Validee</span>' : '<span class="badge orange">En cours</span>'}</td></tr>`).join('')}
        </tbody></table></div>
      </div>` : ''}`;

    const on = (sel, fn) => { const b = el.querySelector(sel); if (b) b.onclick = fn; };
    on('#povalidate', async () => {
      try { await POST(`/api/purchase-orders/${po.id}/validate`); toast('Commande validee — imprimez le bon et envoyez-le au fournisseur.'); render(); }
      catch (e) { toastErr(e); }
    });
    on('#poreceive', async () => {
      try {
        const r = await POST('/api/receptions', { fk_po: po.id });
        toast(`Reception ${r.ref} ouverte.`);
        ctx.navigate('receptions/' + r.id);
      } catch (e) { toastErr(e); }
    });
    on('#pocancel', async () => {
      if (!await confirmDialog('Annuler cette commande fournisseur ?', { danger: true, okLabel: 'Annuler la commande' })) return;
      try { await POST(`/api/purchase-orders/${po.id}/cancel`); render(); } catch (e) { toastErr(e); }
    });
    on('#podelete', async () => {
      if (!await confirmDialog('Supprimer cette commande fournisseur ?', { danger: true, okLabel: 'Supprimer' })) return;
      try { await DEL('/api/purchase-orders/' + po.id); ctx.navigate('achats'); } catch (e) { toastErr(e); }
    });
    on('#poaddline', () => productPicker(async (p, qty) => {
      try { await POST(`/api/purchase-orders/${po.id}/lines`, { fk_product: p.id, qty }); toast(`${p.title} ajoute.`); render(); }
      catch (e) { toastErr(e); }
    }));
    el.querySelectorAll('[data-lqty]').forEach((inp) => inp.addEventListener('change', async () => {
      try { await PUT(`/api/purchase-orders/${po.id}/lines/${inp.dataset.lqty}`, { qty: inp.value }); render(); }
      catch (e) { toastErr(e); render(); }
    }));
    el.querySelectorAll('[data-lprice]').forEach((inp) => inp.addEventListener('change', async () => {
      try { await PUT(`/api/purchase-orders/${po.id}/lines/${inp.dataset.lprice}`, { buy_price_ht: inp.value }); render(); }
      catch (e) { toastErr(e); render(); }
    }));
    el.querySelectorAll('[data-ldel]').forEach((b) => b.addEventListener('click', async () => {
      try { await DEL(`/api/purchase-orders/${po.id}/lines/${b.dataset.ldel}`); render(); }
      catch (e) { toastErr(e); }
    }));
  };
  await render();
}

/* ==================== Receptions ==================== */
export async function viewReceptions(el, params, ctx) {
  let status = '';
  const render = async () => {
    const rows = await GET('/api/receptions?status=' + status);
    el.querySelector('#rclist').innerHTML = dataTable({
      empty: 'Aucune reception',
      columns: [
        { label: 'Ref', render: (r) => `<span class="main-cell">${esc(r.ref)}</span><span class="sub">${fdate(r.date_creation)}</span>` },
        { label: 'Fournisseur', render: (r) => esc(r.supplier_name) },
        { label: 'Commande', render: (r) => r.po_ref ? `<span class="badge blue">${esc(r.po_ref)}</span>` : '<span class="badge">Directe</span>' },
        { label: 'Exemplaires', cls: 'num', render: (r) => num(r.qty_total) },
        { label: 'Statut', render: (r) => r.status === 1 ? '<span class="badge dot green">Validee — stock entre</span>' : '<span class="badge dot orange">En cours de scan</span>' }
      ],
      rows,
      onRow: true,
      rowAttrs: (r) => `onclick="location.hash='#/receptions/${r.id}'"`
    });
  };

  el.innerHTML = `<div class="card">
    <div class="card-head">
      <select class="input" id="rcstatus" style="width:180px">
        <option value="">Toutes</option><option value="0">En cours</option><option value="1">Validees</option>
      </select>
      <div class="spacer"></div>
      <button class="btn primary" id="rcnew">${icon('plus', 15)} Nouvelle reception</button>
    </div>
    <div class="card-body flush" id="rclist"></div>
  </div>`;

  el.querySelector('#rcstatus').addEventListener('change', (e) => { status = e.target.value; render(); });
  el.querySelector('#rcnew').addEventListener('click', async () => {
    const [opts, pos] = await Promise.all([supplierOptions(), GET('/api/purchase-orders?status=1'), ]);
    const pos2 = (await GET('/api/purchase-orders?status=2'));
    const openPos = pos.concat(pos2);
    if (!opts.length) return toast('Creez d\'abord un fournisseur.', 'error');
    const poOpts = [{ value: '', label: 'Aucune (reception directe / office)' }]
      .concat(openPos.map((po) => ({ value: po.id, label: `${po.ref} — ${po.supplier_name}` })));
    const { overlay, close } = modal({
      title: 'Nouvelle reception de marchandises',
      body: `<div class="form-grid">
        ${field('Commande fournisseur a receptionner', select('fk_po', poOpts, ''), 'wide')}
        ${field('Fournisseur (si reception directe)', select('fk_supplier', opts, opts[0].value), 'wide')}
        ${field('Note', input('note', ''), 'wide')}
      </div>`,
      footer: `<button class="btn" data-act="c">Annuler</button><button class="btn primary" data-act="s">Commencer le scan</button>`
    });
    overlay.querySelector('[data-act=c]').onclick = close;
    overlay.querySelector('[data-act=s]').onclick = async () => {
      try {
        const f = readForm(overlay);
        if (!f.fk_po) delete f.fk_po;
        const r = await POST('/api/receptions', f);
        toast(`Reception ${r.ref} ouverte.`);
        close();
        ctx.navigate('receptions/' + r.id);
      } catch (e) { toastErr(e); }
    };
  });
  await render();
}

export async function viewReception(el, params, ctx) {
  let statusHtml = '';
  const render = async () => {
    const rc = await GET('/api/receptions/' + params.id);
    const open = rc.status === 0;

    el.innerHTML = `
      <div style="margin-bottom:14px"><a href="#/receptions">${icon('returns', 13)} Retour aux receptions</a></div>
      <div class="card">
        <div class="card-head">
          <h2 style="font-size:17px">Reception ${esc(rc.ref)}</h2>
          ${rc.status === 1 ? '<span class="badge dot green">Validee — stock entre</span>' : '<span class="badge dot orange">En cours de scan</span>'}
          ${rc.po_ref ? `<a class="badge blue" href="#/achats/${rc.fk_po}">${esc(rc.po_ref)}</a>` : '<span class="badge">Reception directe</span>'}
          <div class="spacer"></div>
          ${open ? `<button class="btn primary" id="rcvalidate">${icon('check', 14)} Valider (entree en stock)</button>
            <button class="btn danger" id="rcdelete">${icon('trash', 14)}</button>` : ''}
        </div>
        <div class="card-body">
          <div class="detail-grid">
            <div class="item"><b>Fournisseur</b><a href="#/tiers/${rc.fk_supplier}">${esc(rc.supplier_name)}</a></div>
            <div class="item"><b>Date</b>${fdate(rc.date_creation)}</div>
            <div class="item"><b>Exemplaires scannes</b>${num(rc.qty_total)}</div>
          </div>
          ${open ? `<p style="color:var(--text-3);font-size:12.5px;margin-bottom:0">
            Apres validation, le stock entre dans le Stock Principal : passez ensuite par
            <a href="#/rangement">Rangement</a> pour placer les exemplaires en gisement.</p>` : ''}
        </div>
      </div>

      ${open ? `<div class="card" style="margin-top:18px">
        <div class="card-head"><h2>${icon('scan', 16)} Scanner les livres recus</h2></div>
        <div class="card-body">
          <div id="rcstatusbox">${statusHtml}</div>
          <form id="rcscan" class="form-grid" style="grid-template-columns:2fr 1fr 1fr auto;align-items:end">
            ${field('ISBN du livre', input('isbn', '', 'class="input big" autocomplete="off" required'))}
            ${field('Quantite', input('qty', 1, 'class="input big" type="number" min="1"'))}
            ${field('PA HT (optionnel)', input('buy_price_ht', '', 'class="input big" type="number" step="0.01" placeholder="inchange"'))}
            <button class="btn primary lg">${icon('check', 16)} Scanner</button>
          </form>
        </div>
      </div>` : ''}

      ${rc.po_compare ? `<div class="card" style="margin-top:18px">
        <div class="card-head"><h2>Controle contre la commande ${esc(rc.po_ref)}</h2></div>
        <div class="card-body flush"><table class="table">
          <thead><tr><th>Livre</th><th class="num">Commandee</th><th class="num">Deja recue</th><th class="num">Cette reception</th><th class="num">Ecart</th></tr></thead>
          <tbody>${rc.po_compare.map((c) => `<tr>
            <td class="main-cell">${esc(c.title)}<span class="sub">${esc(c.isbn)}</span></td>
            <td class="num">${num(c.qty_ordered)}</td>
            <td class="num">${num(c.qty_received_before)}</td>
            <td class="num">${num(c.qty_this)}</td>
            <td class="num">${c.ecart === 0 ? '<span class="badge green">OK</span>'
              : c.ecart < 0 ? `<span class="badge orange">${num(c.ecart)}</span>`
              : `<span class="badge red">+${num(c.ecart)}</span>`}</td></tr>`).join('')}
          </tbody></table>
          ${rc.hors_commande && rc.hors_commande.length ? `<div style="padding:10px 16px;color:var(--warning);font-size:12.5px">
            ⚠ ${rc.hors_commande.length} livre(s) scanne(s) hors commande (voir la liste ci-dessous).</div>` : ''}
        </div>
      </div>` : ''}

      <div class="card" style="margin-top:18px">
        <div class="card-head"><h2>Livres scannes (${num(rc.qty_total)})</h2></div>
        <div class="card-body flush">
          ${rc.lines.length ? `<table class="table">
            <thead><tr><th>Livre</th><th class="num">Qte</th><th class="num">PA HT</th>${open ? '<th></th>' : ''}</tr></thead>
            <tbody>${rc.lines.map((l) => `<tr>
              <td class="main-cell"><a href="#/products/${l.fk_product}">${esc(l.title)}</a><span class="sub">${esc(l.isbn)}</span></td>
              <td class="num">${open ? `<input class="input" style="width:75px" type="number" min="1" value="${l.qty}" data-lqty="${l.id}">` : num(l.qty)}</td>
              <td class="num">${l.buy_price_ht !== null && l.buy_price_ht !== undefined ? eur(l.buy_price_ht) : '<span class="sub">inchange</span>'}</td>
              ${open ? `<td class="actions"><button class="btn sm danger" data-ldel="${l.id}">${icon('trash', 13)}</button></td>` : ''}
            </tr>`).join('')}</tbody></table>` : '<div class="empty">Aucun livre scanne</div>'}
        </div>
      </div>`;

    const scanForm = el.querySelector('#rcscan');
    if (scanForm) {
      scanForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = readForm(scanForm);
        if (!f.isbn) return;
        try {
          const r = await POST(`/api/receptions/${rc.id}/scan`, f);
          let sub = '';
          if (r.ordered) {
            sub = r.ordered.hors_commande
              ? '<span style="color:var(--danger)">⚠ Hors commande fournisseur</span>'
              : `Commande : ${num(r.ordered.qty_received)} / ${num(r.ordered.qty_ordered)} recus`;
          }
          statusHtml = `<div class="scan-status ok"><div class="big-line">✓ ${r.qty} × ${esc(r.product.title)}</div>${sub}</div>`;
        } catch (err) {
          statusHtml = `<div class="scan-status ko"><div class="big-line">✗ Refus</div>${esc(err.message)}</div>`;
        }
        render();
      });
      scanForm.querySelector('[name=isbn]').focus();
    }

    const on = (sel, fn) => { const b = el.querySelector(sel); if (b) b.onclick = fn; };
    on('#rcvalidate', async () => {
      if (!await confirmDialog(`Valider la reception ? ${rc.qty_total} exemplaire(s) entreront dans le Stock Principal.`)) return;
      try {
        await POST(`/api/receptions/${rc.id}/validate`);
        toast('Reception validee, stock entre. Pensez au rangement en gisement.');
        render();
      } catch (e) { toastErr(e); }
    });
    on('#rcdelete', async () => {
      if (!await confirmDialog('Supprimer cette reception ?', { danger: true, okLabel: 'Supprimer' })) return;
      try { await DEL('/api/receptions/' + rc.id); ctx.navigate('receptions'); } catch (e) { toastErr(e); }
    });
    el.querySelectorAll('[data-lqty]').forEach((inp) => inp.addEventListener('change', async () => {
      try { await PUT(`/api/receptions/${rc.id}/lines/${inp.dataset.lqty}`, { qty: inp.value }); render(); }
      catch (e) { toastErr(e); render(); }
    }));
    el.querySelectorAll('[data-ldel]').forEach((b) => b.addEventListener('click', async () => {
      try { await DEL(`/api/receptions/${rc.id}/lines/${b.dataset.ldel}`); render(); }
      catch (e) { toastErr(e); }
    }));
  };
  await render();
}

/* ==================== Reassort ==================== */
export async function viewRestock(el, params, ctx) {
  const groups = await GET('/api/purchasing/restock');
  el.innerHTML = `<div class="card">
    <div class="card-head"><h2>Suggestions de reassort</h2>
      <div class="spacer"></div>
      <span style="font-size:12.5px;color:var(--text-3)">Livres sous leur stock mini (defini sur la fiche livre), deduction faite des commandes fournisseurs en cours.</span>
    </div>
    <div class="card-body flush" id="rslist"></div>
  </div>`;
  const list = el.querySelector('#rslist');
  if (!groups.length) {
    list.innerHTML = `<div class="empty">Aucun reassort necessaire.<br>
      <small>Definissez un « stock mini » sur les fiches livres pour activer les suggestions.</small></div>`;
    return;
  }
  list.innerHTML = groups.map((g, gi) => `<div style="border-bottom:1px solid var(--border)">
    <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:#fafbfc">
      <b>${esc(g.supplier_name)}</b>
      <span class="badge">${g.products.length} titre(s)</span>
      <div class="spacer" style="flex:1"></div>
      ${g.fk_supplier ? `<button class="btn primary sm" data-po="${gi}">${icon('plus', 13)} Creer la commande fournisseur</button>` : '<span class="sub">affectez un fournisseur aux livres</span>'}
    </div>
    <table class="table"><thead><tr><th>Livre</th><th class="num">Stock</th><th class="num">Mini</th><th class="num">En commande</th><th class="num">Suggestion</th></tr></thead>
    <tbody>${g.products.map((p) => `<tr>
      <td class="main-cell"><a href="#/products/${p.id}">${esc(p.title)}</a><span class="sub">${esc(p.isbn)}</span></td>
      <td class="num"><span class="badge ${p.stock_main <= 0 ? 'red' : 'orange'}">${num(p.stock_main)}</span></td>
      <td class="num">${num(p.stock_min)}</td>
      <td class="num">${num(p.qty_on_order)}</td>
      <td class="num"><b>${num(p.qty_suggested)}</b></td></tr>`).join('')}
    </tbody></table>
  </div>`).join('');

  list.querySelectorAll('[data-po]').forEach((b) => b.addEventListener('click', async () => {
    const g = groups[Number(b.dataset.po)];
    if (!await confirmDialog(`Creer une commande fournisseur ${g.supplier_name} avec ${g.products.length} ligne(s) pre-remplie(s) ?`)) return;
    try {
      const r = await POST('/api/purchase-orders', {
        fk_supplier: g.fk_supplier,
        note: 'Reassort automatique',
        lines: g.products.map((p) => ({ fk_product: p.id, qty: p.qty_suggested }))
      });
      toast(`Commande ${r.ref} creee en brouillon.`);
      ctx.navigate('achats/' + r.id);
    } catch (e) { toastErr(e); }
  }));
}
