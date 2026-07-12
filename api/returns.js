'use strict';
/* Retours clients : scan des livres, acceptation/refus, frais selon le mode, avoir + stock retour. */
const { db, tx, nextRef, getSetting } = require('../lib/db');
const { route, ApiError } = require('../lib/web');
const { round2, createInvoice, stockMove, findByIsbn, lastSaleDate, purchasedQty, acceptedReturnQty } = require('../lib/services');

const RETURN_MODES = ['dpd', 'gradignan', 'representant', 'a-dispo'];
const REFUSE_REASONS = ['hors-delai', 'non-achete', 'quota-depasse', 'autre'];

function computeFees(mode, nbColis, acceptedHt) {
  if (mode === 'dpd') return round2(Number(getSetting('fee_dpd', '12.50')) * Math.max(1, nbColis));
  if (mode === 'representant') {
    const threshold = Number(getSetting('fee_representant_threshold', '200'));
    return acceptedHt > threshold ? round2(Number(getSetting('fee_representant', '3.50'))) : 0;
  }
  return 0; // gradignan et a-dispo : sans frais
}

function getReturn(id) {
  const r = db.prepare(`SELECT r.*, t.name AS client_name, t.code AS client_code, t.delai_retour_mois,
      i.ref AS invoice_ref
    FROM returns r JOIN thirdparties t ON t.id = r.fk_client
    LEFT JOIN invoices i ON i.id = r.fk_invoice WHERE r.id = ?`).get(Number(id));
  if (!r) throw new ApiError(404, 'Retour introuvable');
  r.lines = db.prepare(`SELECT l.*, p.isbn, p.title, p.author, p.publisher, p.tva_rate, s.name AS supplier_name
    FROM return_lines l JOIN products p ON p.id = l.fk_product
    LEFT JOIN thirdparties s ON s.id = l.fk_supplier
    WHERE l.fk_return = ? ORDER BY l.id DESC`).all(r.id);
  r.nb_scanned = r.lines.reduce((s, l) => s + l.qty, 0);
  r.accepted_ht = round2(r.lines.filter((l) => l.line_status === 1).reduce((s, l) => s + l.qty * l.price_ht, 0));
  r.estimated_fees = r.status === 0 ? computeFees(r.return_mode, r.nb_colis, r.accepted_ht) : r.total_fees;
  return r;
}

route('GET', '/api/returns', async (ctx) => {
  const { status, q } = ctx.query;
  let sql = `SELECT r.*, t.name AS client_name, i.ref AS invoice_ref,
      (SELECT COALESCE(SUM(qty),0) FROM return_lines WHERE fk_return = r.id) AS nb_scanned,
      (SELECT COALESCE(SUM(CASE WHEN line_status=1 THEN qty*price_ht ELSE 0 END),0) FROM return_lines WHERE fk_return = r.id) AS accepted_ht
    FROM returns r JOIN thirdparties t ON t.id = r.fk_client
    LEFT JOIN invoices i ON i.id = r.fk_invoice WHERE 1=1`;
  const args = [];
  if (status !== undefined && status !== '') { sql += ' AND r.status = ?'; args.push(Number(status)); }
  if (q) { sql += ' AND (r.ref LIKE ? OR t.name LIKE ?)'; args.push(`%${q}%`, `%${q}%`); }
  sql += ' ORDER BY r.id DESC LIMIT 300';
  return db.prepare(sql).all(...args);
});

route('GET', '/api/returns/:id', async (ctx) => getReturn(ctx.params.id));

route('POST', '/api/returns', async (ctx) => {
  const b = ctx.body;
  const client = db.prepare("SELECT id FROM thirdparties WHERE id = ? AND type = 'client'").get(Number(b.fk_client));
  if (!client) throw new ApiError(400, 'Client invalide');
  const mode = RETURN_MODES.includes(b.return_mode) ? b.return_mode : 'gradignan';
  const ref = nextRef('RT');
  const r = db.prepare(`INSERT INTO returns (ref, fk_client, return_mode, objet, nb_colis, fk_user_creat)
    VALUES (?,?,?,?,?,?)`)
    .run(ref, client.id, mode, b.objet || null, Math.max(1, Number(b.nb_colis) || 1), ctx.session.user.id);
  return { id: Number(r.lastInsertRowid), ref };
});

route('PUT', '/api/returns/:id', async (ctx) => {
  const r = db.prepare('SELECT * FROM returns WHERE id = ?').get(Number(ctx.params.id));
  if (!r) throw new ApiError(404, 'Retour introuvable');
  if (r.status !== 0) throw new ApiError(400, 'Ce retour est deja finalise');
  const b = ctx.body;
  db.prepare('UPDATE returns SET return_mode = ?, objet = ?, nb_colis = ? WHERE id = ?')
    .run(RETURN_MODES.includes(b.return_mode) ? b.return_mode : r.return_mode,
      b.objet ?? r.objet, b.nb_colis !== undefined ? Math.max(1, Number(b.nb_colis)) : r.nb_colis, r.id);
  return { ok: true };
});

/*
 * Scan d'un livre : contrôle automatique (achete chez nous ? dans les delais ?)
 * -> ligne acceptee ou refusee avec motif propose ; l'operateur peut corriger ensuite.
 */
route('POST', '/api/returns/:id/scan', async (ctx) => {
  const r = db.prepare(`SELECT r.*, t.delai_retour_mois FROM returns r
    JOIN thirdparties t ON t.id = r.fk_client WHERE r.id = ?`).get(Number(ctx.params.id));
  if (!r) throw new ApiError(404, 'Retour introuvable');
  if (r.status !== 0) throw new ApiError(400, 'Ce retour est deja finalise');
  const p = findByIsbn(ctx.body.isbn);
  if (!p) throw new ApiError(404, `Livre introuvable pour l'ISBN "${ctx.body.isbn}"`);
  const supplier = p.fk_supplier ? db.prepare('SELECT name FROM thirdparties WHERE id = ?').get(p.fk_supplier) : null;

  const lastSale = lastSaleDate(r.fk_client, p.id);
  let status = 1, reason = null;
  if (!lastSale) {
    status = 0; reason = 'non-achete';
  } else {
    const limit = new Date(lastSale);
    limit.setMonth(limit.getMonth() + (r.delai_retour_mois || 12));
    if (limit < new Date()) { status = 0; reason = 'hors-delai'; }
  }

  // Plafond : on ne peut pas accepter plus que ce que le client a achete au total
  // (toutes factures confondues), deduction faite de ce qui est deja accepte en
  // retour ailleurs (ce retour ou un retour precedent, finalise ou non).
  const purchased = purchasedQty(r.fk_client, p.id);
  const alreadyAccepted = acceptedReturnQty(r.fk_client, p.id);
  const remaining = purchased - alreadyAccepted;
  if (status === 1 && remaining <= 0) { status = 0; reason = 'quota-depasse'; }

  // Meme livre deja scanne avec le meme statut -> on incremente la quantite.
  const existing = db.prepare(`SELECT * FROM return_lines WHERE fk_return = ? AND fk_product = ? AND line_status = ?
    AND COALESCE(refuse_reason,'') = COALESCE(?,'')`).get(r.id, p.id, status, reason);
  let incremented = false;
  if (existing) {
    db.prepare('UPDATE return_lines SET qty = qty + 1 WHERE id = ?').run(existing.id);
    incremented = true;
  } else {
    db.prepare(`INSERT INTO return_lines (fk_return, fk_product, qty, price_ht, line_status, refuse_reason, fk_supplier, date_last_sale)
      VALUES (?,?,1,?,?,?,?,?)`)
      .run(r.id, p.id, p.price_ht, status, reason, p.fk_supplier || null, lastSale);
  }
  return {
    ok: true, incremented,
    product: {
      id: p.id, title: p.title, isbn: p.isbn,
      publisher: p.publisher || null, supplier: supplier ? supplier.name : null
    },
    line_status: status, refuse_reason: reason, date_last_sale: lastSale,
    purchased_qty: purchased, already_accepted_qty: alreadyAccepted
  };
});

/* Correction manuelle d'une ligne : accepter / refuser / quantite. */
route('PUT', '/api/returns/:id/lines/:lineId', async (ctx) => {
  const r = db.prepare('SELECT * FROM returns WHERE id = ?').get(Number(ctx.params.id));
  if (!r) throw new ApiError(404, 'Retour introuvable');
  if (r.status !== 0) throw new ApiError(400, 'Ce retour est deja finalise');
  const l = db.prepare('SELECT * FROM return_lines WHERE id = ? AND fk_return = ?').get(Number(ctx.params.lineId), r.id);
  if (!l) throw new ApiError(404, 'Ligne introuvable');
  const b = ctx.body;
  const status = b.line_status !== undefined ? (b.line_status ? 1 : 0) : l.line_status;
  let reason = b.refuse_reason !== undefined ? b.refuse_reason : l.refuse_reason;
  if (status === 1) reason = null;
  else if (!REFUSE_REASONS.includes(reason)) reason = 'autre';
  const qty = b.qty !== undefined ? Number(b.qty) : l.qty;
  if (qty <= 0) throw new ApiError(400, 'La quantite doit etre superieure a zero');
  // Le plafond (achete toutes factures confondues) s'applique automatiquement au scan ;
  // ici, en correction manuelle, l'operateur reste libre d'accepter au-dela si un motif
  // legitime le justifie (erreur de facturation anterieure, geste commercial...).
  db.prepare('UPDATE return_lines SET line_status = ?, refuse_reason = ?, qty = ?, price_ht = ? WHERE id = ?')
    .run(status, reason, qty, b.price_ht !== undefined ? Number(b.price_ht) : l.price_ht, l.id);
  return { ok: true };
});

route('DELETE', '/api/returns/:id/lines/:lineId', async (ctx) => {
  const r = db.prepare('SELECT * FROM returns WHERE id = ?').get(Number(ctx.params.id));
  if (!r) throw new ApiError(404, 'Retour introuvable');
  if (r.status !== 0) throw new ApiError(400, 'Ce retour est deja finalise');
  db.prepare('DELETE FROM return_lines WHERE id = ? AND fk_return = ?').run(Number(ctx.params.lineId), r.id);
  return { ok: true };
});

/*
 * Finalisation : frais calcules selon le mode, avoir genere (livres acceptes - frais),
 * stock retour incremente, lignes acceptees affectees au conteneur ouvert du fournisseur.
 */
route('POST', '/api/returns/:id/finalize', async (ctx) => {
  const r = db.prepare('SELECT * FROM returns WHERE id = ?').get(Number(ctx.params.id));
  if (!r) throw new ApiError(404, 'Retour introuvable');
  if (r.status !== 0) throw new ApiError(400, 'Ce retour est deja finalise');
  const lines = db.prepare(`SELECT l.*, p.title, p.isbn, p.tva_rate FROM return_lines l
    JOIN products p ON p.id = l.fk_product WHERE l.fk_return = ?`).all(r.id);
  if (!lines.length) throw new ApiError(400, "Aucun livre n'a ete scanne");
  const accepted = lines.filter((l) => l.line_status === 1);

  const acceptedHt = round2(accepted.reduce((s, l) => s + l.qty * l.price_ht, 0));
  const fees = computeFees(r.return_mode, r.nb_colis, acceptedHt);

  const invLines = accepted.map((l) => ({
    fk_product: l.fk_product, label: `${l.title} (${l.isbn})`, qty: l.qty, price_ht: l.price_ht, tva_rate: l.tva_rate
  }));
  if (fees > 0) {
    invLines.push({ label: `Frais de retour (${r.return_mode})`, qty: 1, price_ht: -fees, tva_rate: Number(getSetting('fee_tva', '20')) });
  }

  const result = tx(() => {
    let invoice = null;
    if (invLines.length) {
      invoice = createInvoice({
        type: 'avoir', fk_client: r.fk_client, lines: invLines,
        source_type: 'retour', source_id: r.id, note: 'Retour ' + r.ref, userId: ctx.session.user.id
      });
    }
    for (const l of accepted) {
      stockMove(l.fk_product, 'return', l.qty, 'Retour client ' + r.ref, r.ref, ctx.session.user.id);
      // Affectation automatique au conteneur ouvert du fournisseur, s'il existe.
      if (l.fk_supplier) {
        const container = db.prepare('SELECT id FROM containers WHERE fk_supplier = ? AND status = 0 ORDER BY id LIMIT 1').get(l.fk_supplier);
        if (container) db.prepare('UPDATE return_lines SET fk_container = ? WHERE id = ?').run(container.id, l.id);
      }
    }
    db.prepare('UPDATE returns SET status = 1, total_fees = ?, fk_invoice = ? WHERE id = ?')
      .run(fees, invoice ? invoice.id : null, r.id);
    return { invoice, fees };
  });
  return { ok: true, fees: result.fees, invoice: result.invoice };
});

route('DELETE', '/api/returns/:id', async (ctx) => {
  const r = db.prepare('SELECT * FROM returns WHERE id = ?').get(Number(ctx.params.id));
  if (!r) throw new ApiError(404, 'Retour introuvable');
  if (r.status !== 0) throw new ApiError(400, 'Seul un retour en cours de scan peut etre supprime');
  db.prepare('DELETE FROM returns WHERE id = ?').run(r.id);
  return { ok: true };
});

module.exports = { getReturn };
