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
require('./api/orders');
require('./api/consignments');
require('./api/returns');
require('./api/containers');
require('./api/invoices');
require('./api/accounting');
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
