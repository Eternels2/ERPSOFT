import { GET, POST, PUT, DEL } from '../api.js';
import {
  esc, eur, num, fdate, icon, toast, toastErr, modal, confirmDialog, readForm,
  field, input, select, dataTable
} from '../ui.js';

const statusBadge = (s) => s === 1 ? '<span class="badge dot green">Expedie</span>' : '<span class="badge dot blue">Ouvert</span>';

export async function viewContainers(el, params, ctx) {
  let status = '';
  const render = async () => {
    const rows = await GET('/api/containers?status=' + status);
    el.querySelector('#ctlist').innerHTML = dataTable({
      empty: 'Aucun conteneur',
      columns: [
        { label: 'Ref', render: (c) => `<span class="main-cell">${esc(c.ref)}</span><span class="sub">${fdate(c.date_creation)}</span>` },
        { label: 'Fournisseur', render: (c) => esc(c.supplier_name) },
        { label: 'N° retour fournisseur', render: (c) => esc(c.supplier_return_number || '—') },
        { label: 'Livres', cls: 'num', render: (c) => num(c.nb_books) },
        { label: 'Valeur HT', cls: 'num', render: (c) => eur(c.total_ht) },
        { label: 'Statut', render: (c) => statusBadge(c.status) }
      ],
      rows,
      onRow: true,
      rowAttrs: (c) => `onclick="location.hash='#/containers/${c.id}'"`
    });
  };

  el.innerHTML = `<div class="card">
    <div class="card-head">
      <select class="input" id="ctstatus" style="width:170px">
        <option value="">Tous</option><option value="0">Ouverts</option><option value="1">Expedies</option>
      </select>
      <div class="spacer"></div>
      <button class="btn primary" id="ctnew">${icon('plus', 15)} Nouveau conteneur</button>
    </div>
    <div class="card-body flush" id="ctlist"></div>
  </div>`;

  el.querySelector('#ctstatus').addEventListener('change', (e) => { status = e.target.value; render(); });
  el.querySelector('#ctnew').addEventListener('click', async () => {
    const suppliers = await GET('/api/thirdparties?type=fournisseur');
    if (!suppliers.length) return toast('Creez d\'abord un fournisseur.', 'error');
    const opts = suppliers.map((s) => ({ value: s.id, label: s.name }));
    const { overlay, close } = modal({
      title: 'Nouveau conteneur de retour fournisseur',
      body: `<div class="form-grid">
        ${field('Fournisseur (un seul par conteneur)', select('fk_supplier', opts, opts[0].value), 'wide')}
        ${field('N° de retour fournisseur', input('supplier_return_number', '', 'placeholder="Autorisation de retour"'), 'wide')}
      </div>`,
      footer: `<button class="btn" data-act="c">Annuler</button><button class="btn primary" data-act="s">Creer</button>`
    });
    overlay.querySelector('[data-act=c]').onclick = close;
    overlay.querySelector('[data-act=s]').onclick = async () => {
      try {
        const r = await POST('/api/containers', readForm(overlay));
        toast(`Conteneur ${r.ref} cree.`);
        close();
        ctx.navigate('containers/' + r.id);
      } catch (e) { toastErr(e); }
    };
  });
  await render();
}

export async function viewContainer(el, params, ctx) {
  const render = async () => {
    const c = await GET('/api/containers/' + params.id);
    const open = c.status === 0;
    const availableQty = c.available.reduce((s, l) => s + l.qty, 0);

    el.innerHTML = `
      <div style="margin-bottom:14px"><a href="#/containers">${icon('returns', 13)} Retour aux conteneurs</a></div>
      <div class="card">
        <div class="card-head">
          <h2 style="font-size:17px">${icon('box', 18)} Conteneur ${esc(c.ref)}</h2>
          ${statusBadge(c.status)}
          <div class="spacer"></div>
          <a class="btn" href="/print/container/${c.id}" target="_blank">${icon('print', 14)} Bordereau</a>
          ${open ? `<button class="btn" id="ctedit">${icon('edit', 14)} N° retour</button>
            <button class="btn primary" id="ctship">${icon('truck', 14)} Marquer expedie</button>
            <button class="btn danger" id="ctdel">${icon('trash', 14)}</button>` : ''}
        </div>
        <div class="card-body">
          <div class="detail-grid">
            <div class="item"><b>Fournisseur</b><a href="#/tiers/${c.fk_supplier}">${esc(c.supplier_name)}</a></div>
            <div class="item"><b>N° retour fournisseur</b>${esc(c.supplier_return_number || '—')}</div>
            <div class="item"><b>Cree le</b>${fdate(c.date_creation)}</div>
            ${c.date_shipped ? `<div class="item"><b>Expedie le</b>${fdate(c.date_shipped)}</div>` : ''}
            <div class="item"><b>Livres</b>${num(c.nb_books)}</div>
            <div class="item"><b>Valeur HT</b>${eur(c.total_ht)}</div>
          </div>
        </div>
      </div>

      ${open && availableQty > 0 ? `<div class="card" style="margin-top:18px">
        <div class="card-body" style="display:flex;align-items:center;gap:14px">
          <span>${icon('box', 18)}</span>
          <div style="flex:1"><b>${num(availableQty)} exemplaire(s)</b> de retours finalises de ${esc(c.supplier_name)} ne sont affectes a aucun conteneur.</div>
          <button class="btn primary" id="ctpull">Ajouter au conteneur</button>
        </div>
      </div>` : ''}

      <div class="card" style="margin-top:18px">
        <div class="card-head"><h2>Livres dans ce conteneur (${num(c.nb_books)})</h2></div>
        <div class="card-body flush">
          ${c.lines.length ? `<table class="table">
            <thead><tr><th>Livre</th><th>Editeur</th><th>Provenance</th><th class="num">Qte</th><th class="num">PU HT</th>${open ? '<th></th>' : ''}</tr></thead>
            <tbody>${c.lines.map((l) => `<tr>
              <td class="main-cell"><a href="#/products/${l.product_id}">${esc(l.title)}</a><span class="sub">${esc(l.isbn)}</span></td>
              <td>${esc(l.publisher || '—')}</td>
              <td>${esc(l.return_ref)}<span class="sub">${esc(l.client_name)}</span></td>
              <td class="num">${num(l.qty)}</td>
              <td class="num">${eur(l.price_ht)}</td>
              ${open ? `<td class="actions"><button class="btn sm danger" data-rm="${l.id}">${icon('x', 13)}</button></td>` : ''}
            </tr>`).join('')}</tbody></table>` : '<div class="empty">Conteneur vide — ajoutez des retours finalises</div>'}
        </div>
      </div>`;

    const on = (sel, fn) => { const b = el.querySelector(sel); if (b) b.onclick = fn; };

    on('#ctpull', async () => {
      try {
        const r = await POST(`/api/containers/${c.id}/pull`);
        toast(`${r.added} ligne(s) ajoutee(s) au conteneur.`);
        render();
      } catch (e) { toastErr(e); }
    });
    on('#ctedit', () => {
      const { overlay, close } = modal({
        title: 'N° de retour fournisseur',
        body: field('N° de retour', input('supplier_return_number', c.supplier_return_number || '')),
        footer: `<button class="btn" data-act="c">Annuler</button><button class="btn primary" data-act="s">Enregistrer</button>`
      });
      overlay.querySelector('[data-act=c]').onclick = close;
      overlay.querySelector('[data-act=s]').onclick = async () => {
        try { await PUT('/api/containers/' + c.id, readForm(overlay)); toast('Enregistre.'); close(); render(); }
        catch (e) { toastErr(e); }
      };
    });
    on('#ctship', async () => {
      if (!await confirmDialog('Marquer ce conteneur comme expedie au fournisseur ? Le stock retour sera decompte et il ne recevra plus de nouveaux livres.')) return;
      try { await POST(`/api/containers/${c.id}/ship`); toast('Conteneur marque comme expedie.'); render(); }
      catch (e) { toastErr(e); }
    });
    on('#ctdel', async () => {
      if (!await confirmDialog('Supprimer ce conteneur ? Les lignes redeviendront disponibles.', { danger: true, okLabel: 'Supprimer' })) return;
      try { await DEL('/api/containers/' + c.id); toast('Conteneur supprime.'); ctx.navigate('containers'); }
      catch (e) { toastErr(e); }
    });
    el.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', async () => {
      try { await POST(`/api/containers/${c.id}/remove-line`, { line_id: b.dataset.rm }); render(); }
      catch (e) { toastErr(e); }
    }));
  };
  await render();
}
