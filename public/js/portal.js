/* Portail B2B libraires : catalogue + panier, mes commandes, mes avoirs */
import { GET, POST } from './api.js';
import { esc, eur, num, fdate, icon, toast, toastErr, orderStatusBadge, invoiceStatusBadge } from './ui.js';

const app = document.getElementById('app');
let client = null;
let cart = {}; // product_id -> { product, qty }

const cartCount = () => Object.values(cart).reduce((s, c) => s + c.qty, 0);
const cartTotal = () => Object.values(cart).reduce((s, c) => s + c.qty * c.product.price_ht, 0);

/* ------------------------------------------------------------- login */
function renderLogin() {
  app.innerHTML = `<div class="login-page" style="background:linear-gradient(150deg,#3b2205 0%,#7c4a12 60%,#b45309 100%)">
    <div class="login-card">
      <div class="logo" style="color:#b45309">
        <svg viewBox="0 0 24 24" width="34" height="34"><rect width="24" height="24" rx="5" fill="#b45309"/><path d="M6 6h5v12H6zM13 6h5v8h-5z" fill="#fff"/></svg>
        Portail Libraires
      </div>
      <div class="sub">Catalogue, commandes et avoirs — reserve aux libraires partenaires</div>
      <form id="login-form">
        <label class="field"><span>Identifiant</span><input class="input" name="login" required></label>
        <label class="field"><span>Mot de passe</span><input class="input" type="password" name="password" required></label>
        <button class="btn primary lg" style="width:100%;justify-content:center;margin-top:10px;background:#b45309;border-color:#b45309">Se connecter</button>
        <div id="login-err" style="color:var(--danger);font-size:13px;margin-top:10px;text-align:center"></div>
      </form>
      <div class="login-hint">Demonstration : librairie / livre</div>
    </div>
  </div>`;
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await POST('/portal/api/login', { login: e.target.login.value, password: e.target.password.value });
      client = r.client;
      renderShell();
      route();
    } catch (err) {
      document.getElementById('login-err').textContent = err.message;
    }
  });
}

/* ------------------------------------------------------------- shell */
function renderShell() {
  app.innerHTML = `
    <header class="portal-topbar">
      <div class="plogo">
        <svg viewBox="0 0 24 24" width="26" height="26"><rect width="24" height="24" rx="5" fill="#b45309"/><path d="M6 6h5v12H6zM13 6h5v8h-5z" fill="#fff"/></svg>
        <span>Portail Libraires<small>ERPSOFT Diffusion</small></span>
      </div>
      <nav class="portal-nav">
        <a href="#/catalog" data-nav="catalog">Catalogue</a>
        <a href="#/orders" data-nav="orders">Mes commandes</a>
        <a href="#/invoices" data-nav="invoices">Mes factures &amp; avoirs</a>
      </nav>
      <div class="portal-user"><span><b>${esc(client.name)}</b> (${esc(client.code)})</span>
        <a href="#" id="plogout">Deconnexion</a></div>
    </header>
    <div class="portal-content" id="content"></div>
    <div id="cartbar"></div>`;
  document.getElementById('plogout').addEventListener('click', async (e) => {
    e.preventDefault();
    await POST('/portal/api/logout');
    client = null;
    cart = {};
    renderLogin();
  });
}

function renderCartBar() {
  const bar = document.getElementById('cartbar');
  if (!bar) return;
  const n = cartCount();
  bar.innerHTML = n ? `<div class="cart-bar">
    ${icon('cart', 20)}
    <b>${num(n)} exemplaire(s)</b> — ${eur(cartTotal())} HT
    <div style="flex:1"></div>
    <button class="btn" id="cart-clear" style="background:transparent;color:#fff;border-color:rgba(255,255,255,.4)">Vider</button>
    <button class="btn" id="cart-send" style="background:#fff;color:var(--primary);border-color:#fff">${icon('check', 15)} Passer la commande</button>
  </div>` : '';
  if (!n) return;
  bar.querySelector('#cart-clear').onclick = () => { cart = {}; route(); };
  bar.querySelector('#cart-send').onclick = async () => {
    try {
      const lines = Object.values(cart).map((c) => ({ product_id: c.product.id, qty: c.qty }));
      const r = await POST('/portal/api/orders', { lines });
      toast(`Commande ${r.order.ref} transmise. Elle entre en preparation chez nous.`);
      cart = {};
      location.hash = '#/orders';
    } catch (e) { toastErr(e); }
  };
}

/* ------------------------------------------------------------- vues */
async function viewCatalog(el) {
  let q = '';
  const render = async () => {
    const rows = await GET('/portal/api/catalog' + (q ? '?q=' + encodeURIComponent(q) : ''));
    el.querySelector('#pclist').innerHTML = rows.length ? `<div style="overflow-x:auto"><table class="table">
      <thead><tr><th>Titre</th><th>ISBN</th><th>Editeur</th><th class="num">Prix HT</th><th>Disponibilite</th><th class="num" style="width:120px">Quantite</th></tr></thead>
      <tbody>${rows.map((p) => `<tr>
        <td class="main-cell">${esc(p.title)}<span class="sub">${esc(p.author || '')}${p.collection ? ' — ' + esc(p.collection) : ''}</span></td>
        <td>${esc(p.isbn)}</td>
        <td>${esc(p.publisher || '—')}</td>
        <td class="num">${eur(p.price_ht)}</td>
        <td><span class="dispo-${p.dispo}">${p.dispo === 'en-stock' ? '● En stock' : p.dispo === 'stock-faible' ? '● Stock limite' : '○ Epuise'}</span></td>
        <td class="num">${p.dispo !== 'epuise'
          ? `<input class="input qty-input" type="number" min="0" value="${cart[p.id] ? cart[p.id].qty : ''}" placeholder="0" data-qty="${p.id}">`
          : '—'}</td>
      </tr>`).join('')}</tbody></table></div>` : '<div class="empty">Aucun livre trouve</div>';

    el.querySelectorAll('[data-qty]').forEach((inp) => {
      const p = rows.find((x) => x.id === Number(inp.dataset.qty));
      inp.addEventListener('change', () => {
        const qty = Math.max(0, Math.floor(Number(inp.value) || 0));
        if (qty > 0) cart[p.id] = { product: p, qty };
        else delete cart[p.id];
        renderCartBar();
      });
    });
  };

  el.innerHTML = `<div class="card">
    <div class="card-head">
      <h2>Catalogue</h2>
      <div class="spacer"></div>
      <div class="searchbar" style="width:320px">${icon('search')}<input class="input" id="pcsearch" placeholder="Titre, auteur, editeur, ISBN…"></div>
    </div>
    <div class="card-body flush" id="pclist"></div>
  </div>`;
  let t;
  el.querySelector('#pcsearch').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { q = e.target.value; render(); }, 250); });
  await render();
}

async function viewMyOrders(el) {
  const rows = await GET('/portal/api/orders');
  el.innerHTML = `<div class="card">
    <div class="card-head"><h2>Mes commandes</h2></div>
    <div class="card-body flush">
      ${rows.length ? `<table class="table">
        <thead><tr><th>Ref</th><th>Date</th><th class="num">Exemplaires</th><th class="num">Total HT</th><th>Statut</th></tr></thead>
        <tbody>${rows.map((o) => `<tr class="clickable" data-oid="${o.id}">
          <td class="main-cell">${esc(o.ref)}</td>
          <td>${fdate(o.date_order)}</td>
          <td class="num">${num(o.qty_total)}</td>
          <td class="num">${eur(o.total_ht)}</td>
          <td>${orderStatusBadge(o.status)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Aucune commande — passez par le catalogue</div>'}
    </div>
  </div>
  <div id="odetail"></div>`;
  el.querySelectorAll('[data-oid]').forEach((tr) => tr.addEventListener('click', async () => {
    const o = await GET('/portal/api/orders/' + tr.dataset.oid);
    document.getElementById('odetail').innerHTML = `<div class="card" style="margin-top:18px">
      <div class="card-head"><h2>Detail — ${esc(o.ref)}</h2>${orderStatusBadge(o.status)}</div>
      <div class="card-body flush"><table class="table">
        <thead><tr><th>Livre</th><th class="num">Commandee</th><th class="num">Preparee</th><th class="num">PU HT</th><th class="num">Total HT</th></tr></thead>
        <tbody>${o.lines.map((l) => `<tr>
          <td class="main-cell">${esc(l.title)}<span class="sub">${esc(l.isbn)}</span></td>
          <td class="num">${num(l.qty)}</td><td class="num">${num(l.qty_picked)}</td>
          <td class="num">${eur(l.price_ht)}</td><td class="num">${eur(l.qty * l.price_ht)}</td></tr>`).join('')}
        </tbody></table></div>
    </div>`;
  }));
}

async function viewMyInvoices(el) {
  const rows = await GET('/portal/api/invoices');
  el.innerHTML = `<div class="card">
    <div class="card-head"><h2>Mes factures &amp; avoirs</h2></div>
    <div class="card-body flush">
      ${rows.length ? `<table class="table">
        <thead><tr><th>Ref</th><th>Type</th><th>Date</th><th class="num">Total HT</th><th class="num">Total TTC</th><th>Statut</th><th></th></tr></thead>
        <tbody>${rows.map((i) => `<tr>
          <td class="main-cell">${esc(i.ref)}</td>
          <td>${i.type === 'avoir' ? '<span class="badge orange">Avoir</span>' : '<span class="badge">Facture</span>'}</td>
          <td>${fdate(i.date_invoice)}</td>
          <td class="num">${eur(i.total_ht)}</td><td class="num">${eur(i.total_ttc)}</td>
          <td>${invoiceStatusBadge(i)}</td>
          <td class="actions"><a class="btn sm" href="/print/invoice/${i.id}" target="_blank">${icon('print', 13)} PDF</a></td></tr>`).join('')}
        </tbody></table>` : '<div class="empty">Aucune facture pour le moment</div>'}
    </div>
  </div>`;
}

/* ------------------------------------------------------------- routage */
const views = { catalog: viewCatalog, orders: viewMyOrders, invoices: viewMyInvoices };

async function route() {
  if (!client) return;
  const name = (location.hash.replace(/^#\//, '') || 'catalog').split('/')[0];
  const view = views[name] || viewCatalog;
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === name || (!views[name] && a.dataset.nav === 'catalog')));
  const el = document.getElementById('content');
  el.innerHTML = '<div class="empty">Chargement…</div>';
  try { await view(el); } catch (e) {
    if (e.status === 401) { client = null; renderLogin(); return; }
    el.innerHTML = `<div class="card"><div class="card-body" style="color:var(--danger)">${esc(e.message)}</div></div>`;
  }
  renderCartBar();
}

window.addEventListener('hashchange', route);

(async function init() {
  try {
    const r = await GET('/portal/api/me');
    client = r.client;
    renderShell();
    route();
  } catch {
    renderLogin();
  }
})();
