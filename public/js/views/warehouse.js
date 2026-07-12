import { GET, POST, PUT, DEL } from '../api.js';
import {
  esc, eur, num, icon, toast, toastErr, modal, confirmDialog, readForm,
  field, input, dataTable, orderStatusBadge, orderTypeLabel
} from '../ui.js';

/* ============================= FILE DE PREPARATION ============================= */
export async function viewQueue(el, params, ctx) {
  const rows = await GET('/api/warehouse/queue');
  el.innerHTML = `<div class="card">
    <div class="card-head"><h2>Commandes a preparer, par priorite</h2></div>
    <div class="card-body flush" id="qlist"></div>
  </div>`;
  el.querySelector('#qlist').innerHTML = dataTable({
    empty: 'Aucune commande en attente — la file est vide 🎉',
    columns: [
      { label: 'Ref', render: (o) => `<span class="main-cell">${esc(o.ref)}</span>` },
      { label: 'Client', render: (o) => `${esc(o.client_name)}<span class="sub">${esc(o.client_town || '')}</span>` },
      { label: 'Type', render: (o) => `<span class="badge">${esc(orderTypeLabel(o.order_type))}</span>` },
      { label: 'Prio', cls: 'num', render: (o) => `<span class="badge ${o.priority <= 2 ? 'red' : o.priority <= 4 ? 'orange' : ''}">P${o.priority}</span>` },
      { label: 'Lignes', cls: 'num', render: (o) => num(o.nb_lines) },
      { label: 'Avancement', render: (o) => `<div style="min-width:120px"><div class="progress"><div style="width:${o.qty_total ? Math.round(o.qty_picked / o.qty_total * 100) : 0}%"></div></div>
        <span class="sub">${num(o.qty_picked)} / ${num(o.qty_total)} ex.</span></div>` },
      { label: 'Statut', render: (o) => orderStatusBadge(o.status) },
      { label: '', cls: 'actions', render: (o) => o.status === 1
          ? `<button class="btn primary sm" data-start="${o.id}">${icon('scan', 13)} Preparer</button>`
          : `<a class="btn sm" href="#/picking/${o.id}">${icon('scan', 13)} Reprendre</a>` }
    ],
    rows,
    onRow: true,
    rowAttrs: (o) => `data-oid="${o.id}"`
  });
  el.querySelectorAll('[data-oid]').forEach((tr) => tr.addEventListener('click', (e) => {
    if (e.target.closest('button, a')) return;
    location.hash = '#/orders/' + tr.dataset.oid;
  }));
  el.querySelectorAll('[data-start]').forEach((btn) => btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    try { await POST(`/api/orders/${btn.dataset.start}/start-picking`); ctx.navigate('picking/' + btn.dataset.start); }
    catch (err) { toastErr(err); }
  }));
}

/* ============================= PICKING (scan) ============================= */
/*
 * Flux entrepot : on scanne d'abord une caisse ou un chariot (il est lie a la
 * commande), puis chaque bip d'ISBN valide automatiquement un exemplaire.
 * Si le stock ne permet pas de servir, la ligne est marquee "indisponible"
 * (elle partira en reliquat) et la preparation se cloture toute seule quand
 * toutes les lignes sont servies ou indisponibles.
 */
export async function viewPicking(el, params, ctx) {
  let statusHtml = '';

  const finish = (o, msg) => {
    localStorage.removeItem('activePicking');
    toast(msg || 'Commande preparee — direction emballage !');
    ctx.navigate('orders/' + o.id);
  };

  const render = async () => {
    const o = await GET('/api/orders/' + params.id);
    if (o.status !== 2) {
      if (localStorage.getItem('activePicking') === String(o.id)) localStorage.removeItem('activePicking');
      ctx.navigate('orders/' + o.id);
      return;
    }
    localStorage.setItem('activePicking', String(o.id));
    const progress = o.qty_total ? Math.round(o.qty_picked / o.qty_total * 100) : 0;
    const crates = o.crates || [];
    const hasCrate = crates.length > 0;

    const crateBadges = crates.map((c) =>
      `<span class="badge green">${icon('box', 12)} ${esc(c.code)}</span>`).join(' ');

    const scanPanel = hasCrate
      ? `<form id="pkform" class="form-grid" style="grid-template-columns:1fr 1fr;align-items:end">
          ${field('ISBN du livre — chaque bip valide 1 exemplaire', input('isbn', '', 'class="input big" autocomplete="off" autofocus'))}
          ${field('Gisement (scan, optionnel)', input('gisement_code', '', 'class="input big" autocomplete="off"'))}
        </form>
        <p style="color:var(--text-3);font-size:12px;margin-bottom:0">
          La validation est automatique au scan — aucun clic necessaire, meme depuis un autre ecran.
          Scannez une autre caisse pour l'ajouter a la commande.</p>`
      : `<form id="crform">
          ${field('Scannez la caisse ou le chariot pour demarrer', input('code', '', 'class="input big" autocomplete="off" autofocus placeholder="Code de la caisse…"'))}
        </form>
        <p style="color:var(--text-3);font-size:12px;margin-bottom:0">
          La caisse est liee a cette commande : la scanner depuis n'importe quel ecran ramene a cette preparation.
          <a href="#/caisses">Gerer les caisses & chariots</a></p>`;

    el.innerHTML = `
      <div style="margin-bottom:14px"><a href="#/queue">${icon('returns', 13)} Retour a la file</a></div>
      <div class="grid-3-2">
        <div>
          <div class="card">
            <div class="card-head">
              <h2>Picking — ${esc(o.ref)} · ${esc(o.client_name)}</h2>
              ${crateBadges}
              <div class="spacer"></div>
              <a class="btn sm" href="/print/order/${o.id}" target="_blank">${icon('print', 13)} Bon</a>
              <button class="btn sm" id="pkclose">Cloturer (reliquats)</button>
            </div>
            <div class="card-body">
              <div class="progress" style="margin-bottom:6px"><div style="width:${progress}%"></div></div>
              <div style="color:var(--text-2);font-size:13px;margin-bottom:16px">${num(o.qty_picked)} / ${num(o.qty_total)} exemplaires prepares</div>
              <div id="pkstatus">${statusHtml}</div>
              ${scanPanel}
            </div>
          </div>
        </div>
        <div>
          <div class="card">
            <div class="card-head"><h2>Lignes a preparer</h2></div>
            <div class="card-body flush">
              <table class="table"><tbody>
                ${o.lines.map((l) => {
                  const done = l.qty_picked >= l.qty;
                  const badge = l.unavailable
                    ? `<span class="badge red">Indispo. ${num(l.qty_picked)} / ${num(l.qty)}</span>`
                    : `<span class="badge ${done ? 'green' : 'blue'}">${num(l.qty_picked)} / ${num(l.qty)}</span>`;
                  const action = done ? ''
                    : l.unavailable
                      ? `<button class="btn sm" data-reav="${l.id}" title="Annuler l'indisponibilite">↩</button>`
                      : `<button class="btn sm" data-unav="${l.id}" title="Stock insuffisant : marquer indisponible (reliquat)">Indispo.</button>`;
                  return `<tr style="${done || l.unavailable ? 'opacity:.55' : ''}">
                    <td class="main-cell">${esc(l.title)}<span class="sub">${esc(l.isbn)} — ${esc(l.locations || 'aucun gisement')}</span></td>
                    <td class="num">${badge}</td>
                    <td class="actions">${action}</td></tr>`;
                }).join('')}
              </tbody></table>
            </div>
          </div>
        </div>
      </div>`;

    /* Etape 1 : liaison de la caisse / du chariot */
    const crform = el.querySelector('#crform');
    if (crform) {
      const submitCrate = async () => {
        const { code } = readForm(crform);
        if (!code) return;
        try {
          const r = await POST(`/api/orders/${o.id}/assign-crate`, { code });
          statusHtml = `<div class="scan-status ok"><div class="big-line">✓ ${r.crate.type === 'chariot' ? 'Chariot' : 'Caisse'} ${esc(r.crate.code)} lie(e)</div>
            Scannez maintenant les ISBN des livres.</div>`;
        } catch (err) {
          statusHtml = `<div class="scan-status ko"><div class="big-line">✗ Refus</div>${esc(err.message)}</div>`;
        }
        render();
      };
      crform.addEventListener('submit', (e) => { e.preventDefault(); submitCrate(); });
      const codeEl = crform.querySelector('[name=code]');
      codeEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitCrate(); } });
      codeEl.focus();
    }

    /* Etape 2 : bips ISBN — validation automatique (Entree envoyee par la douchette) */
    const form = el.querySelector('#pkform');
    if (form) {
      const isbnEl = form.querySelector('[name=isbn]');
      const submit = async () => {
        const f = readForm(form);
        if (!f.isbn) return;
        // Une caisse scannee dans le champ ISBN est liee a la commande (caisse supplementaire)
        try {
          const s = await POST('/api/scan', { code: f.isbn });
          if (s.kind === 'crate') {
            const r = await POST(`/api/orders/${o.id}/assign-crate`, { code: f.isbn });
            statusHtml = `<div class="scan-status ok"><div class="big-line">✓ ${r.crate.type === 'chariot' ? 'Chariot' : 'Caisse'} ${esc(r.crate.code)} ajoute(e)</div></div>`;
            render();
            return;
          }
          if (s.kind === 'gisement') {
            form.querySelector('[name=gisement_code]').value = s.gisement.code;
            isbnEl.value = '';
            isbnEl.focus();
            return;
          }
        } catch { /* code inconnu du resolveur : on tente le pick, qui donnera l'erreur precise */ }
        try {
          const r = await POST(`/api/orders/${o.id}/pick`, f);
          statusHtml = `<div class="scan-status ok"><div class="big-line">✓ ${esc(r.product.title)}</div>
            ${r.qty} exemplaire(s) preleve(s) — ${num(r.picked)} / ${num(r.total)}</div>`;
          if (r.done) { finish(o); return; }
        } catch (err) {
          const line = o.lines.find((l) => l.isbn.replace(/[\s-]/g, '') === f.isbn.replace(/[\s-]/g, ''));
          const canMark = line && !line.unavailable && line.qty_picked < line.qty;
          statusHtml = `<div class="scan-status ko"><div class="big-line">✗ Refus</div>${esc(err.message)}
            ${canMark ? `<div style="margin-top:8px"><button class="btn sm" id="pkmarkunav" data-line="${line.id}">Marquer indisponible (reliquat)</button></div>` : ''}</div>`;
        }
        render();
      };
      form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
      // La touche Entree (envoyee par la douchette) valide, quel que soit le champ
      form.querySelectorAll('input').forEach((inp) =>
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }));
      // Douchette sans suffixe Entree : un EAN13 complet se valide tout seul
      let autoT;
      isbnEl.addEventListener('input', () => {
        clearTimeout(autoT);
        if (/^\d{13}$/.test(isbnEl.value.trim())) autoT = setTimeout(submit, 150);
      });
      isbnEl.focus();
    }

    /* Marquage / annulation "indisponible" */
    const markUnavailable = async (lineId, undo) => {
      try {
        const r = await POST(`/api/orders/${o.id}/lines/${lineId}/unavailable`, { undo: !!undo });
        if (r.done) { finish(o, 'Toutes les lignes sont traitees — commande preparee, direction emballage !'); return; }
        render();
      } catch (e) { toastErr(e); }
    };
    el.querySelectorAll('[data-unav]').forEach((b) => b.addEventListener('click', () => markUnavailable(b.dataset.unav)));
    el.querySelectorAll('[data-reav]').forEach((b) => b.addEventListener('click', () => markUnavailable(b.dataset.reav, true)));
    const mk = el.querySelector('#pkmarkunav');
    if (mk) mk.addEventListener('click', () => { statusHtml = ''; markUnavailable(mk.dataset.line); });

    el.querySelector('#pkclose').onclick = async () => {
      if (!await confirmDialog('Cloturer la preparation ? Les quantites non preparees resteront en reliquat.')) return;
      try {
        await POST(`/api/orders/${o.id}/close-picking`);
        finish(o, 'Preparation cloturee.');
      } catch (e) { toastErr(e); }
    };
  };
  await render();
}

/* ============================= CAISSES & CHARIOTS ============================= */
function crateFormModal(existing, onSaved) {
  const c = existing || {};
  const { overlay, close } = modal({
    title: existing ? 'Modifier la caisse' : 'Nouvelle caisse / chariot',
    body: `<div class="form-grid">
      ${field('Code * (sert de code-barres)', input('code', c.code || '', 'required placeholder="Ex : CAISSE-05"'))}
      ${field('Type', `<select class="input" name="type">
        <option value="caisse" ${c.type !== 'chariot' ? 'selected' : ''}>Caisse</option>
        <option value="chariot" ${c.type === 'chariot' ? 'selected' : ''}>Chariot</option>
      </select>`)}
    </div>`,
    footer: `<button class="btn" data-act="c">Annuler</button><button class="btn primary" data-act="s">${existing ? 'Enregistrer' : 'Creer'}</button>`
  });
  overlay.querySelector('[data-act=c]').onclick = close;
  overlay.querySelector('[data-act=s]').onclick = async () => {
    try {
      const data = readForm(overlay);
      if (existing) await PUT('/api/crates/' + existing.id, data);
      else await POST('/api/crates', data);
      toast('Caisse enregistree.');
      close(); onSaved();
    } catch (e) { toastErr(e); }
  };
}

export async function viewCrates(el, params, ctx) {
  const render = async () => {
    const rows = await GET('/api/crates');
    el.querySelector('#crlist').innerHTML = dataTable({
      empty: 'Aucune caisse — creez vos caisses et chariots puis imprimez leurs etiquettes',
      columns: [
        { label: 'Code', render: (c) => `<span class="main-cell">${esc(c.code)}</span>` },
        { label: 'Type', render: (c) => `<span class="badge">${c.type === 'chariot' ? 'Chariot' : 'Caisse'}</span>` },
        { label: 'Commande en cours', render: (c) => c.order_ref
            ? `<a href="#/${c.order_status === 2 ? 'picking' : 'orders'}/${c.fk_order}">${esc(c.order_ref)}</a><span class="sub">${esc(c.client_name || '')}</span>`
            : '<span class="badge green">Libre</span>' },
        { label: '', cls: 'actions', render: (c) => `
            ${c.fk_order ? `<button class="btn sm" data-release="${c.id}" title="Detacher de la commande">Liberer</button>` : ''}
            <button class="btn sm" data-edit="${c.id}">${icon('edit', 13)}</button>
            <button class="btn sm danger" data-del="${c.id}">${icon('trash', 13)}</button>` }
      ],
      rows
    });
    el.querySelectorAll('[data-release]').forEach((b) => b.addEventListener('click', async () => {
      try { await POST(`/api/crates/${b.dataset.release}/release`); toast('Caisse liberee.'); render(); }
      catch (e) { toastErr(e); }
    }));
    el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
      crateFormModal(rows.find((c) => c.id === Number(b.dataset.edit)), render);
    }));
    el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!await confirmDialog('Supprimer cette caisse ?', { danger: true, okLabel: 'Supprimer' })) return;
      try { await DEL('/api/crates/' + b.dataset.del); toast('Caisse supprimee.'); render(); }
      catch (e) { toastErr(e); }
    }));
  };
  el.innerHTML = `<div class="card">
    <div class="card-head">
      <h2>Caisses &amp; chariots de picking</h2>
      <div class="spacer"></div>
      <a class="btn" href="/print/labels/crates" target="_blank">${icon('print', 14)} Etiquettes code-barres</a>
      <button class="btn primary" id="crnew">${icon('plus', 15)} Nouvelle caisse</button>
    </div>
    <div class="card-body" style="padding-bottom:0">
      <p style="margin-top:0;color:var(--text-2)">Scannez une caisse au debut d'une preparation pour la lier a la commande :
      les bips d'ISBN valident ensuite automatiquement les lignes, depuis n'importe quel ecran.
      La caisse se libere a l'expedition de la commande.</p>
    </div>
    <div class="card-body flush" id="crlist"></div>
  </div>`;
  el.querySelector('#crnew').addEventListener('click', () => crateFormModal(null, render));
  await render();
}

/* ============================= GISEMENTS ============================= */
function gisementFormModal(existing, onSaved) {
  const g = existing || {};
  const { overlay, close } = modal({
    title: existing ? 'Modifier le gisement' : 'Nouveau gisement',
    body: `<div class="form-grid">
      ${field('Code du gisement * (sert de code-barres)', input('code', g.code || '', 'required placeholder="Ex : 01-INTERFORUM-A"'))}
      ${field('Etage / zone', input('etage', g.etage || '', 'placeholder="Ex : RDC"'))}
    </div>`,
    footer: `<button class="btn" data-act="c">Annuler</button><button class="btn primary" data-act="s">${existing ? 'Enregistrer' : 'Creer'}</button>`
  });
  overlay.querySelector('[data-act=c]').onclick = close;
  overlay.querySelector('[data-act=s]').onclick = async () => {
    try {
      const data = readForm(overlay);
      if (existing) await PUT('/api/gisements/' + existing.id, data);
      else await POST('/api/gisements', data);
      toast('Gisement enregistre.');
      close(); onSaved();
    } catch (e) { toastErr(e); }
  };
}

export async function viewGisements(el, params, ctx) {
  let q = '';
  const render = async () => {
    const rows = await GET('/api/gisements' + (q ? '?q=' + encodeURIComponent(q) : ''));
    el.querySelector('#glist').innerHTML = dataTable({
      empty: 'Aucun gisement',
      columns: [
        { label: 'Code', render: (g) => `<span class="main-cell">${esc(g.code)}</span>` },
        { label: 'Etage / zone', render: (g) => esc(g.etage || '—') },
        { label: 'References', cls: 'num', render: (g) => num(g.nb_refs) },
        { label: 'Exemplaires', cls: 'num', render: (g) => `<span class="badge ${g.qty_total > 0 ? 'green' : ''}">${num(g.qty_total)}</span>` }
      ],
      rows,
      onRow: true,
      rowAttrs: (g) => `onclick="location.hash='#/gisements/${g.id}'"`
    });
  };
  el.innerHTML = `<div class="card">
    <div class="card-head">
      <div class="searchbar" style="width:280px">${icon('search')}<input class="input" id="gsearch" placeholder="Code…"></div>
      <div class="spacer"></div>
      <a class="btn" href="/print/labels/gisements" target="_blank">${icon('print', 14)} Etiquettes code-barres</a>
      <button class="btn primary" id="gnew">${icon('plus', 15)} Nouveau gisement</button>
    </div>
    <div class="card-body flush" id="glist"></div>
  </div>`;
  let t;
  el.querySelector('#gsearch').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { q = e.target.value; render(); }, 250); });
  el.querySelector('#gnew').addEventListener('click', () => gisementFormModal(null, render));
  await render();
}

export async function viewGisement(el, params, ctx) {
  const render = async () => {
    const g = await GET('/api/gisements/' + params.id);
    const total = g.products.reduce((s, p) => s + p.qty, 0);
    el.innerHTML = `
      <div style="margin-bottom:14px"><a href="#/gisements">${icon('returns', 13)} Retour aux gisements</a></div>
      <div class="card">
        <div class="card-head">
          <h2 style="font-size:17px">${icon('location', 18)} ${esc(g.code)}</h2>
          ${g.etage ? `<span class="badge">${esc(g.etage)}</span>` : ''}
          <span class="badge green">${num(total)} exemplaires</span>
          <div class="spacer"></div>
          <button class="btn" id="gedit">${icon('edit', 14)} Modifier</button>
          <button class="btn danger" id="gdel">${icon('trash', 14)} Supprimer</button>
        </div>
        <div class="card-body flush">
          ${g.products.length ? `<table class="table">
            <thead><tr><th>Titre</th><th>ISBN</th><th>Editeur</th><th class="num">Qte</th></tr></thead><tbody>
            ${g.products.map((p) => `<tr class="clickable" onclick="location.hash='#/products/${p.id}'">
              <td class="main-cell">${esc(p.title)}<span class="sub">${esc(p.author || '')}</span></td>
              <td>${esc(p.isbn)}</td><td>${esc(p.publisher || '—')}</td><td class="num">${num(p.qty)}</td></tr>`).join('')}
          </tbody></table>` : '<div class="empty">Ce gisement est vide</div>'}
        </div>
      </div>`;
    el.querySelector('#gedit').onclick = () => gisementFormModal(g, render);
    el.querySelector('#gdel').onclick = async () => {
      if (!await confirmDialog(`Supprimer le gisement ${g.code} ?`, { danger: true, okLabel: 'Supprimer' })) return;
      try { await DEL('/api/gisements/' + g.id); toast('Gisement supprime.'); ctx.navigate('gisements'); }
      catch (e) { toastErr(e); }
    };
  };
  await render();
}

/* ============================= ECRANS SCAN ============================= */
function scanScreen(el, { title, help, fields, submitLabel, onSubmit, keepFields = [] }) {
  let statusHtml = '';
  let feed = [];
  const render = () => {
    el.innerHTML = `<div class="scan-panel">
      <div class="card">
        <div class="card-head"><h2>${icon('scan', 17)} ${esc(title)}</h2></div>
        <div class="card-body">
          <p style="margin-top:0;color:var(--text-2)">${help}</p>
          <div id="scstatus">${statusHtml}</div>
          <form id="scform">
            <div class="form-grid" style="grid-template-columns:1fr">
              ${fields.map((f) => field(f.label, input(f.name, f.value || '', `class="input big" autocomplete="off" ${f.attrs || ''}`))).join('')}
            </div>
            <button class="btn primary lg" style="margin-top:14px;width:100%;justify-content:center">${icon('check', 16)} ${esc(submitLabel)}</button>
          </form>
          ${feed.length ? `<ul class="scan-feed">${feed.map((f) => `<li>${f}</li>`).join('')}</ul>` : ''}
        </div>
      </div>
    </div>`;
    const form = el.querySelector('#scform');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = readForm(form);
      try {
        const r = await onSubmit(data);
        statusHtml = `<div class="scan-status ok"><div class="big-line">✓ ${esc(r.line)}</div>${r.sub || ''}</div>`;
        feed.unshift(`${icon('check', 13)} ${esc(r.line)}`);
        feed = feed.slice(0, 12);
      } catch (err) {
        statusHtml = `<div class="scan-status ko"><div class="big-line">✗ Refus</div>${esc(err.message)}</div>`;
      }
      const kept = {};
      for (const k of keepFields) kept[k] = data[k];
      render();
      const form2 = el.querySelector('#scform');
      for (const [k, v] of Object.entries(kept)) form2.querySelector(`[name=${k}]`).value = v;
      const focusField = fields.find((f) => !keepFields.includes(f.name));
      form2.querySelector(`[name=${focusField ? focusField.name : fields[0].name}]`).focus();
    });
    const focusEl = form.querySelector('input');
    if (focusEl) focusEl.focus();
  };
  render();
}

export async function viewRangement(el) {
  scanScreen(el, {
    title: 'Rangement (placement en gisement)',
    help: 'Scannez le <b>code du gisement</b> puis l\'<b>ISBN</b> de chaque livre a placer. Le rangement place des exemplaires deja recus (stock principal) dans leur emplacement — l\'entree de stock se fait via <a href="#/receptions">Achats &gt; Receptions</a>.',
    fields: [
      { label: 'Code du gisement', name: 'gisement_code', attrs: 'required' },
      { label: 'ISBN du livre', name: 'isbn', attrs: 'required' },
      { label: 'Quantite', name: 'qty', value: 1, attrs: 'type="number" min="1"' }
    ],
    submitLabel: 'Ranger',
    keepFields: ['gisement_code'],
    onSubmit: async (data) => {
      const r = await POST('/api/warehouse/rangement', data);
      return {
        line: `${r.qty} × ${r.product.title}`,
        sub: `places dans ${esc(r.gisement)}${r.unplaced > 0 ? ` — reste ${r.unplaced} exemplaire(s) a placer` : ''}`
      };
    }
  });
}

export async function viewTransfert(el) {
  scanScreen(el, {
    title: 'Transfert entre gisements',
    help: 'Deplace des exemplaires d\'un gisement vers un autre (le stock principal ne change pas).',
    fields: [
      { label: 'Gisement source', name: 'from_code', attrs: 'required' },
      { label: 'Gisement destination', name: 'to_code', attrs: 'required' },
      { label: 'ISBN du livre', name: 'isbn', attrs: 'required' },
      { label: 'Quantite', name: 'qty', value: 1, attrs: 'type="number" min="1"' }
    ],
    submitLabel: 'Transferer',
    keepFields: ['from_code', 'to_code'],
    onSubmit: async (data) => {
      const r = await POST('/api/warehouse/transfer', data);
      return { line: `${r.qty} × ${r.product.title}`, sub: `${esc(r.from)} → ${esc(r.to)}` };
    }
  });
}

export async function viewReintegration(el) {
  scanScreen(el, {
    title: 'Reintegration stock retour → principal',
    help: 'Scannez chaque livre a reintegrer : il quitte le <b>stock retour</b> et redevient commandable dans le <b>stock principal</b>. Gisement optionnel pour le ranger en meme temps.',
    fields: [
      { label: 'ISBN du livre', name: 'isbn', attrs: 'required' },
      { label: 'Quantite', name: 'qty', value: 1, attrs: 'type="number" min="1"' },
      { label: 'Gisement (optionnel)', name: 'gisement_code' }
    ],
    submitLabel: 'Reintegrer',
    keepFields: ['gisement_code'],
    onSubmit: async (data) => {
      const r = await POST('/api/warehouse/reintegration', data);
      return { line: `${r.qty} × ${r.product.title}`, sub: r.gisement ? `reintegres et ranges dans ${esc(r.gisement)}` : 'reintegres au stock principal' };
    }
  });
}
