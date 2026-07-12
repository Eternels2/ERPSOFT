/* Composants et helpers d'interface partages */

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

export const eur = (n) => (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
export const num = (n) => (Number(n) || 0).toLocaleString('fr-FR');
export const fdate = (d) => d ? new Date(d).toLocaleDateString('fr-FR') : '—';
export const fdatetime = (d) => d ? new Date(d.replace(' ', 'T') + 'Z').toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

/* ------------------------------------------------ icones (inline SVG) */
const paths = {
  dashboard: 'M3 13h8V3H3zm0 8h8v-6H3zm10 0h8V11h-8zm0-18v6h8V3z',
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5zm2.5-.5H19v2H6.5a.5.5 0 0 1 0-2z',
  users: 'M16 11c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 3-1.34 3-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z',
  truck: 'M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm13.5-9 1.96 2.5H17V9.5zM18 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z',
  cart: 'M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49A1 1 0 0 0 20 4H5.21l-.94-2zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z',
  invoice: 'M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8zm2 16H8v-2h8zm0-4H8v-2h8zm-3-5V3.5L18.5 9z',
  returns: 'M19 7v4H5.83l3.58-3.59L8 6l-6 6 6 6 1.41-1.41L5.83 13H21V7z',
  box: 'M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16zm-9-5.27L18.6 6.5 12 10.27 5.4 6.5zM5 8.9l6 3.43V19.4l-6-3.43zm8 10.5v-7.07l6-3.43v7.07z',
  warehouse: 'M12 3 2 8v13h4v-8h12v8h4V8zM10 21H8v-2h2zm3 0h-2v-2h2zm3 0h-2v-2h2z',
  scan: 'M2 6h2v12H2zm3 0h1v12H5zm2 0h2v12H7zm3 0h1v12h-1zm2 0h2v12h-2zm3 0h1v12h-1zm2 0h3v12h-3z',
  location: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z',
  settings: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61zM12 15.6A3.61 3.61 0 0 1 8.4 12c0-1.98 1.62-3.6 3.6-3.6s3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z',
  store: 'M20 4H4v2h16zm1 10v-2l-1-5H4l-1 5v2h1v6h10v-6h4v6h2v-6zm-9 4H6v-4h6z',
  plus: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z',
  search: 'M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z',
  check: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  x: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  print: 'M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12z',
  arrow: 'M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z',
  edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75z',
  trash: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z',
  queue: 'M4 6h16v2H4zm0 5h16v2H4zm0 5h10v2H4z',
  euro: 'M15 18.5c-2.51 0-4.68-1.42-5.76-3.5H15v-2H8.58c-.05-.33-.08-.66-.08-1s.03-.67.08-1H15V9H9.24C10.32 6.92 12.5 5.5 15 5.5c1.61 0 3.09.59 4.23 1.57L21 5.3A8.96 8.96 0 0 0 15 3c-3.92 0-7.24 2.51-8.48 6H3v2h3.06c-.04.33-.06.66-.06 1s.02.67.06 1H3v2h3.52c1.24 3.49 4.56 6 8.48 6 2.31 0 4.41-.87 6-2.3l-1.78-1.77c-1.13.98-2.6 1.57-4.22 1.57z'
};
export const icon = (name, size = 24) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true"><path d="${paths[name] || ''}"/></svg>`;

/* ------------------------------------------------ toasts */
export function toast(message, type = 'success') {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 3800);
  setTimeout(() => el.remove(), 4200);
}
export const toastErr = (e) => toast(e.message || String(e), 'error');

/* ------------------------------------------------ modales */
export function modal({ title, body, footer, wide, onOpen }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal ${wide ? 'wide' : ''}">
    <div class="modal-head"><h2>${esc(title)}</h2><button class="close" aria-label="Fermer">&times;</button></div>
    <div class="modal-body">${body}</div>
    ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
  </div>`;
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('.close').addEventListener('click', close);
  document.body.appendChild(overlay);
  const first = overlay.querySelector('input, select, textarea');
  if (first) setTimeout(() => first.focus(), 40);
  if (onOpen) onOpen(overlay, close);
  return { overlay, close };
}

export function confirmDialog(message, { danger = false, okLabel = 'Confirmer' } = {}) {
  return new Promise((resolve) => {
    const { overlay, close } = modal({
      title: 'Confirmation',
      body: `<p style="margin:0">${esc(message)}</p>`,
      footer: `<button class="btn" data-act="cancel">Annuler</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-act="ok">${esc(okLabel)}</button>`
    });
    overlay.querySelector('[data-act=cancel]').onclick = () => { close(); resolve(false); };
    overlay.querySelector('[data-act=ok]').onclick = () => { close(); resolve(true); };
  });
}

/* Lit tous les champs [name] d'un conteneur en objet. */
export function readForm(root) {
  const out = {};
  root.querySelectorAll('[name]').forEach((el) => {
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else out[el.name] = el.value.trim();
  });
  return out;
}

export const field = (label, inner, cls = '') => `<label class="field ${cls}"><span>${esc(label)}</span>${inner}</label>`;
export const input = (name, value = '', attrs = '') => `<input class="input" name="${name}" value="${esc(value)}" ${attrs}>`;
export const select = (name, options, value, attrs = '') =>
  `<select class="input" name="${name}" ${attrs}>${options.map((o) =>
    `<option value="${esc(o.value)}" ${String(o.value) === String(value) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;

/* ------------------------------------------------ tables */
export function dataTable({ columns, rows, onRow, empty = 'Aucun element', rowAttrs }) {
  if (!rows.length) return `<div class="empty">${icon('search')}<div>${esc(empty)}</div></div>`;
  return `<div style="overflow-x:auto"><table class="table">
    <thead><tr>${columns.map((c) => `<th class="${c.cls || ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r, i) => `<tr class="${onRow ? 'clickable' : ''}" ${rowAttrs ? rowAttrs(r, i) : `data-i="${i}"`}>
      ${columns.map((c) => `<td class="${c.cls || ''}">${c.render(r)}</td>`).join('')}</tr>`).join('')}
    </tbody></table></div>`;
}

/* Statuts documentaires */
export const ORDER_STATUS = {
  '-1': ['Annulee', 'red'], 0: ['Brouillon', ''], 1: ['Validee — en file', 'blue'],
  2: ['En preparation', 'orange'], 3: ['Preparee', 'purple'], 4: ['Expediee', 'green'], 5: ['Facturee', 'green']
};
export const ORDER_TYPES = [
  { value: 'a-dispo', label: 'A dispo Gradignan' },
  { value: 'prioritaire', label: 'Livraison prioritaire' },
  { value: 'par-nos-soins', label: 'Livraison par nos soins' },
  { value: 'mise-au-banc', label: 'Mise au banc' },
  { value: 'livraison', label: 'Livraison' },
  { value: 'proforma', label: 'Proforma couloir' }
];
export const RETURN_MODES = [
  { value: 'dpd', label: 'DPD (frais / colis)' },
  { value: 'gradignan', label: 'Gradignan (sans frais)' },
  { value: 'representant', label: 'Representant' },
  { value: 'a-dispo', label: 'A dispo (sans frais)' }
];
export const REFUSE_REASONS = { 'hors-delai': 'Hors delai', 'non-achete': 'Non achete chez nous', autre: 'Autre motif' };
export const FORMATS = [
  { value: '', label: '—' }, { value: 'broche', label: 'Broche' }, { value: 'poche', label: 'Poche' },
  { value: 'relie', label: 'Relie' }, { value: 'beau-livre', label: 'Beau livre' }
];

export const orderStatusBadge = (s) => {
  const [label, color] = ORDER_STATUS[s] || ['?', ''];
  return `<span class="badge dot ${color}">${label}</span>`;
};
export const orderTypeLabel = (t) => (ORDER_TYPES.find((o) => o.value === t) || { label: t }).label;

export const invoiceStatusBadge = (i) =>
  i.status === 2 ? '<span class="badge dot green">Reglee</span>'
    : i.status === 1 ? '<span class="badge dot blue">Validee</span>'
      : '<span class="badge dot">Brouillon</span>';
