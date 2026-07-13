import { GET, POST, PUT, DEL } from '../api.js';
import {
  esc, eur, num, fdate, icon, toast, toastErr, modal, confirmDialog, readForm,
  field, input, dataTable, orderStatusBadge, orderTypeLabel, invoiceStatusBadge, RETURN_MODES
} from '../ui.js';

function tierFormModal(type, existing, onSaved) {
  const t = existing || {};
  const isClient = (existing ? existing.type : type) === 'client';
  const { overlay, close } = modal({
    title: existing ? 'Modifier ' + t.name : (isClient ? 'Nouveau client' : 'Nouveau fournisseur'),
    wide: true,
    body: `<div class="form-grid">
      ${field('Nom *', input('name', t.name || '', 'required'), 'wide')}
      ${field(existing ? 'Code client' : 'Code client (vide = genere automatiquement)',
        input('code', t.code || '', `placeholder="${existing ? '' : 'Ex : MOLLAT-BX (personnalise ou laisser vide)'}"`))}
      ${field('Contact', input('contact_name', t.contact_name || ''))}
      ${field('Email', input('email', t.email || '', 'type="email"'))}
      ${field('Telephone', input('phone', t.phone || ''))}
      ${field('Delai de retour (mois)', input('delai_retour_mois', t.delai_retour_mois ?? 12, 'type="number" min="0"'))}
      ${field('SIRET', input('siret', t.siret || ''))}
      ${isClient ? field('Remise par defaut (%)', input('discount_pct', t.discount_pct ?? 0, 'type="number" step="0.1" min="0" max="100"')) : ''}
      ${isClient ? field('Plafond d\'encours TTC (0 = aucun)', input('credit_limit', t.credit_limit ?? 0, 'type="number" step="0.01" min="0"')) : ''}
      ${isClient ? field('Delai de paiement (jours, vide = global)', input('payment_terms_days', t.payment_terms_days ?? '', 'type="number" min="0"')) : ''}
      ${field('Adresse', input('address', t.address || ''), 'wide')}
      ${field('Code postal', input('zip', t.zip || ''))}
      ${field('Ville', input('town', t.town || ''))}
      ${field('Pays', input('country', t.country || 'France'))}
      ${field('Notes', `<textarea class="input" name="notes" rows="2">${esc(t.notes || '')}</textarea>`, 'wide')}
    </div>`,
    footer: `<button class="btn" data-act="c">Annuler</button>
      <button class="btn primary" data-act="s">${existing ? 'Enregistrer' : 'Creer'}</button>`
  });
  overlay.querySelector('[data-act=c]').onclick = close;
  overlay.querySelector('[data-act=s]').onclick = async () => {
    const data = readForm(overlay);
    data.type = existing ? existing.type : type;
    try {
      if (existing) await PUT('/api/thirdparties/' + existing.id, data);
      else await POST('/api/thirdparties', data);
      toast('Enregistre.');
      close(); onSaved();
    } catch (e) { toastErr(e); }
  };
}

export async function viewThirdparties(el, params, ctx) {
  const type = params.type;
  const isClient = type === 'client';
  let q = '';
  const render = async () => {
    const rows = await GET(`/api/thirdparties?type=${type}` + (q ? '&q=' + encodeURIComponent(q) : ''));
    el.querySelector('#tlist').innerHTML = dataTable({
      empty: isClient ? 'Aucun client' : 'Aucun fournisseur',
      columns: [
        { label: 'Code', render: (t) => `<span class="badge">${esc(t.code)}</span>` },
        { label: 'Nom', render: (t) => `<span class="main-cell">${esc(t.name)}</span><span class="sub">${esc(t.contact_name || '')}</span>` },
        { label: 'Ville', render: (t) => esc(t.town || '—') },
        { label: 'Contact', render: (t) => `${esc(t.email || '')}<span class="sub">${esc(t.phone || '')}</span>` },
        ...(isClient ? [
          { label: 'Delai retour', cls: 'num', render: (t) => (t.delai_retour_mois ?? 12) + ' mois' },
          { label: 'Portail', render: (t) => t.portal_enabled ? '<span class="badge green">Actif</span>' : '—' },
          { label: 'Cdes ouvertes', cls: 'num', render: (t) => t.open_orders ? `<span class="badge blue">${t.open_orders}</span>` : '—' }
        ] : [])
      ],
      rows,
      onRow: true,
      rowAttrs: (t) => `onclick="location.hash='#/tiers/${t.id}'"`
    });
  };

  el.innerHTML = `<div class="card">
    <div class="card-head">
      <div class="searchbar" style="width:320px">${icon('search')}<input class="input" id="tsearch" placeholder="Nom, code, ville…"></div>
      <div class="spacer"></div>
      <button class="btn primary" id="tnew">${icon('plus', 15)} ${isClient ? 'Nouveau client' : 'Nouveau fournisseur'}</button>
    </div>
    <div class="card-body flush" id="tlist"></div>
  </div>`;

  let t;
  el.querySelector('#tsearch').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => { q = e.target.value; render(); }, 250);
  });
  el.querySelector('#tnew').addEventListener('click', () => tierFormModal(type, null, render));
  await render();
}

export async function viewThirdparty(el, params, ctx) {
  const render = async () => {
    const t = await GET('/api/thirdparties/' + params.id);
    const s = t.stats;
    const isClient = t.type === 'client';
    const modeLabel = (m) => (RETURN_MODES.find((x) => x.value === m) || { label: m }).label;

    el.innerHTML = `
      <div style="margin-bottom:14px"><a href="#/${isClient ? 'clients' : 'fournisseurs'}">${icon('returns', 13)} Retour a la liste</a></div>
      <div class="card">
        <div class="card-head">
          <h2 style="font-size:17px">${esc(t.name)}</h2>
          <span class="badge">${esc(t.code)}</span>
          <span class="badge ${isClient ? 'blue' : 'purple'}">${isClient ? 'Client' : 'Fournisseur'}</span>
          ${t.portal_enabled ? '<span class="badge green">Portail actif</span>' : ''}
          <div class="spacer"></div>
          ${isClient ? `<button class="btn" id="tportal">${icon('store', 14)} Acces portail</button>` : ''}
          <button class="btn" id="tedit">${icon('edit', 14)} Modifier</button>
          <button class="btn danger" id="tdel">${icon('trash', 14)} Supprimer</button>
        </div>
        <div class="card-body">
          <div class="detail-grid">
            <div class="item"><b>Contact</b>${esc(t.contact_name || '—')}</div>
            <div class="item"><b>Email</b>${t.email ? `<a href="mailto:${esc(t.email)}">${esc(t.email)}</a>` : '—'}</div>
            <div class="item"><b>Telephone</b>${esc(t.phone || '—')}</div>
            <div class="item"><b>Adresse</b>${esc(t.address || '—')}<br>${esc(t.zip || '')} ${esc(t.town || '')}</div>
            ${isClient ? `<div class="item"><b>Delai de retour</b>${t.delai_retour_mois ?? 12} mois</div>` : ''}
            ${t.siret ? `<div class="item"><b>SIRET</b>${esc(t.siret)}</div>` : ''}
            ${isClient && t.discount_pct ? `<div class="item"><b>Remise par defaut</b>${t.discount_pct} %</div>` : ''}
            ${isClient && t.credit_limit ? `<div class="item"><b>Plafond d'encours</b>${eur(t.credit_limit)}</div>` : ''}
            ${isClient && t.payment_terms_days ? `<div class="item"><b>Delai de paiement</b>${t.payment_terms_days} jours</div>` : ''}
            ${t.portal_login ? `<div class="item"><b>Identifiant portail</b>${esc(t.portal_login)}</div>` : ''}
          </div>
          ${t.notes ? `<p style="color:var(--text-2);margin-bottom:0"><b>Notes :</b> ${esc(t.notes)}</p>` : ''}
        </div>
      </div>

      ${isClient ? `<div class="kpi-grid" style="margin-top:18px">
        <div class="kpi"><div class="kpi-label">${icon('euro', 15)} CA ${s.year} HT (avoirs deduits)</div><div class="kpi-value">${eur(s.ca_ht)}</div></div>
        <div class="kpi"><div class="kpi-label">${icon('returns', 15)} Avoirs ${s.year}</div><div class="kpi-value">${eur(s.avoirs_ht)}</div></div>
        <div class="kpi"><div class="kpi-label">${icon('invoice', 15)} Taux de retour</div><div class="kpi-value">${s.taux_retour} %</div></div>
        <div class="kpi"><div class="kpi-label">${icon('euro', 15)} Encours TTC (restant du)</div>
          <div class="kpi-value" style="color:${s.encours_ttc > 0.005 ? 'var(--warning)' : 'inherit'}">${eur(s.encours_ttc)}</div>
          <div class="kpi-sub">${s.avoirs_disponibles_ttc > 0.005 ? eur(s.avoirs_disponibles_ttc) + ' d’avoirs disponibles — ' : ''}<a href="/print/statement/${t.id}" target="_blank">Releve de compte</a></div></div>
      </div>` : ''}

      <div class="grid-2" style="margin-top:18px">
        ${isClient ? `
        <div class="card">
          <div class="card-head"><h2>Commandes recentes</h2></div>
          <div class="card-body flush">
            ${s.orders.length ? `<table class="table"><tbody>${s.orders.map((o) => `
              <tr class="clickable" onclick="location.hash='#/orders/${o.id}'">
                <td class="main-cell">${esc(o.ref)}<span class="sub">${fdate(o.date_order)} — ${esc(orderTypeLabel(o.order_type))}</span></td>
                <td class="num">${eur(o.total_ht)}</td>
                <td>${orderStatusBadge(o.status)}</td></tr>`).join('')}</tbody></table>`
            : '<div class="empty">Aucune commande</div>'}
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Retours recents</h2></div>
          <div class="card-body flush">
            ${s.returns.length ? `<table class="table"><tbody>${s.returns.map((r) => `
              <tr class="clickable" onclick="location.hash='#/returns/${r.id}'">
                <td class="main-cell">${esc(r.ref)}<span class="sub">${fdate(r.date_creation)} — ${esc(modeLabel(r.return_mode))}</span></td>
                <td>${r.status === 1 ? '<span class="badge green">Finalise</span>' : '<span class="badge orange">En scan</span>'}</td></tr>`).join('')}</tbody></table>`
            : '<div class="empty">Aucun retour</div>'}
          </div>
        </div>` : `
        <div class="card">
          <div class="card-head"><h2>Livres de ce fournisseur</h2></div>
          <div class="card-body flush">
            ${s.products.length ? `<table class="table"><thead><tr><th>Titre</th><th class="num">Prix HT</th><th class="num">Stock</th><th class="num">Retour</th></tr></thead><tbody>
              ${s.products.map((p) => `<tr class="clickable" onclick="location.hash='#/products/${p.id}'">
                <td class="main-cell">${esc(p.title)}<span class="sub">${esc(p.isbn)}</span></td>
                <td class="num">${eur(p.price_ht)}</td><td class="num">${num(p.stock_main)}</td><td class="num">${num(p.stock_return)}</td></tr>`).join('')}
            </tbody></table>` : '<div class="empty">Aucun livre reference</div>'}
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Conteneurs de retour</h2></div>
          <div class="card-body flush">
            ${s.containers.length ? `<table class="table"><tbody>${s.containers.map((c) => `
              <tr class="clickable" onclick="location.hash='#/containers/${c.id}'">
                <td class="main-cell">${esc(c.ref)}<span class="sub">${fdate(c.date_creation)}</span></td>
                <td>${c.status === 1 ? '<span class="badge green">Expedie</span>' : '<span class="badge blue">Ouvert</span>'}</td></tr>`).join('')}</tbody></table>`
            : '<div class="empty">Aucun conteneur</div>'}
          </div>
        </div>`}
      </div>

      <div class="card" style="margin-top:18px">
        <div class="card-head"><h2>Factures &amp; avoirs</h2></div>
        <div class="card-body flush">
          ${s.invoices.length ? `<table class="table"><thead><tr><th>Ref</th><th>Type</th><th>Date</th><th class="num">HT</th><th class="num">TTC</th><th>Statut</th><th></th></tr></thead><tbody>
            ${s.invoices.map((i) => `<tr>
              <td class="main-cell">${esc(i.ref)}</td>
              <td>${i.type === 'avoir' ? '<span class="badge orange">Avoir</span>' : '<span class="badge">Facture</span>'}</td>
              <td>${fdate(i.date_invoice)}</td>
              <td class="num">${eur(i.total_ht)}</td><td class="num">${eur(i.total_ttc)}</td>
              <td>${invoiceStatusBadge(i)}</td>
              <td class="actions"><a class="btn sm" href="/print/invoice/${i.id}" target="_blank">${icon('print', 13)}</a></td></tr>`).join('')}
          </tbody></table>` : '<div class="empty">Aucune facture</div>'}
        </div>
      </div>`;

    el.querySelector('#tedit').onclick = () => tierFormModal(t.type, t, render);
    el.querySelector('#tdel').onclick = async () => {
      if (!await confirmDialog(`Supprimer ${t.name} ?`, { danger: true, okLabel: 'Supprimer' })) return;
      try {
        const r = await DEL('/api/thirdparties/' + t.id);
        toast(r.archived ? 'Tiers archive (historique conserve).' : 'Tiers supprime.');
        ctx.navigate(isClient ? 'clients' : 'fournisseurs');
      } catch (e) { toastErr(e); }
    };
    const portalBtn = el.querySelector('#tportal');
    if (portalBtn) portalBtn.onclick = () => {
      const { overlay, close } = modal({
        title: 'Acces portail B2B — ' + t.name,
        body: `<p style="margin-top:0;color:var(--text-2);font-size:13px">
            Le libraire pourra consulter le catalogue, passer commande et suivre ses avoirs sur <b>/portal</b>.</p>
          <div class="form-grid">
          ${field('Identifiant portail', input('portal_login', t.portal_login || ''))}
          ${field('Mot de passe ' + (t.portal_enabled ? '(laisser vide pour conserver)' : '*'), input('portal_password', '', 'type="password"'))}
        </div>`,
        footer: `${t.portal_enabled ? '<button class="btn danger" data-act="off" style="margin-right:auto">Desactiver</button>' : ''}
          <button class="btn" data-act="c">Annuler</button>
          <button class="btn primary" data-act="s">Enregistrer</button>`
      });
      overlay.querySelector('[data-act=c]').onclick = close;
      const off = overlay.querySelector('[data-act=off]');
      if (off) off.onclick = async () => {
        try { await PUT(`/api/thirdparties/${t.id}/portal`, { disable: true }); toast('Acces portail desactive.'); close(); render(); }
        catch (e) { toastErr(e); }
      };
      overlay.querySelector('[data-act=s]').onclick = async () => {
        const f = readForm(overlay);
        try {
          await PUT(`/api/thirdparties/${t.id}/portal`, f);
          toast('Acces portail enregistre.');
          close(); render();
        } catch (e) { toastErr(e); }
      };
    };
  };
  await render();
}
