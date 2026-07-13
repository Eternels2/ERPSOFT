'use strict';
const { db, hashPassword } = require('../lib/db');
const { route, ApiError } = require('../lib/web');
const { round2 } = require('../lib/services');
const crypto = require('node:crypto');

route('GET', '/api/thirdparties', async (ctx) => {
  const { type, q } = ctx.query;
  let sql = `SELECT t.*,
    (SELECT COUNT(*) FROM orders o WHERE o.fk_client = t.id AND o.status BETWEEN 1 AND 3) AS open_orders
    FROM thirdparties t WHERE t.active = 1`;
  const args = [];
  if (type) { sql += ' AND t.type = ?'; args.push(type); }
  if (q) { sql += ' AND (t.name LIKE ? OR t.code LIKE ? OR t.town LIKE ?)'; args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  sql += ' ORDER BY t.name';
  return db.prepare(sql).all(...args).map(stripSecrets);
});

function stripSecrets(t) {
  const { portal_password_hash, portal_salt, ...rest } = t;
  rest.portal_enabled = !!(t.portal_login && portal_password_hash);
  return rest;
}

route('GET', '/api/thirdparties/:id', async (ctx) => {
  const t = db.prepare('SELECT * FROM thirdparties WHERE id = ?').get(Number(ctx.params.id));
  if (!t) throw new ApiError(404, 'Tiers introuvable');
  const year = new Date().getFullYear();
  const stats = {};
  if (t.type === 'client') {
    const ca = db.prepare(`SELECT COALESCE(SUM(total_ht),0) AS s FROM invoices WHERE fk_client = ? AND type='facture' AND status >= 1 AND date_invoice >= ?`).get(t.id, `${year}-01-01`);
    const av = db.prepare(`SELECT COALESCE(SUM(total_ht),0) AS s FROM invoices WHERE fk_client = ? AND type='avoir' AND status >= 1 AND date_invoice >= ?`).get(t.id, `${year}-01-01`);
    stats.year = year;
    stats.ca_ht = round2(ca.s - av.s);
    stats.avoirs_ht = round2(av.s);
    stats.taux_retour = ca.s > 0 ? round2(av.s / ca.s * 100) : 0;
    // Encours : factures TTC validees - reglements affectes (toutes periodes)
    const facturesTtc = db.prepare(`SELECT COALESCE(SUM(total_ttc),0) AS s FROM invoices WHERE fk_client = ? AND type='facture' AND status >= 1`).get(t.id).s;
    const paidTtc = db.prepare(`SELECT COALESCE(SUM(a.amount),0) AS s FROM payment_allocations a
      JOIN invoices i ON i.id = a.fk_invoice WHERE i.fk_client = ?`).get(t.id).s;
    const avoirsTtc = db.prepare(`SELECT COALESCE(SUM(total_ttc),0) AS s FROM invoices WHERE fk_client = ? AND type='avoir' AND status >= 1`).get(t.id).s;
    const avoirsUsed = db.prepare(`SELECT COALESCE(SUM(p.amount),0) AS s FROM payments p
      JOIN invoices av ON av.id = p.fk_avoir WHERE av.fk_client = ?`).get(t.id).s;
    stats.encours_ttc = round2(facturesTtc - paidTtc);
    stats.avoirs_disponibles_ttc = round2(avoirsTtc - avoirsUsed);
    stats.orders = db.prepare(`SELECT id, ref, date_order, order_type, status,
        (SELECT COALESCE(SUM(qty*price_ht*(1-discount_pct/100)),0) FROM order_lines WHERE fk_order = orders.id) AS total_ht
      FROM orders WHERE fk_client = ? ORDER BY id DESC LIMIT 15`).all(t.id);
    stats.consignments = db.prepare(`SELECT id, ref, date_consignment, status FROM consignments WHERE fk_client = ? ORDER BY id DESC LIMIT 15`).all(t.id);
    stats.returns = db.prepare(`SELECT id, ref, date_creation, return_mode, status, total_fees FROM returns WHERE fk_client = ? ORDER BY id DESC LIMIT 15`).all(t.id);
  }
  if (t.type === 'fournisseur') {
    stats.products = db.prepare('SELECT id, isbn, title, price_ht, stock_main, stock_return FROM products WHERE fk_supplier = ? AND active = 1 ORDER BY title').all(t.id);
    stats.containers = db.prepare('SELECT id, ref, status, date_creation, date_shipped FROM containers WHERE fk_supplier = ? ORDER BY id DESC LIMIT 15').all(t.id);
  }
  stats.invoices = db.prepare('SELECT id, ref, type, date_invoice, status, total_ht, total_ttc FROM invoices WHERE fk_client = ? ORDER BY id DESC LIMIT 20').all(t.id);
  return { ...stripSecrets(t), stats };
});

function nextCode(type) {
  const prefix = type === 'fournisseur' ? 'FRN' : 'CLI';
  const row = db.prepare("SELECT code FROM thirdparties WHERE code LIKE ? ORDER BY LENGTH(code) DESC, code DESC LIMIT 1").get(prefix + '%');
  const n = row ? parseInt(row.code.replace(prefix, ''), 10) + 1 : 1;
  return prefix + String(n).padStart(3, '0');
}

/* Verifie qu'un code personnalise n'est pas deja utilise par un autre tiers. */
function checkCodeAvailable(code, excludeId) {
  const dup = db.prepare('SELECT id, name FROM thirdparties WHERE code = ? AND id != ?').get(code, excludeId || -1);
  if (dup) throw new ApiError(400, `Le code "${code}" est deja utilise par ${dup.name}`);
}

route('POST', '/api/thirdparties', async (ctx) => {
  const b = ctx.body;
  if (!b.name) throw new ApiError(400, 'Le nom est obligatoire');
  const type = b.type === 'fournisseur' ? 'fournisseur' : 'client';
  let code = nextCode(type);
  if (b.code && String(b.code).trim()) {
    code = String(b.code).trim().toUpperCase();
    checkCodeAvailable(code, null);
  }
  const r = db.prepare(`INSERT INTO thirdparties (code, name, type, contact_name, email, phone, address, zip, town, country, delai_retour_mois, notes, siret, discount_pct, credit_limit, payment_terms_days)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(code, b.name, type, b.contact_name || null, b.email || null, b.phone || null, b.address || null,
      b.zip || null, b.town || null, b.country || 'France', Number(b.delai_retour_mois) || 12, b.notes || null,
      b.siret || null, Number(b.discount_pct) || 0, Number(b.credit_limit) || 0,
      b.payment_terms_days ? Number(b.payment_terms_days) : null);
  return { id: Number(r.lastInsertRowid), code };
});

route('PUT', '/api/thirdparties/:id', async (ctx) => {
  const id = Number(ctx.params.id);
  const t = db.prepare('SELECT * FROM thirdparties WHERE id = ?').get(id);
  if (!t) throw new ApiError(404, 'Tiers introuvable');
  const b = ctx.body;
  let code = t.code;
  if (b.code !== undefined && String(b.code).trim()) {
    const newCode = String(b.code).trim().toUpperCase();
    if (newCode !== t.code) { checkCodeAvailable(newCode, id); code = newCode; }
  }
  db.prepare(`UPDATE thirdparties SET code=?, name=?, contact_name=?, email=?, phone=?, address=?, zip=?, town=?, country=?, delai_retour_mois=?, notes=?, siret=?, discount_pct=?, credit_limit=?, payment_terms_days=? WHERE id=?`)
    .run(code, b.name ?? t.name, b.contact_name ?? t.contact_name, b.email ?? t.email, b.phone ?? t.phone,
      b.address ?? t.address, b.zip ?? t.zip, b.town ?? t.town, b.country ?? t.country,
      b.delai_retour_mois !== undefined ? Number(b.delai_retour_mois) : t.delai_retour_mois, b.notes ?? t.notes,
      b.siret ?? t.siret,
      b.discount_pct !== undefined ? Number(b.discount_pct) || 0 : t.discount_pct,
      b.credit_limit !== undefined ? Number(b.credit_limit) || 0 : t.credit_limit,
      b.payment_terms_days !== undefined ? (b.payment_terms_days ? Number(b.payment_terms_days) : null) : t.payment_terms_days,
      id);
  return { ok: true, code };
});

/* Acces portail B2B d'un client */
route('PUT', '/api/thirdparties/:id/portal', async (ctx) => {
  const id = Number(ctx.params.id);
  const t = db.prepare('SELECT * FROM thirdparties WHERE id = ?').get(id);
  if (!t) throw new ApiError(404, 'Tiers introuvable');
  if (t.type !== 'client') throw new ApiError(400, "Seul un client peut avoir un acces portail");
  const { portal_login, portal_password, disable } = ctx.body;
  if (disable) {
    db.prepare('UPDATE thirdparties SET portal_login = NULL, portal_password_hash = NULL, portal_salt = NULL WHERE id = ?').run(id);
    return { ok: true };
  }
  if (!portal_login) throw new ApiError(400, "L'identifiant portail est obligatoire");
  const existing = db.prepare('SELECT id FROM thirdparties WHERE portal_login = ? AND id != ?').get(portal_login, id);
  if (existing) throw new ApiError(400, 'Cet identifiant portail est deja utilise');
  if (portal_password) {
    const salt = crypto.randomBytes(16).toString('hex');
    db.prepare('UPDATE thirdparties SET portal_login = ?, portal_password_hash = ?, portal_salt = ? WHERE id = ?')
      .run(portal_login, hashPassword(portal_password, salt), salt, id);
  } else {
    if (!t.portal_password_hash) throw new ApiError(400, 'Un mot de passe est requis pour activer cet acces');
    db.prepare('UPDATE thirdparties SET portal_login = ? WHERE id = ?').run(portal_login, id);
  }
  return { ok: true };
});

route('DELETE', '/api/thirdparties/:id', async (ctx) => {
  const id = Number(ctx.params.id);
  const used = db.prepare(`SELECT
      (SELECT COUNT(*) FROM orders WHERE fk_client = ?) +
      (SELECT COUNT(*) FROM invoices WHERE fk_client = ?) +
      (SELECT COUNT(*) FROM consignments WHERE fk_client = ?) +
      (SELECT COUNT(*) FROM products WHERE fk_supplier = ?) AS n`).get(id, id, id, id);
  if (used.n > 0) {
    db.prepare('UPDATE thirdparties SET active = 0 WHERE id = ?').run(id);
    return { ok: true, archived: true };
  }
  db.prepare('DELETE FROM thirdparties WHERE id = ?').run(id);
  return { ok: true };
});
