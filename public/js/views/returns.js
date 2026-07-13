import { GET, POST, PUT, DEL } from '../api.js';
import {
  esc, eur, num, fdate, icon, toast, toastErr, modal, confirmDialog, readForm,
  field, input, select, dataTable, RETURN_MODES, REFUSE_REASONS
} from '../ui.js';
import { clientPickerField, wireClientPicker } from './orders.js';

const modeLabel = (m) => (RETURN_MODES.find((x) => x.value === m) || { label: m }).label;
const statusBadge = (s) => s === 1 ? '<span class="badge dot green">Finalise</span>' : '<span class="badge dot orange">En scan</span>';

export async function viewReturns(el, params, ctx) {
  let status = '', q = '';
  const render = async () => {
    const rows = await GET(`/api/returns?status=${status}` + (q ? '&q=' + encodeURIComponent(q) : ''));
    el.querySelector('#rlist').innerHTML = dataTable({
      empty: 'Aucun retour',
      columns: [
        { label: 'Ref', render: (r) => `<span class="main-cell">${esc(r.ref)}</span><span class="sub">${fdate(r.date_creation)}</span>` },
        { label: 'Client', render: (r) => esc(r.client_name) },
        { label: 'Mode', render: (r) => `<span class="badge">${esc(modeLabel(r.return_mode))}</span>` },
        { label: 'Colis', cls: 'num', render: (r) => num(r.nb_colis) },
        { label: 'Bipes', cls: 'num', render: (r) => num(r.nb_scanned) },
        { label: 'Accepte HT', cls: 'num', render: (r) => eur(r.accepted_ht) },
        { label: 'Frais', cls: 'num', render: (r) => r.status === 1 ? eur(r.total_fees) : '—' },
        { label: 'Avoir', render: (r) => r.invoice_ref ? `<span class="badge green">${esc(r.invoice_ref)}</span>` : '—' },
        { label: 'Statut', render: (r) => statusBadge(r.status) }
      ],
      rows,
      onRow: true,
      rowAttrs: (r) => `onclick="location.hash='#/returns/${r.id}'"`
    });
  };

  el.innerHTML = `<div class="card">
    <div class="card-head">
      <div class="searchbar" style="width:280px">${icon('search')}<input class="input" id="rsearch" placeholder="Ref, client…"></div>
      <select class="input" id="rstatus" style="width:170px">
        <option value="">Tous</option><option value="0">En scan</option><option value="1">Finalises</option>
      </select>
      <div class="spacer"></div>
      <button class="btn primary" id="rnew">${icon('plus', 15)} Nouveau retour</button>
    </div>
    <div class="card-body flush" id="rlist"></div>
  </div>`;

  let t;
  el.querySelector('#rsearch').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { q = e.target.value; render(); }, 250); });
  el.querySelector('#rstatus').addEventListener('change', (e) => { status = e.target.value; render(); });
  el.querySelector('#rnew').addEventListener('click', () => {
    const { overlay, close } = modal({
      title: 'Nouveau retour client',
      body: `<div class="form-grid">
        ${clientPickerField()}
        ${field('Mode de retour', select('return_mode', RETURN_MODES, 'gradignan'))}
        ${field('Nombre de colis recus', input('nb_colis', 1, 'type="number" min="1"'))}
        ${field('Objet', input('objet', '', 'placeholder="Ex : retour rentree"'), 'wide')}
      </div>`,
      footer: `<button class="btn" data-act="c">Annuler</button><button class="btn primary" data-act="s">Commencer le scan</button>`
    });
    wireClientPicker(overlay);
    overlay.querySelector('[data-act=c]').onclick = close;
    overlay.querySelector('[data-act=s]').onclick = async () => {
      const data = readForm(overlay);
      if (!data.fk_client) return toast('Selectionnez un client dans la liste (tapez son nom ou son code).', 'error');
      try {
        const r = await POST('/api/returns', data);
        toast(`Retour ${r.ref} cree.`);
        close();
        ctx.navigate('returns/' + r.id);
      } catch (e) { toastErr(e); }
    };
  });
  await render();
}

export async function viewReturn(el, params, ctx) {
  let statusHtml = '';
  const render = async () => {
    const r = await GET('/api/returns/' + params.id);
    const scanning = r.status === 0;
    const accepted = r.lines.filter((l) => l.line_status === 1);
    const refused = r.lines.filter((l) => l.line_status === 0);

    const lineRow = (l) => `<tr>
      <td class="main-cell"><a href="#/products/${l.fk_product}">${esc(l.title)}</a>
        <span class="sub">${esc(l.isbn)} — ${esc(l.publisher || 'editeur inconnu')} — ${esc(l.supplier_name || 'sans fournisseur')}</span></td>
      <td class="num">${scanning ? `<input class="input" style="width:70px" type="number" min="1" value="${l.qty}" data-lqty="${l.id}">` : num(l.qty)}</td>
      <td class="num">${eur(l.price_ht)}</td>
      <td>${l.date_last_sale ? fdate(l.date_last_sale) : '<span class="badge red">Jamais vendu</span>'}</td>
      <td>${l.line_status === 1
        ? '<span class="badge green">Accepte</span>'
        : `<span class="badge red">Refuse — ${esc(REFUSE_REASONS[l.refuse_reason] || l.refuse_reason || '')}</span>`}</td>
      ${scanning ? `<td class="actions">
        ${l.line_status === 1
          ? `<button class="btn sm" data-refuse="${l.id}">Refuser</button>`
          : `<button class="btn sm" data-accept="${l.id}">Accepter</button>`}
        <button class="btn sm danger" data-ldel="${l.id}">${icon('trash', 13)}</button></td>` : ''}
    </tr>`;

    el.innerHTML = `
      <div style="margin-bottom:14px"><a href="#/returns">${icon('returns', 13)} Retour a la liste</a></div>
      <div class="card">
        <div class="card-head">
          <h2 style="font-size:17px">Retour ${esc(r.ref)}</h2>
          ${statusBadge(r.status)}
          <span class="badge">${esc(modeLabel(r.return_mode))}</span>
          <div class="spacer"></div>
          ${r.fk_invoice ? `<a class="btn" href="/print/invoice/${r.fk_invoice}" target="_blank">${icon('invoice', 14)} Avoir ${esc(r.invoice_ref)}</a>` : ''}
          ${scanning ? `<button class="btn" id="redit">${icon('edit', 14)} Parametres</button>
            <button class="btn primary" id="rfinalize">${icon('check', 14)} Finaliser (generer l'avoir)</button>
            <button class="btn danger" id="rdelete">${icon('trash', 14)}</button>` : ''}
        </div>
        <div class="card-body">
          <div class="detail-grid">
            <div class="item"><b>Client</b><a href="#/tiers/${r.fk_client}">${esc(r.client_name)}</a></div>
            <div class="item"><b>Taux de retour (client, ${new Date().getFullYear()})</b>
              <span class="badge ${r.client_taux_retour > 30 ? 'red' : r.client_taux_retour > 15 ? 'orange' : 'green'}">${r.client_taux_retour} %</span></div>
            <div class="item"><b>Delai de retour</b>${r.delai_retour_mois} mois</div>
            <div class="item"><b>Colis recus</b>${num(r.nb_colis)}</div>
            <div class="item"><b>Articles bipes</b>${num(r.nb_scanned)}</div>
            <div class="item"><b>Total accepte HT</b>${eur(r.accepted_ht)}</div>
            <div class="item"><b>${scanning ? 'Frais estimes' : 'Frais appliques'}</b>${eur(r.estimated_fees)}</div>
            ${r.objet ? `<div class="item"><b>Objet</b>${esc(r.objet)}</div>` : ''}
          </div>
          <div class="client-notes">
            <div class="client-notes-head"><b>Notes client</b>
              <button class="btn sm ghost" id="rnotes">${icon('edit', 12)} Modifier</button></div>
            <p>${r.client_notes ? esc(r.client_notes) : '<i>Aucune note</i>'}</p>
          </div>
        </div>
      </div>

      ${scanning ? `<div class="card" style="margin-top:18px">
        <div class="card-head"><h2>${icon('scan', 16)} Scanner les livres</h2></div>
        <div class="card-body">
          <div id="rstatusbox">${statusHtml}</div>
          <form id="rscan" style="display:flex;gap:10px;align-items:flex-end">
            <div style="flex:1">${field('ISBN du livre', input('isbn', '', 'class="input big" autocomplete="off" required'))}</div>
            <button class="btn primary lg">${icon('check', 16)} Scanner</button>
          </form>
          <p style="color:var(--text-3);font-size:12px;margin-bottom:0">
            Le systeme verifie automatiquement si le livre a ete achete chez nous et si le delai de retour
            (${r.delai_retour_mois} mois apres la derniere vente) est respecte. Vous pouvez corriger chaque ligne.</p>
        </div>
      </div>` : ''}

      <div class="card" style="margin-top:18px">
        <div class="card-head"><h2>Livres scannes — acceptes (${num(accepted.reduce((s, l) => s + l.qty, 0))})</h2></div>
        <div class="card-body flush">
          ${accepted.length ? `<table class="table">
            <thead><tr><th>Livre</th><th class="num">Qte</th><th class="num">PU HT</th><th>Derniere vente</th><th>Statut</th>${scanning ? '<th></th>' : ''}</tr></thead>
            <tbody>${accepted.map(lineRow).join('')}</tbody></table>` : '<div class="empty">Aucun livre accepte</div>'}
        </div>
      </div>

      ${refused.length ? `<div class="card" style="margin-top:18px">
        <div class="card-head"><h2>Refuses (${num(refused.reduce((s, l) => s + l.qty, 0))})</h2></div>
        <div class="card-body flush"><table class="table">
          <thead><tr><th>Livre</th><th class="num">Qte</th><th class="num">PU HT</th><th>Derniere vente</th><th>Statut</th>${scanning ? '<th></th>' : ''}</tr></thead>
          <tbody>${refused.map(lineRow).join('')}</tbody></table></div>
      </div>` : ''}`;

    const on = (sel, fn) => { const b = el.querySelector(sel); if (b) b.onclick = fn; };

    const scanForm = el.querySelector('#rscan');
    if (scanForm) {
      scanForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const isbn = scanForm.isbn.value.trim();
        if (!isbn) return;
        try {
          const res = await POST(`/api/returns/${r.id}/scan`, { isbn });
          const bookLine = `${esc(res.product.publisher || 'editeur inconnu')} — ${esc(res.product.supplier || 'sans fournisseur')}`;
          statusHtml = res.line_status === 1
            ? `<div class="scan-status ok"><div class="big-line">✓ ${esc(res.product.title)} : ACCEPTE</div>
                <div class="sub" style="margin-bottom:4px">${bookLine}</div>
                ${res.incremented ? 'Quantite incrementee.' : ''} Derniere vente : ${res.date_last_sale ? fdate(res.date_last_sale) : '—'}</div>`
            : `<div class="scan-status ko"><div class="big-line">✗ ${esc(res.product.title)} : REFUSE</div>
                <div class="sub" style="margin-bottom:4px">${bookLine}</div>
                Motif propose : ${esc(REFUSE_REASONS[res.refuse_reason] || res.refuse_reason)}
                ${res.refuse_reason === 'quota-depasse' ? ` — achete ${num(res.purchased_qty)}, deja retourne ${num(res.already_accepted_qty)}` : ''}
                 — corrigez la ligne si besoin.</div>`;
        } catch (err) {
          statusHtml = `<div class="scan-status ko"><div class="big-line">✗ Erreur</div>${esc(err.message)}</div>`;
        }
        render();
      });
      scanForm.querySelector('[name=isbn]').focus();
    }

    on('#rnotes', () => {
      const { overlay, close } = modal({
        title: 'Notes — ' + r.client_name,
        body: field('Notes', `<textarea class="input" name="notes" rows="5">${esc(r.client_notes || '')}</textarea>`, 'wide'),
        footer: `<button class="btn" data-act="c">Annuler</button><button class="btn primary" data-act="s">Enregistrer</button>`
      });
      overlay.querySelector('[data-act=c]').onclick = close;
      overlay.querySelector('[data-act=s]').onclick = async () => {
        try {
          await PUT('/api/thirdparties/' + r.fk_client, { notes: readForm(overlay).notes });
          toast('Notes du client mises a jour.');
          close(); render();
        } catch (e) { toastErr(e); }
      };
    });

    on('#redit', () => {
      const { overlay, close } = modal({
        title: 'Parametres du retour',
        body: `<div class="form-grid">
          ${field('Mode de retour', select('return_mode', RETURN_MODES, r.return_mode))}
          ${field('Nombre de colis', input('nb_colis', r.nb_colis, 'type="number" min="1"'))}
          ${field('Objet', input('objet', r.objet || ''), 'wide')}
        </div>`,
        footer: `<button class="btn" data-act="c">Annuler</button><button class="btn primary" data-act="s">Enregistrer</button>`
      });
      overlay.querySelector('[data-act=c]').onclick = close;
      overlay.querySelector('[data-act=s]').onclick = async () => {
        try { await PUT('/api/returns/' + r.id, readForm(overlay)); toast('Retour mis a jour.'); close(); render(); }
        catch (e) { toastErr(e); }
      };
    });

    on('#rfinalize', async () => {
      const ok = await confirmDialog(
        `Finaliser ce retour ? Les frais seront calcules (${eur(r.estimated_fees)} estimes), l'avoir genere et le stock retour mis a jour. Cette action est definitive.`,
        { okLabel: 'Finaliser' });
      if (!ok) return;
      try {
        const res = await POST(`/api/returns/${r.id}/finalize`);
        toast(`Retour finalise. Frais appliques : ${eur(res.fees)}.${res.invoice ? ` Avoir ${res.invoice.ref} genere.` : ''}`);
        render();
        ctx.refreshCounts();
      } catch (e) { toastErr(e); }
    });

    on('#rdelete', async () => {
      if (!await confirmDialog('Supprimer ce retour et toutes ses lignes ?', { danger: true, okLabel: 'Supprimer' })) return;
      try { await DEL('/api/returns/' + r.id); toast('Retour supprime.'); ctx.navigate('returns'); }
      catch (e) { toastErr(e); }
    });

    el.querySelectorAll('[data-refuse]').forEach((b) => b.addEventListener('click', () => {
      const { overlay, close } = modal({
        title: 'Refuser cette ligne',
        body: field('Motif du refus', select('refuse_reason',
          Object.entries(REFUSE_REASONS).map(([value, label]) => ({ value, label })), 'autre')),
        footer: `<button class="btn" data-act="c">Annuler</button><button class="btn danger" data-act="s">Refuser</button>`
      });
      overlay.querySelector('[data-act=c]').onclick = close;
      overlay.querySelector('[data-act=s]').onclick = async () => {
        try {
          await PUT(`/api/returns/${r.id}/lines/${b.dataset.refuse}`, { line_status: 0, refuse_reason: readForm(overlay).refuse_reason });
          close(); render();
        } catch (e) { toastErr(e); }
      };
    }));
    el.querySelectorAll('[data-accept]').forEach((b) => b.addEventListener('click', async () => {
      try { await PUT(`/api/returns/${r.id}/lines/${b.dataset.accept}`, { line_status: 1 }); render(); }
      catch (e) { toastErr(e); }
    }));
    el.querySelectorAll('[data-lqty]').forEach((inp) => inp.addEventListener('change', async () => {
      try { await PUT(`/api/returns/${r.id}/lines/${inp.dataset.lqty}`, { qty: inp.value }); render(); }
      catch (e) { toastErr(e); render(); }
    }));
    el.querySelectorAll('[data-ldel]').forEach((b) => b.addEventListener('click', async () => {
      try { await DEL(`/api/returns/${r.id}/lines/${b.dataset.ldel}`); render(); }
      catch (e) { toastErr(e); }
    }));
  };
  await render();
}
