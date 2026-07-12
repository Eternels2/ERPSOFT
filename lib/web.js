'use strict';
/* Mini framework HTTP : routage, sessions, JSON — zero dependance. */
const crypto = require('node:crypto');
const { db } = require('./db');

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const routes = [];

/**
 * route('GET', '/api/orders/:id', handler, { auth: 'staff'|'portal'|'public' })
 * handler(ctx) avec ctx = { req, res, params, query, body, session }
 * La valeur retournee est envoyee en JSON (sauf si le handler a deja repondu).
 */
function route(method, pattern, handler, opts = {}) {
  routes.push({
    method,
    parts: pattern.split('/').filter(Boolean),
    handler,
    auth: opts.auth || 'staff'
  });
}

function matchRoute(method, pathname) {
  const parts = pathname.split('/').filter(Boolean);
  for (const r of routes) {
    if (r.method !== method || r.parts.length !== parts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      if (r.parts[i].startsWith(':')) params[r.parts[i].slice(1)] = decodeURIComponent(parts[i]);
      else if (r.parts[i] !== parts[i]) { ok = false; break; }
    }
    if (ok) return { r, params };
  }
  return null;
}

/* ------------------------------------------------------------- sessions */
function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  for (const pair of raw.split(';')) {
    const idx = pair.indexOf('=');
    if (idx > 0) out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  }
  return out;
}

function createSession(res, userType, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString();
  db.prepare('INSERT INTO sessions (token, user_type, user_id, expires) VALUES (?,?,?,?)')
    .run(token, userType, userId, expires);
  const cookieName = userType === 'portal' ? 'portal_session' : 'erp_session';
  appendCookie(res, `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 14}`);
  return token;
}

function appendCookie(res, cookie) {
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', prev ? [].concat(prev, cookie) : cookie);
}

function destroySession(req, res, userType) {
  const cookieName = userType === 'portal' ? 'portal_session' : 'erp_session';
  const token = parseCookies(req)[cookieName];
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  appendCookie(res, `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function getSession(req, userType) {
  const cookieName = userType === 'portal' ? 'portal_session' : 'erp_session';
  const token = parseCookies(req)[cookieName];
  if (!token) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!s || s.user_type !== userType) return null;
  if (new Date(s.expires) < new Date()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  if (userType === 'staff') {
    const user = db.prepare('SELECT id, login, name, role FROM users WHERE id = ? AND active = 1').get(s.user_id);
    return user ? { type: 'staff', user } : null;
  }
  const soc = db.prepare('SELECT id, code, name, email FROM thirdparties WHERE id = ? AND active = 1').get(s.user_id);
  return soc ? { type: 'portal', client: soc } : null;
}

/* ------------------------------------------------------------- corps JSON */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 5 * 1024 * 1024) reject(new ApiError(413, 'Corps trop volumineux'));
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); }
      catch { reject(new ApiError(400, 'JSON invalide')); }
    });
    req.on('error', reject);
  });
}

module.exports = { ApiError, route, matchRoute, readBody, createSession, destroySession, getSession };
