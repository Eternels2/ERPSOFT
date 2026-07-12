'use strict';
const { db, hashPassword } = require('../lib/db');
const { route, ApiError, createSession, destroySession } = require('../lib/web');

route('POST', '/api/login', async (ctx) => {
  const { login, password } = ctx.body;
  const user = db.prepare('SELECT * FROM users WHERE login = ? AND active = 1').get(String(login || '').trim());
  if (!user || hashPassword(password || '', user.salt) !== user.password_hash) {
    throw new ApiError(401, 'Identifiant ou mot de passe incorrect');
  }
  createSession(ctx.res, 'staff', user.id);
  return { user: { id: user.id, login: user.login, name: user.name, role: user.role } };
}, { auth: 'public' });

route('POST', '/api/logout', async (ctx) => {
  destroySession(ctx.req, ctx.res, 'staff');
  return { ok: true };
}, { auth: 'public' });

route('GET', '/api/me', async (ctx) => ({ user: ctx.session.user }));

/* ------------------------------------------------- gestion des utilisateurs */
function requireAdmin(ctx) {
  if (ctx.session.user.role !== 'admin') throw new ApiError(403, 'Reserve aux administrateurs');
}

route('GET', '/api/users', async (ctx) => {
  requireAdmin(ctx);
  return db.prepare('SELECT id, login, name, role, active, date_creation FROM users ORDER BY login').all();
});

route('POST', '/api/users', async (ctx) => {
  requireAdmin(ctx);
  const { login, password, name, role } = ctx.body;
  if (!login || !password || !name) throw new ApiError(400, 'Identifiant, mot de passe et nom sont obligatoires');
  if (!['admin', 'commercial', 'entrepot'].includes(role)) throw new ApiError(400, 'Role invalide');
  const crypto = require('node:crypto');
  const salt = crypto.randomBytes(16).toString('hex');
  try {
    const r = db.prepare('INSERT INTO users (login, password_hash, salt, name, role) VALUES (?,?,?,?,?)')
      .run(String(login).trim(), hashPassword(password, salt), salt, name, role);
    return { id: Number(r.lastInsertRowid) };
  } catch (e) {
    throw new ApiError(400, 'Cet identifiant existe deja');
  }
});

route('PUT', '/api/users/:id', async (ctx) => {
  requireAdmin(ctx);
  const id = Number(ctx.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) throw new ApiError(404, 'Utilisateur introuvable');
  const { name, role, active, password } = ctx.body;
  if (role && !['admin', 'commercial', 'entrepot'].includes(role)) throw new ApiError(400, 'Role invalide');
  db.prepare('UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?')
    .run(name ?? user.name, role ?? user.role, active === undefined ? user.active : (active ? 1 : 0), id);
  if (password) {
    const crypto = require('node:crypto');
    const salt = crypto.randomBytes(16).toString('hex');
    db.prepare('UPDATE users SET salt = ?, password_hash = ? WHERE id = ?').run(salt, hashPassword(password, salt), id);
  }
  return { ok: true };
});
