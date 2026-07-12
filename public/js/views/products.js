import { GET, POST, PUT, DEL } from '../api.js';
import {
  esc, eur, num, fdate, fdatetime, icon, toast, toastErr, modal, confirmDialog,
  readForm, field, input, select, dataTable, FORMATS
} from '../ui.js';

const formatLabel = (f) => (FORMATS.find((x) => x.value === f) || { label: f || '—' }).label;

async function productFormModal(existing, onSaved) {
  const suppliers = await GET('/api/thirdparties?type=fournisseur');
  const p = existing || {};
  const supplierOpts = [{ value: '', label: '—' }].concat(suppliers.map((s) => ({ value: s.id, label: s.name })));
  const { overlay, close } = modal({
    title: existing ? 'Modifier le livre' : 'Nouveau livre',
    wide: true,
    body: `<div class="form-grid">
      ${field('ISBN / EAN13 *', input('isbn', p.isbn || '', 'required'))}
      ${field('Titre *', input('title', p.title || '', 'required'), 'wide')}
      ${field('Auteur', input('author', p.author || ''))}
      ${field('Editeur', input('publisher', p.publisher || ''))}
      ${field('Collection', input('collection', p.collection || ''))}
      ${field('Format', select('format', FORMATS, p.format || ''))}
      ${field('Nombre de pages', input('pages', p.pages ?? '', 'type="number" min="0"'))}
      ${field('Date de parution', input('date_parution', p.date_parution || '', 'type="date"'))}
      ${field('Fournisseur', select('fk_supplier', supplierOpts, p.fk_supplier ?? ''))}
      ${field('Remise editeur (%)', input('remise_editeur', p.remise_editeur ?? 0, 'type="number" step="0.1" min="0" max="100"'))}
      ${field('Prix de vente HT (€)', input('price_ht', p.price_ht ?? '', 'type="number" step="0.01" min="0" required'))}
      ${field("Prix d'achat HT (€)", input('buy_price_ht', p.buy_price_ht ?? '', 'type="number" step="0.01" min="0"'))}
      ${field('TVA (%)', input('tva_rate', p.tva_rate ?? 5.5, 'type="number" step="0.1" min="0"'))}
      ${field('Notes', `<textarea class="input" name="notes" rows="2">${esc(p.notes || '')}</textarea>`, 'wide')}
    </div>`,
    footer: `<button class="btn" data-act="cancel">Annuler</button>
      <button class="btn primary" data-act="save">${existing ? 'Enregistrer' : 'Creer le livre'}</button>`
  });
  overlay.querySelector('[data-act=cancel]').onclick = close;
  overlay.querySelector('[data-act=save]').onclick = async () => {
    const data = readForm(overlay);
    try {
      if (existing) await PUT('/api/products/' + existing.id, data);
      else await POST('/api/products', data);
      toast(existing ? 'Livre modifie.' : 'Livre cree.');
      close();
      onSaved();
    } catch (e) { toastErr(e); }
  };
}

export async function viewProducts(el, params, ctx) {
  let q = '';
  const render = async () => {
    const rows = await GET('/api/products' + (q ? '?q=' + encodeURIComponent(q) : ''));
    el.querySelector('#plist').innerHTML = dataTable({
      empty: 'Aucun livre trouve',
      columns: [
        { label: 'Titre', render: (p) => `<span class="main-cell">${esc(p.title)}</span><span class="sub">${esc(p.author || '')} — ${esc(p.publisher || '')}</span>` },
        { label: 'ISBN', render: (p) => esc(p.isbn) },
        { label: 'Format', render: (p) => esc(formatLabel(p.format)) },
        { label: 'Fournisseur', render: (p) => esc(p.supplier_name || '—') },
        { label: 'Prix HT', cls: 'num', render: (p) => eur(p.price_ht) },
        { label: 'Stock', cls: 'num', render: (p) => `<span class="badge ${p.stock_main <= 3 ? 'red' : p.stock_main <= 10 ? 'orange' : 'green'}">${num(p.stock_main)}</span>` },
        { label: 'Retour', cls: 'num', render: (p) => p.stock_return > 0 ? `<span class="badge orange">${num(p.stock_return)}</span>` : '—' }
      ],
      rows,
      onRow: true,
      rowAttrs: (p) => `onclick="location.hash='#/products/${p.id}'"`
    });
  };

  el.innerHTML = `<div class="card">
    <div class="card-head">
      <div class="searchbar" style="width:340px">${icon('search')}<input class="input" id="psearch" placeholder="Titre, auteur, editeur, ISBN…"></div>
      <div class="spacer"></div>
      <button class="btn primary" id="pnew">${icon('plus', 15)} Nouveau livre</button>
    </div>
    <div class="card-body flush" id="plist"></div>
  </div>`;

  let t;
  el.querySelector('#psearch').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => { q = e.target.value; render(); }, 250);
  });
  el.querySelector('#pnew').addEventListener('click', () => productFormModal(null, render));
  await render();
}

export async function viewProduct(el, params, ctx) {
  const render = async () => {
    const p = await GET('/api/products/' + params.id);
    const placed = p.gisements.reduce((s, g) => s + g.qty, 0);
    el.innerHTML = `
      <div style="margin-bottom:14px"><a href="#/products">${icon('returns', 13)} Retour au catalogue</a></div>
      <div class="card">
        <div class="card-head">
          <h2 style="font-size:17px">${esc(p.title)}</h2>
          <span class="badge">${esc(p.isbn)}</span>
          <div class="spacer"></div>
          <button class="btn" id="pedit">${icon('edit', 14)} Modifier</button>
          <button class="btn danger" id="pdel">${icon('trash', 14)} Supprimer</button>
        </div>
        <div class="card-body">
          <div class="detail-grid">
            <div class="item"><b>Auteur</b>${esc(p.author || '—')}</div>
            <div class="item"><b>Editeur</b>${esc(p.publisher || '—')}</div>
            <div class="item"><b>Collection</b>${esc(p.collection || '—')}</div>
            <div class="item"><b>Format</b>${esc(formatLabel(p.format))}</div>
            <div class="item"><b>Pages</b>${p.pages || '—'}</div>
            <div class="item"><b>Parution</b>${fdate(p.date_parution)}</div>
            <div class="item"><b>Fournisseur</b>${p.fk_supplier ? `<a href="#/tiers/${p.fk_supplier}">${esc(p.supplier_name)}</a>` : '—'}</div>
            <div class="item"><b>Remise editeur</b>${p.remise_editeur || 0} %</div>
            <div class="item"><b>Prix vente HT</b>${eur(p.price_ht)}</div>
            <div class="item"><b>Prix achat HT</b>${eur(p.buy_price_ht)}</div>
            <div class="item"><b>TVA</b>${p.tva_rate} %</div>
          </div>
          ${p.notes ? `<p style="color:var(--text-2);margin-bottom:0"><b>Notes :</b> ${esc(p.notes)}</p>` : ''}
        </div>
      </div>

      <div class="kpi-grid" style="margin-top:18px">
        <div class="kpi"><div class="kpi-label">${icon('warehouse', 15)} Stock principal</div>
          <div class="kpi-value">${num(p.stock_main)}</div>
          <div class="kpi-sub">${num(placed)} places en gisements${placed < p.stock_main ? ` — <span style="color:var(--warning)">${num(p.stock_main - placed)} non places</span>` : ''}</div></div>
        <div class="kpi"><div class="kpi-label">${icon('returns', 15)} Stock retour</div>
          <div class="kpi-value">${num(p.stock_return)}</div><div class="kpi-sub">non commandable</div></div>
      </div>

      <div class="grid-2" style="margin-top:18px">
        <div class="card">
          <div class="card-head"><h2>Emplacements (gisements)</h2>
            <div class="spacer"></div><button class="btn sm" id="passign">${icon('plus', 13)} Affecter</button></div>
          <div class="card-body flush">
            ${p.gisements.length ? `<table class="table"><thead><tr><th>Gisement</th><th>Etage</th><th class="num">Qte</th></tr></thead><tbody>
              ${p.gisements.map((g) => `<tr class="clickable" onclick="location.hash='#/gisements/${g.id}'">
                <td class="main-cell">${esc(g.code)}</td><td>${esc(g.etage || '—')}</td><td class="num">${num(g.qty)}</td></tr>`).join('')}
            </tbody></table>` : `<div class="empty">Ce livre n'est affecte a aucun gisement</div>`}
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h2>Derniers mouvements de stock</h2></div>
          <div class="card-body flush">
            ${p.movements.length ? `<table class="table"><tbody>
              ${p.movements.map((m) => `<tr>
                <td>${esc(m.label)}<span class="sub">${fdatetime(m.date_creation)} — ${esc(m.user_name || '')}</span></td>
                <td><span class="badge">${m.warehouse === 'return' ? 'Retour' : 'Principal'}</span></td>
                <td class="num"><span class="badge ${m.qty > 0 ? 'green' : 'orange'}">${m.qty > 0 ? '+' : ''}${num(m.qty)}</span></td></tr>`).join('')}
            </tbody></table>` : '<div class="empty">Aucun mouvement</div>'}
          </div>
        </div>
      </div>`;

    el.querySelector('#pedit').onclick = () => productFormModal(p, render);
    el.querySelector('#pdel').onclick = async () => {
      if (!await confirmDialog(`Supprimer "${p.title}" du catalogue ?`, { danger: true, okLabel: 'Supprimer' })) return;
      try { await DEL('/api/products/' + p.id); toast('Livre supprime.'); ctx.navigate('products'); }
      catch (e) { toastErr(e); }
    };
    el.querySelector('#passign').onclick = async () => {
      const gisements = await GET('/api/gisements');
      const opts = gisements.map((g) => ({ value: g.id, label: g.code + (g.etage ? ' — ' + g.etage : '') }));
      if (!opts.length) return toast('Creez d\'abord un gisement.', 'error');
      const { overlay, close } = modal({
        title: 'Affecter a un gisement',
        body: `<div class="form-grid">
          ${field('Gisement', select('gisement_id', opts, opts[0].value))}
          ${field('Quantite (negative pour retirer)', input('qty', 1, 'type="number"'))}
        </div>`,
        footer: `<button class="btn" data-act="c">Annuler</button><button class="btn primary" data-act="s">Affecter</button>`
      });
      overlay.querySelector('[data-act=c]').onclick = close;
      overlay.querySelector('[data-act=s]').onclick = async () => {
        try {
          const f = readForm(overlay);
          await POST('/api/warehouse/assign', { product_id: p.id, gisement_id: f.gisement_id, qty: f.qty });
          toast('Affectation enregistree.');
          close(); render();
        } catch (e) { toastErr(e); }
      };
    };
  };
  await render();
}
