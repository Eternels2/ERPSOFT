'use strict';
/*
 * ERPSOFT - ERP Grossiste Livres
 * Serveur HTTP zero dependance (Node.js >= 22.5, SQLite natif).
 * Demarrage : node server.js  (http://localhost:3000)
 */
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

require('./lib/db');
const { ApiError, matchRoute, readBody, getSession } = require('./lib/web');

// Enregistrement des routes API
require('./api/auth');
require('./api/settings');
require('./api/dashboard');
require('./api/thirdparties');
require('./api/products');
require('./api/gisements');
require('./api/crates');
require('./api/orders');
require('./api/consignments');
require('./api/returns');
require('./api/containers');
require('./api/invoices');
require('./api/accounting');
require('./api/purchases');
require('./api/inventory');
require('./api/portal');
require('./lib/print');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json'
};

function serveStatic(res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  if (rel === '/portal' || rel === '/portal/') rel = '/portal.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) {
      // SPA : toute route inconnue hors API retombe sur l'application
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, index) => {
        if (e2) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(index);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

/*
 * Permissions par role (cote serveur).
 * entrepot : operations logistiques uniquement — pas de comptabilite, reglements,
 * factures, utilisateurs, ni facturation/finalisation de documents commerciaux.
 * commercial : tout sauf gestion des utilisateurs (les parametres restent admin via l'API settings).
 */
const ENTREPOT_DENY_PREFIXES = ['/api/accounting', '/api/payments', '/api/invoices', '/api/users'];
const ENTREPOT_DENY_SUFFIXES = ['/invoice', '/finalize'];
function checkRole(role, method, pathname) {
  if (role === 'admin') return;
  if (pathname === '/api/me' || pathname === '/api/logout') return;
  if (role === 'commercial') {
    if (pathname.startsWith('/api/users')) throw new ApiError(403, 'Reserve aux administrateurs');
    return;
  }
  if (role === 'entrepot') {
    if (ENTREPOT_DENY_PREFIXES.some((p) => pathname.startsWith(p))
      || ENTREPOT_DENY_SUFFIXES.some((s) => pathname.endsWith(s))
      || (pathname.startsWith('/api/thirdparties') && method !== 'GET')
      || (pathname.startsWith('/api/settings') && method !== 'GET')) {
      throw new ApiError(403, 'Votre role Entrepot ne permet pas cette action');
    }
  }
}

/* Sauvegarde quotidienne de la base (VACUUM INTO : coherent meme a chaud). Conserve les 14 dernieres. */
const BACKUP_DIR = path.join(__dirname, 'backups');
function backupDatabase() {
  try {
    const { db } = require('./lib/db');
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    const file = path.join(BACKUP_DIR, `erpsoft-${stamp}.db`);
    if (fs.existsSync(file)) return;
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    const all = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.db')).sort();
    while (all.length > 14) fs.unlinkSync(path.join(BACKUP_DIR, all.shift()));
    console.log('[backup] Sauvegarde creee :', path.basename(file));
  } catch (e) {
    console.error('[backup] Echec de la sauvegarde :', e.message);
  }
}
backupDatabase();
setInterval(backupDatabase, 24 * 60 * 60 * 1000);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  const isHandled = pathname.startsWith('/api/') || pathname.startsWith('/portal/api/') || pathname.startsWith('/print/');
  if (!isHandled) return serveStatic(res, pathname);

  try {
    const m = matchRoute(req.method, pathname);
    if (!m) throw new ApiError(404, 'Route inconnue');

    let session = null;
    if (m.r.auth === 'staff') {
      session = getSession(req, 'staff');
      if (!session) throw new ApiError(401, 'Authentification requise');
      checkRole(session.user.role, req.method, pathname);
    } else if (m.r.auth === 'portal') {
      session = getSession(req, 'portal');
      if (!session) throw new ApiError(401, 'Authentification requise');
    } else if (m.r.auth === 'any') {
      session = getSession(req, 'staff') || getSession(req, 'portal');
      if (!session) throw new ApiError(401, 'Authentification requise');
    }

    const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ? await readBody(req) : {};
    const query = Object.fromEntries(url.searchParams);
    const result = await m.r.handler({ req, res, params: m.params, query, body, session });

    if (!res.writableEnded) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result ?? { ok: true }));
    }
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 500;
    if (status === 500) console.error(`[erreur] ${req.method} ${pathname}:`, e);
    if (!res.writableEnded) {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: e.message || 'Erreur interne' }));
    }
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`ERPSOFT demarre : http://localhost:${PORT}`);
  console.log(`Portail libraires : http://localhost:${PORT}/portal`);
});
