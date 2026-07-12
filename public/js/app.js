/* ERPSOFT - shell applicatif : authentification, navigation, routage */
import { GET, POST } from './api.js';
import { esc, icon, toastErr } from './ui.js';

import { viewDashboard } from './views/dashboard.js';
import { viewProducts, viewProduct } from './views/products.js';
import { viewThirdparties, viewThirdparty } from './views/thirdparties.js';
import { viewOrders, viewOrder } from './views/orders.js';
import { viewQueue, viewPicking, viewGisements, viewGisement, viewRangement, viewTransfert, viewReintegration } from './views/warehouse.js';
import { viewConsignments, viewConsignment } from './views/consignments.js';
import { viewReturns, viewReturn } from './views/returns.js';
import { viewContainers, viewContainer } from './views/containers.js';
import { viewInvoices } from './views/invoices.js';
import { viewAccounting } from './views/accounting.js';
import { viewSettings } from './views/settings.js';
import { viewPurchaseOrders, viewPurchaseOrder, viewReceptions, viewReception, viewRestock } from './views/purchases.js';
import { viewInventories, viewInventory, viewShipments } from './views/inventory.js';

const app = document.getElementById('app');
let currentUser = null;

/* ------------------------------------------------------------- routage */
const routes = [
  { path: 'dashboard', view: viewDashboard, title: 'Tableau de bord' },
  { path: 'products', view: viewProducts, title: 'Catalogue' },
  { path: 'products/:id', view: viewProduct, title: 'Fiche livre' },
  { path: 'clients', view: (c, p, x) => viewThirdparties(c, { ...p, type: 'client' }, x), title: 'Clients libraires' },
  { path: 'fournisseurs', view: (c, p, x) => viewThirdparties(c, { ...p, type: 'fournisseur' }, x), title: 'Fournisseurs' },
  { path: 'tiers/:id', view: viewThirdparty, title: 'Fiche tiers' },
  { path: 'orders', view: viewOrders, title: 'Commandes' },
  { path: 'orders/:id', view: viewOrder, title: 'Commande' },
  { path: 'queue', view: viewQueue, title: 'File de preparation' },
  { path: 'picking/:id', view: viewPicking, title: 'Preparation' },
  { path: 'consignments', view: viewConsignments, title: 'Depots-vente' },
  { path: 'consignments/:id', view: viewConsignment, title: 'Depot-vente' },
  { path: 'returns', view: viewReturns, title: 'Retours clients' },
  { path: 'returns/:id', view: viewReturn, title: 'Retour' },
  { path: 'containers', view: viewContainers, title: 'Conteneurs fournisseurs' },
  { path: 'containers/:id', view: viewContainer, title: 'Conteneur' },
  { path: 'invoices', view: viewInvoices, title: 'Factures & avoirs' },
  { path: 'compta', view: viewAccounting, title: 'Comptabilite' },
  { path: 'compta/:tab', view: viewAccounting, title: 'Comptabilite' },
  { path: 'achats', view: viewPurchaseOrders, title: 'Commandes fournisseurs' },
  { path: 'achats/:id', view: viewPurchaseOrder, title: 'Commande fournisseur' },
  { path: 'receptions', view: viewReceptions, title: 'Receptions' },
  { path: 'receptions/:id', view: viewReception, title: 'Reception' },
  { path: 'reassort', view: viewRestock, title: 'Reassort' },
  { path: 'expeditions', view: viewShipments, title: 'Expeditions' },
  { path: 'inventaires', view: viewInventories, title: 'Inventaires' },
  { path: 'inventaires/:id', view: viewInventory, title: 'Inventaire' },
  { path: 'gisements', view: viewGisements, title: 'Gisements' },
  { path: 'gisements/:id', view: viewGisement, title: 'Gisement' },
  { path: 'rangement', view: viewRangement, title: 'Rangement' },
  { path: 'transfert', view: viewTransfert, title: 'Transfert gisement' },
  { path: 'reintegration', view: viewReintegration, title: 'Reintegration stock retour' },
  { path: 'settings', view: viewSettings, title: 'Parametres' }
];

function matchHash() {
  const hash = (location.hash || '#/dashboard').replace(/^#\//, '');
  const parts = hash.split('/').filter(Boolean);
  for (const r of routes) {
    const rp = r.path.split('/');
    if (rp.length !== parts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < rp.length; i++) {
      if (rp[i].startsWith(':')) params[rp[i].slice(1)] = decodeURIComponent(parts[i]);
      else if (rp[i] !== parts[i]) { ok = false; break; }
    }
    if (ok) return { route: r, params };
  }
  return { route: routes[0], params: {} };
}

export const navigate = (path) => { location.hash = '#/' + path; };

/* ------------------------------------------------------------- menu */
/* roles : si absent, visible pour tous. */
const NAV = [
  { section: 'Pilotage' },
  { path: 'dashboard', icon: 'dashboard', label: 'Tableau de bord' },
  { section: 'Commercial' },
  { path: 'orders', icon: 'cart', label: 'Commandes' },
  { path: 'consignments', icon: 'store', label: 'Depots-vente' },
  { path: 'expeditions', icon: 'truck', label: 'Expeditions' },
  { path: 'invoices', icon: 'invoice', label: 'Factures & avoirs', roles: ['admin', 'commercial'] },
  { section: 'Comptabilite', roles: ['admin', 'commercial'] },
  { path: 'compta', icon: 'euro', label: 'Comptabilite', roles: ['admin', 'commercial'] },
  { section: 'Achats' },
  { path: 'achats', icon: 'cart', label: 'Commandes fournisseurs' },
  { path: 'receptions', icon: 'box', label: 'Receptions' },
  { path: 'reassort', icon: 'warehouse', label: 'Reassort' },
  { section: 'Entrepot' },
  { path: 'queue', icon: 'queue', label: 'File de preparation', countKey: 'queue' },
  { path: 'rangement', icon: 'scan', label: 'Rangement' },
  { path: 'gisements', icon: 'location', label: 'Gisements' },
  { path: 'transfert', icon: 'warehouse', label: 'Transfert gisement' },
  { path: 'inventaires', icon: 'check', label: 'Inventaires' },
  { section: 'Retours' },
  { path: 'returns', icon: 'returns', label: 'Retours clients', countKey: 'returns' },
  { path: 'containers', icon: 'box', label: 'Conteneurs fournisseurs' },
  { path: 'reintegration', icon: 'truck', label: 'Reintegration' },
  { section: 'Referentiels' },
  { path: 'products', icon: 'book', label: 'Catalogue' },
  { path: 'clients', icon: 'users', label: 'Clients' },
  { path: 'fournisseurs', icon: 'truck', label: 'Fournisseurs' },
  { section: 'Administration', roles: ['admin'] },
  { path: 'settings', icon: 'settings', label: 'Parametres', roles: ['admin'] }
];

let counts = { queue: 0, returns: 0 };

async function refreshCounts() {
  try {
    const d = await GET('/api/dashboard');
    counts.queue = d.kpis.orders_queue;
    counts.returns = d.kpis.returns_open;
    for (const key of ['queue', 'returns']) {
      const el = document.querySelector(`[data-count="${key}"]`);
      if (el) { el.textContent = counts[key]; el.style.display = counts[key] ? '' : 'none'; }
    }
  } catch { /* silencieux */ }
}

function shell() {
  app.innerHTML = `<div class="layout">
    <aside class="sidebar">
      <div class="logo">
        <svg viewBox="0 0 24 24" width="28" height="28"><rect width="24" height="24" rx="5" fill="#4caf7d"/><path d="M6 6h5v12H6zM13 6h5v8h-5z" fill="#0f1c14"/></svg>
        <span>ERPSOFT<small>Grossiste Livres</small></span>
      </div>
      <nav id="nav">${NAV.filter((n) => !n.roles || n.roles.includes(currentUser.role)).map((n) => n.section
        ? `<div class="nav-section">${esc(n.section)}</div>`
        : `<a class="nav-item" data-path="${n.path}" href="#/${n.path}">${icon(n.icon)}<span>${esc(n.label)}</span>
            ${n.countKey ? `<span class="count" data-count="${n.countKey}" style="display:none">0</span>` : ''}</a>`).join('')}
      </nav>
      <div class="userbox">
        <div class="uname">${esc(currentUser.name)}</div>
        <div class="urole">${esc(currentUser.role)}</div>
        <a href="#" id="logout">Se deconnecter</a>
      </div>
    </aside>
    <div class="main">
      <header class="topbar">
        <h1 id="page-title"></h1>
        <div class="spacer"></div>
        <a class="btn sm" href="/portal" target="_blank">${icon('store', 15)} Portail libraires</a>
      </header>
      <div class="content" id="content"></div>
    </div>
  </div>`;
  document.getElementById('logout').addEventListener('click', async (e) => {
    e.preventDefault();
    await POST('/api/logout');
    currentUser = null;
    renderLogin();
  });
}

async function renderRoute() {
  if (!currentUser) return;
  const { route, params } = matchHash();
  document.getElementById('page-title').textContent = route.title;
  document.querySelectorAll('.nav-item').forEach((el) => {
    const p = el.dataset.path;
    const active = location.hash.startsWith('#/' + p) &&
      (location.hash === '#/' + p || location.hash.charAt(('#/' + p).length) === '/' ||
       (p === 'orders' && location.hash.startsWith('#/orders')) );
    el.classList.toggle('active', active);
  });
  const content = document.getElementById('content');
  content.innerHTML = '<div class="empty">Chargement…</div>';
  try {
    await route.view(content, params, { navigate, user: currentUser, refreshCounts });
  } catch (e) {
    if (e.status === 401) { currentUser = null; renderLogin(); return; }
    content.innerHTML = `<div class="card"><div class="card-body" style="color:var(--danger)">${esc(e.message)}</div></div>`;
    toastErr(e);
  }
  refreshCounts();
}

/* ------------------------------------------------------------- login */
function renderLogin() {
  app.innerHTML = `<div class="login-page">
    <div class="login-card">
      <div class="logo">
        <svg viewBox="0 0 24 24" width="34" height="34"><rect width="24" height="24" rx="5" fill="#14532d"/><path d="M6 6h5v12H6zM13 6h5v8h-5z" fill="#fff"/></svg>
        ERPSOFT
      </div>
      <div class="sub">Gestion commerciale &amp; entrepot — Grossiste Livres</div>
      <form id="login-form">
        <label class="field"><span>Identifiant</span><input class="input" name="login" autocomplete="username" required></label>
        <label class="field"><span>Mot de passe</span><input class="input" type="password" name="password" autocomplete="current-password" required></label>
        <button class="btn primary lg" style="width:100%;justify-content:center;margin-top:10px">Se connecter</button>
        <div id="login-err" style="color:var(--danger);font-size:13px;margin-top:10px;text-align:center"></div>
      </form>
      <div class="login-hint">Demonstration : admin / admin</div>
    </div>
  </div>`;
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      const r = await POST('/api/login', { login: f.login.value, password: f.password.value });
      currentUser = r.user;
      shell();
      renderRoute();
    } catch (err) {
      document.getElementById('login-err').textContent = err.message;
    }
  });
}

/* ------------------------------------------------------------- init */
window.addEventListener('hashchange', renderRoute);

(async function init() {
  try {
    const r = await GET('/api/me');
    currentUser = r.user;
    shell();
    renderRoute();
  } catch {
    renderLogin();
  }
})();
