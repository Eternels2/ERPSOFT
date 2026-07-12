'use strict';
/* Commandes clients : cycle brouillon -> validee -> preparation (picking scanne) -> expediee -> facturee. */
const { db, tx, nextRef } = require('../lib/db');
const { route, ApiError } = require('../lib/web');
const { round2, createInvoice, stockMove, gisementMove, findByIsbn } = require('../lib/services');

const ORDER_TYPES = ['a-dispo', 'prioritaire', 'par-nos-soins', 'mise-au-banc', 'livraison', 'proforma'];

function orderTotals(orderId) {
  const r = db.prepare(`SELECT COALESCE(SUM(qty * price_ht * (1 - discount_pct/100.0)),0) AS ht,
      COALESCE(SUM(qty),0) AS qty, COALESCE(SUM(qty_picked),0) AS picked
    FROM order_lines WHERE fk_order = ?`).get(orderId);
  return { total_ht: round2(r.ht), qty_total: r.qty, qty_picked: r.picked };
}

function getOrder(id) {
  const o = db.prepare(`SELECT o.*, c.name AS client_name, c.code AS client_code, c.town AS client_town,
      i.ref AS invoice_ref
    FROM orders o JOIN thirdparties c ON c.id = o.fk_client
    LEFT JOIN invoices i ON i.id = o.fk_invoice WHERE o.id = ?`).get(Number(id));
  if (!o) throw new ApiError(404, 'Commande introuvable');
  o.lines = db.prepare(`SELECT l.*, p.isbn, p.title, p.author, p.tva_rate,
      (SELECT GROUP_CONCAT(g.code || ' (' || CAST(pg.qty AS INTEGER) || ')', ', ')
       FROM product_gisement pg JOIN gisements g ON g.id = pg.gisement_id
       WHERE pg.product_id = l.fk_product AND pg.qty > 0) AS locations
    FROM order_lines l JOIN products p ON p.id = l.fk_product
    WHERE l.fk_order = ? ORDER BY l.position, l.id`).all(Number(id));
  o.shipments = db.prepare('SELECT id, ref, carrier, tracking, nb_colis, date_shipment FROM shipments WHERE fk_order = ? ORDER BY id').all(o.id);
  o.crates = db.prepare('SELECT id, code, type FROM crates WHERE fk_order = ? ORDER BY code').all(o.id);
  if (o.fk_backorder) {
    const bo = db.prepare('SELECT ref FROM orders WHERE id = ?').get(o.fk_backorder);
    o.backorder_ref = bo ? bo.ref : null;
  }
  Object.assign(o, orderTotals(o.id));
  return o;
}

route('GET', '/api/orders', async (ctx) => {
  const { status, client, q } = ctx.query;
  let sql = `SELECT o.*, c.name AS client_name,
      (SELECT COALESCE(SUM(qty * price_ht * (1 - discount_pct/100.0)),0) FROM order_lines WHERE fk_order = o.id) AS total_ht,
      (SELECT COALESCE(SUM(qty),0) FROM order_lines WHERE fk_order = o.id) AS qty_total,
      (SELECT COALESCE(SUM(qty_picked),0) FROM order_lines WHERE fk_order = o.id) AS qty_picked,
      (SELECT GROUP_CONCAT(code, ', ') FROM crates WHERE fk_order = o.id) AS crates
    FROM orders o JOIN thirdparties c ON c.id = o.fk_client WHERE 1=1`;
  const args = [];
  if (status !== undefined && status !== '') { sql += ' AND o.status = ?'; args.push(Number(status)); }
  if (client) { sql += ' AND o.fk_client = ?'; args.push(Number(client)); }
  if (q) { sql += ' AND (o.ref LIKE ? OR c.name LIKE ?)'; args.push(`%${q}%`, `%${q}%`); }
  sql += ' ORDER BY o.id DESC LIMIT 300';
  return db.prepare(sql).all(...args);
});

/* File de preparation : commandes validees + en preparation, triees par priorite. */
route('GET', '/api/warehouse/queue', async (ctx) => {
  return db.prepare(`SELECT o.*, c.name AS client_name, c.town AS client_town,
      (SELECT COALESCE(SUM(qty),0) FROM order_lines WHERE fk_order = o.id) AS qty_total,
      (SELECT COALESCE(SUM(qty_picked),0) FROM order_lines WHERE fk_order = o.id) AS qty_picked,
      (SELECT COUNT(*) FROM order_lines WHERE fk_order = o.id) AS nb_lines
    FROM orders o JOIN thirdparties c ON c.id = o.fk_client
    WHERE o.status IN (1, 2)
    ORDER BY o.status DESC, o.priority ASC, o.id ASC`).all();
});

route('GET', '/api/orders/:id', async (ctx) => getOrder(ctx.params.id));

route('POST', '/api/orders', async (ctx) => {
  const b = ctx.body;
  const client = db.prepare("SELECT id FROM thirdparties WHERE id = ? AND type = 'client'").get(Number(b.fk_client));
  if (!client) throw new ApiError(400, 'Client invalide');
  const type = ORDER_TYPES.includes(b.order_type) ? b.order_type : 'livraison';
  const ref = nextRef('CO');
  const r = db.prepare(`INSERT INTO orders (ref, fk_client, order_type, priority, status, note, fk_user_creat)
    VALUES (?,?,?,?,0,?,?)`)
    .run(ref, client.id, type, Math.min(9, Math.max(1, Number(b.priority) || 5)), b.note || null, ctx.session.user.id);
  return { id: Number(r.lastInsertRowid), ref };
});

function requireDraft(id) {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(id));
  if (!o) throw new ApiError(404, 'Commande introuvable');
  if (o.status !== 0) throw new ApiError(400, 'Cette action necessite une commande en brouillon');
  return o;
}

route('PUT', '/api/orders/:id', async (ctx) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(ctx.params.id));
  if (!o) throw new ApiError(404, 'Commande introuvable');
  const b = ctx.body;
  if (o.status !== 0 && (b.fk_client !== undefined)) throw new ApiError(400, 'Le client ne peut plus etre modifie');
  db.prepare('UPDATE orders SET fk_client = ?, order_type = ?, priority = ?, note = ? WHERE id = ?')
    .run(b.fk_client !== undefined && o.status === 0 ? Number(b.fk_client) : o.fk_client,
      ORDER_TYPES.includes(b.order_type) ? b.order_type : o.order_type,
      b.priority !== undefined ? Math.min(9, Math.max(1, Number(b.priority))) : o.priority,
      b.note ?? o.note, o.id);
  return { ok: true };
});

route('POST', '/api/orders/:id/lines', async (ctx) => {
  const o = requireDraft(ctx.params.id);
  const b = ctx.body;
  let product = null;
  if (b.fk_product) product = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(b.fk_product));
  else if (b.isbn) product = findByIsbn(b.isbn);
  if (!product) throw new ApiError(404, 'Livre introuvable');
  const qty = Math.max(1, Number(b.qty) || 1);
  const price = b.price_ht !== undefined && b.price_ht !== '' ? Number(b.price_ht) : product.price_ht;
  // Remise par defaut du client si aucune remise explicite
  let discount = Number(b.discount_pct);
  if (b.discount_pct === undefined || b.discount_pct === '') {
    const client = db.prepare('SELECT discount_pct FROM thirdparties WHERE id = ?').get(o.fk_client);
    discount = (client && client.discount_pct) || 0;
  }
  const existing = db.prepare('SELECT * FROM order_lines WHERE fk_order = ? AND fk_product = ?').get(o.id, product.id);
  if (existing) {
    db.prepare('UPDATE order_lines SET qty = qty + ? WHERE id = ?').run(qty, existing.id);
  } else {
    const pos = db.prepare('SELECT COALESCE(MAX(position),0)+1 AS p FROM order_lines WHERE fk_order = ?').get(o.id).p;
    db.prepare('INSERT INTO order_lines (fk_order, fk_product, qty, price_ht, discount_pct, position) VALUES (?,?,?,?,?,?)')
      .run(o.id, product.id, qty, price, discount || 0, pos);
  }
  return { ok: true };
});

/* Plafond d'encours : encours facture (restant du TTC) + commandes en cours non facturees. */
function checkCreditLimit(clientId, addedHt) {
  const client = db.prepare('SELECT * FROM thirdparties WHERE id = ?').get(clientId);
  if (!client || !client.credit_limit || client.credit_limit <= 0) return;
  const unpaid = db.prepare(`SELECT COALESCE(SUM(i.total_ttc - (SELECT COALESCE(SUM(amount),0) FROM payment_allocations WHERE fk_invoice = i.id)),0) AS s
    FROM invoices i WHERE i.fk_client = ? AND i.type='facture' AND i.status >= 1`).get(clientId).s;
  const openOrders = db.prepare(`SELECT COALESCE(SUM(l.qty * l.price_ht * (1 - l.discount_pct/100.0)),0) AS s
    FROM order_lines l JOIN orders o ON o.id = l.fk_order
    WHERE o.fk_client = ? AND o.status BETWEEN 1 AND 4 AND o.fk_invoice IS NULL`).get(clientId).s;
  const exposure = round2(unpaid + (openOrders + addedHt) * 1.055);
  if (exposure > client.credit_limit) {
    throw new ApiError(400,
      `Plafond d'encours depasse pour ${client.name} : exposition ${exposure.toFixed(2)} € TTC (plafond ${client.credit_limit.toFixed(2)} €). Reglez des factures ou ajustez le plafond.`);
  }
}

route('PUT', '/api/orders/:id/lines/:lineId', async (ctx) => {
  const o = requireDraft(ctx.params.id);
  const l = db.prepare('SELECT * FROM order_lines WHERE id = ? AND fk_order = ?').get(Number(ctx.params.lineId), o.id);
  if (!l) throw new ApiError(404, 'Ligne introuvable');
  const b = ctx.body;
  const qty = b.qty !== undefined ? Number(b.qty) : l.qty;
  if (qty <= 0) throw new ApiError(400, 'La quantite doit etre superieure a zero');
  db.prepare('UPDATE order_lines SET qty = ?, price_ht = ?, discount_pct = ? WHERE id = ?')
    .run(qty, b.price_ht !== undefined ? Number(b.price_ht) : l.price_ht,
      b.discount_pct !== undefined ? Number(b.discount_pct) : l.discount_pct, l.id);
  return { ok: true };
});

route('DELETE', '/api/orders/:id/lines/:lineId', async (ctx) => {
  const o = requireDraft(ctx.params.id);
  db.prepare('DELETE FROM order_lines WHERE id = ? AND fk_order = ?').run(Number(ctx.params.lineId), o.id);
  return { ok: true };
});

route('POST', '/api/orders/:id/validate', async (ctx) => {
  const o = requireDraft(ctx.params.id);
  const n = db.prepare('SELECT COUNT(*) AS n FROM order_lines WHERE fk_order = ?').get(o.id).n;
  if (!n) throw new ApiError(400, 'La commande ne contient aucune ligne');
  const t = orderTotals(o.id);
  checkCreditLimit(o.fk_client, t.total_ht);
  db.prepare('UPDATE orders SET status = 1 WHERE id = ?').run(o.id);
  return { ok: true };
});

route('POST', '/api/orders/:id/start-picking', async (ctx) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(ctx.params.id));
  if (!o) throw new ApiError(404, 'Commande introuvable');
  if (o.status !== 1) throw new ApiError(400, 'Seule une commande validee peut passer en preparation');
  db.prepare('UPDATE orders SET status = 2 WHERE id = ?').run(o.id);
  return { ok: true };
});

/*
 * Liaison d'une caisse / d'un chariot a la commande en preparation.
 * La caisse suit la commande jusqu'a l'emballage et se libere a l'expedition.
 */
route('POST', '/api/orders/:id/assign-crate', async (ctx) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(ctx.params.id));
  if (!o) throw new ApiError(404, 'Commande introuvable');
  if (o.status !== 2) throw new ApiError(400, 'La commande doit etre en preparation pour lier une caisse');
  const code = String(ctx.body.code || '').trim();
  const cr = db.prepare('SELECT * FROM crates WHERE UPPER(code) = UPPER(?) AND active = 1').get(code);
  if (!cr) throw new ApiError(404, `Aucune caisse ou chariot pour le code "${code}" — creez-le dans Entrepot > Caisses & chariots`);
  if (cr.fk_order && cr.fk_order !== o.id) {
    const other = db.prepare('SELECT ref, status FROM orders WHERE id = ?').get(cr.fk_order);
    if (other && other.status >= 2 && other.status <= 3) {
      throw new ApiError(400, `${cr.type === 'chariot' ? 'Le chariot' : 'La caisse'} ${cr.code} est deja en service sur la commande ${other.ref}`);
    }
  }
  db.prepare('UPDATE crates SET fk_order = ? WHERE id = ?').run(o.id, cr.id);
  return { ok: true, crate: { id: cr.id, code: cr.code, type: cr.type } };
});

/*
 * La preparation est complete quand chaque ligne est servie ou declaree indisponible.
 * Retourne true si la commande vient de passer "preparee" (part a l'emballage).
 */
function closeIfComplete(orderId) {
  const open = db.prepare('SELECT COUNT(*) AS n FROM order_lines WHERE fk_order = ? AND unavailable = 0 AND qty_picked < qty')
    .get(orderId).n;
  if (open > 0) return false;
  db.prepare('UPDATE orders SET status = 3 WHERE id = ?').run(orderId);
  return true;
}

/* Scan de picking : ISBN (+ gisement optionnel) -> decompte stock, incremente qty_picked. */
route('POST', '/api/orders/:id/pick', async (ctx) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(ctx.params.id));
  if (!o) throw new ApiError(404, 'Commande introuvable');
  if (o.status !== 2) throw new ApiError(400, "La commande n'est pas en preparation");
  const { isbn, gisement_code, qty } = ctx.body;
  const p = findByIsbn(isbn);
  if (!p) throw new ApiError(404, `Livre introuvable pour l'ISBN "${isbn}"`);
  const line = db.prepare('SELECT * FROM order_lines WHERE fk_order = ? AND fk_product = ?').get(o.id, p.id);
  if (!line) throw new ApiError(400, `Ce livre (${p.title}) ne fait pas partie de cette commande`);
  const remaining = line.qty - line.qty_picked;
  if (remaining <= 0) throw new ApiError(400, `La ligne pour ${p.title} est deja entierement preparee`);
  const n = Math.min(remaining, Math.max(1, Number(qty) || 1));

  let g = null;
  if (gisement_code) {
    g = db.prepare('SELECT * FROM gisements WHERE UPPER(code) = UPPER(?)').get(String(gisement_code).trim());
    if (!g) throw new ApiError(404, `Gisement introuvable pour le code "${gisement_code}"`);
    const pg = db.prepare('SELECT qty FROM product_gisement WHERE product_id = ? AND gisement_id = ?').get(p.id, g.id);
    if (!pg || pg.qty < n) throw new ApiError(400, `Le livre ${p.title} n'est pas disponible en quantite suffisante dans le gisement ${g.code}`);
  }

  const result = tx(() => {
    stockMove(p.id, 'main', -n, 'Picking commande ' + o.ref, o.ref, ctx.session.user.id);
    if (g) gisementMove(p.id, g.id, -n);
    // Un bip reussi annule un eventuel marquage "indisponible" (le stock est revenu)
    db.prepare('UPDATE order_lines SET qty_picked = qty_picked + ?, unavailable = 0 WHERE id = ?').run(n, line.id);
    const done = closeIfComplete(o.id);
    const t = orderTotals(o.id);
    return { done, picked: t.qty_picked, total: t.qty_total };
  });
  return {
    ok: true, product: { id: p.id, title: p.title }, qty: n,
    line: { id: line.id, qty: line.qty, qty_picked: line.qty_picked + n },
    ...result
  };
});

/*
 * Ligne indisponible : le stock ne permet pas de servir — la ligne est consideree
 * traitee (la quantite manquante partira en reliquat) et la preparation peut se
 * cloturer automatiquement. body.undo = true pour annuler le marquage.
 */
route('POST', '/api/orders/:id/lines/:lineId/unavailable', async (ctx) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(ctx.params.id));
  if (!o) throw new ApiError(404, 'Commande introuvable');
  if (o.status !== 2) throw new ApiError(400, "La commande n'est pas en preparation");
  const line = db.prepare('SELECT * FROM order_lines WHERE id = ? AND fk_order = ?').get(Number(ctx.params.lineId), o.id);
  if (!line) throw new ApiError(404, 'Ligne introuvable');
  if (ctx.body.undo) {
    db.prepare('UPDATE order_lines SET unavailable = 0 WHERE id = ?').run(line.id);
    return { ok: true, done: false };
  }
  if (line.qty_picked >= line.qty) throw new ApiError(400, 'Cette ligne est deja entierement preparee');
  const done = tx(() => {
    db.prepare('UPDATE order_lines SET unavailable = 1 WHERE id = ?').run(line.id);
    return closeIfComplete(o.id);
  });
  return { ok: true, done };
});

/* Cloture manuelle de la preparation (reliquats non servis). */
route('POST', '/api/orders/:id/close-picking', async (ctx) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(ctx.params.id));
  if (!o) throw new ApiError(404, 'Commande introuvable');
  if (o.status !== 2) throw new ApiError(400, "La commande n'est pas en preparation");
  db.prepare('UPDATE orders SET status = 3 WHERE id = ?').run(o.id);
  return { ok: true };
});

/* Expedition : cree le bon de livraison (transporteur, suivi, colisage) et passe la commande en expediee. */
route('POST', '/api/orders/:id/ship', async (ctx) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(ctx.params.id));
  if (!o) throw new ApiError(404, 'Commande introuvable');
  if (o.status !== 3) throw new ApiError(400, 'Seule une commande preparee peut etre expediee');
  const b = ctx.body;
  const shipment = tx(() => {
    const ref = nextRef('BL');
    const r = db.prepare(`INSERT INTO shipments (ref, fk_order, fk_client, carrier, tracking, nb_colis, weight_kg, note, fk_user_creat)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(ref, o.id, o.fk_client, b.carrier || null, b.tracking || null,
        Math.max(1, Number(b.nb_colis) || 1), b.weight_kg ? Number(b.weight_kg) : null, b.note || null, ctx.session.user.id);
    db.prepare("UPDATE orders SET status = 4, date_shipped = date('now') WHERE id = ?").run(o.id);
    // Les caisses/chariots redeviennent disponibles pour d'autres preparations
    db.prepare('UPDATE crates SET fk_order = NULL WHERE fk_order = ?').run(o.id);
    return { id: Number(r.lastInsertRowid), ref };
  });
  return { ok: true, shipment };
});

route('GET', '/api/shipments', async (ctx) => {
  const { q } = ctx.query;
  let sql = `SELECT sh.*, o.ref AS order_ref, c.name AS client_name,
      (SELECT COALESCE(SUM(qty_picked),0) FROM order_lines WHERE fk_order = sh.fk_order) AS qty_shipped
    FROM shipments sh JOIN orders o ON o.id = sh.fk_order
    JOIN thirdparties c ON c.id = sh.fk_client WHERE 1=1`;
  const args = [];
  if (q) { sql += ' AND (sh.ref LIKE ? OR o.ref LIKE ? OR c.name LIKE ? OR sh.tracking LIKE ?)'; args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
  sql += ' ORDER BY sh.id DESC LIMIT 300';
  return db.prepare(sql).all(...args);
});

/*
 * Reliquat : genere une nouvelle commande (en file) avec les quantites commandees
 * mais non preparees. Une seule commande reliquat par commande d'origine.
 */
route('POST', '/api/orders/:id/backorder', async (ctx) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(ctx.params.id));
  if (!o) throw new ApiError(404, 'Commande introuvable');
  if (o.status < 3) throw new ApiError(400, 'La preparation doit etre terminee pour generer un reliquat');
  if (o.fk_backorder) throw new ApiError(400, 'Un reliquat a deja ete genere pour cette commande');
  const lines = db.prepare('SELECT * FROM order_lines WHERE fk_order = ? AND qty > qty_picked').all(o.id);
  if (!lines.length) throw new ApiError(400, 'Aucune quantite manquante : la commande a ete servie en totalite');
  const created = tx(() => {
    const ref = nextRef('CO');
    const r = db.prepare(`INSERT INTO orders (ref, fk_client, order_type, priority, status, source, note, fk_user_creat)
      VALUES (?,?,?,?,1,?,?,?)`)
      .run(ref, o.fk_client, o.order_type, o.priority, o.source, 'Reliquat de ' + o.ref, ctx.session.user.id);
    const boId = Number(r.lastInsertRowid);
    const ins = db.prepare('INSERT INTO order_lines (fk_order, fk_product, qty, price_ht, discount_pct, position) VALUES (?,?,?,?,?,?)');
    lines.forEach((l, i) => ins.run(boId, l.fk_product, l.qty - l.qty_picked, l.price_ht, l.discount_pct, i + 1));
    db.prepare('UPDATE orders SET fk_backorder = ? WHERE id = ?').run(boId, o.id);
    return { id: boId, ref };
  });
  return { ok: true, backorder: created };
});

/* Facturation : quantites reellement preparees (ou commandees si preparation non passee par le picking). */
route('POST', '/api/orders/:id/invoice', async (ctx) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(ctx.params.id));
  if (!o) throw new ApiError(404, 'Commande introuvable');
  if (o.fk_invoice) throw new ApiError(400, 'Une facture a deja ete generee pour cette commande');
  if (![3, 4].includes(o.status)) throw new ApiError(400, 'La commande doit etre preparee ou expediee pour etre facturee');
  const lines = db.prepare(`SELECT l.*, p.title, p.isbn, p.tva_rate FROM order_lines l
    JOIN products p ON p.id = l.fk_product WHERE l.fk_order = ?`).all(o.id);
  const invLines = lines
    .map((l) => ({
      fk_product: l.fk_product,
      label: `${l.title} (${l.isbn})`,
      // Ligne indisponible : seule la quantite reellement preparee est facturable
      qty: l.unavailable ? l.qty_picked : (l.qty_picked > 0 ? l.qty_picked : l.qty),
      price_ht: round2(l.price_ht * (1 - l.discount_pct / 100)),
      tva_rate: l.tva_rate
    }))
    .filter((l) => l.qty > 0);
  const inv = tx(() => {
    const created = createInvoice({
      type: 'facture', fk_client: o.fk_client, lines: invLines,
      source_type: 'commande', source_id: o.id, note: 'Commande ' + o.ref, userId: ctx.session.user.id
    });
    db.prepare('UPDATE orders SET status = 5, fk_invoice = ? WHERE id = ?').run(created.id, o.id);
    return created;
  });
  return { ok: true, invoice: inv };
});

route('POST', '/api/orders/:id/cancel', async (ctx) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(ctx.params.id));
  if (!o) throw new ApiError(404, 'Commande introuvable');
  if (o.status >= 4) throw new ApiError(400, 'Une commande expediee ou facturee ne peut plus etre annulee');
  const picked = db.prepare('SELECT COALESCE(SUM(qty_picked),0) AS s FROM order_lines WHERE fk_order = ?').get(o.id).s;
  if (picked > 0) throw new ApiError(400, 'Des articles ont deja ete preleves : terminez la preparation ou reintegrez le stock');
  tx(() => {
    db.prepare('UPDATE orders SET status = -1 WHERE id = ?').run(o.id);
    db.prepare('UPDATE crates SET fk_order = NULL WHERE fk_order = ?').run(o.id);
  });
  return { ok: true };
});

route('DELETE', '/api/orders/:id', async (ctx) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(ctx.params.id));
  if (!o) throw new ApiError(404, 'Commande introuvable');
  if (o.status !== 0 && o.status !== -1) throw new ApiError(400, 'Seule une commande en brouillon ou annulee peut etre supprimee');
  db.prepare('DELETE FROM orders WHERE id = ?').run(o.id);
  return { ok: true };
});

module.exports = { getOrder, checkCreditLimit };
