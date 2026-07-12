'use strict';
/* Services metier partages : facturation, mouvements de stock. */
const { db, nextRef, getSetting } = require('./db');
const { ApiError } = require('./web');

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Cree une facture ou un avoir avec ses lignes et retourne son id.
 * lines: [{ fk_product?, label, qty, price_ht, tva_rate }]
 * Pour un avoir, passer des quantites positives : le type 'avoir' porte le sens.
 */
function createInvoice({ type = 'facture', fk_client, lines, source_type, source_id, note, userId, status = 1 }) {
  if (!lines || !lines.length) throw new ApiError(400, 'Aucune ligne a facturer');
  const ref = nextRef(type === 'avoir' ? 'AV' : 'FA');
  let totalHt = 0, totalTva = 0;
  const computed = lines.map((l, i) => {
    const ht = round2(Number(l.qty) * Number(l.price_ht));
    totalHt = round2(totalHt + ht);
    totalTva = round2(totalTva + ht * Number(l.tva_rate ?? 5.5) / 100);
    return { ...l, total_ht: ht, position: i + 1 };
  });
  const totalTtc = round2(totalHt + totalTva);
  // Echeance : date de facture + delai de paiement (celui du client s'il est defini, sinon global)
  const clientTerms = db.prepare('SELECT payment_terms_days FROM thirdparties WHERE id = ?').get(fk_client);
  const terms = (clientTerms && clientTerms.payment_terms_days)
    || parseInt(getSetting('payment_terms_days', '30'), 10) || 30;
  const due = new Date();
  due.setDate(due.getDate() + terms);
  const dateDue = due.toISOString().slice(0, 10);
  const res = db.prepare(`INSERT INTO invoices (ref, type, fk_client, status, total_ht, total_tva, total_ttc, source_type, source_id, note, date_due, fk_user_creat)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(ref, type, fk_client, status, totalHt, totalTva, totalTtc, source_type || null, source_id || null, note || null, dateDue, userId || null);
  const invoiceId = Number(res.lastInsertRowid);
  const ins = db.prepare(`INSERT INTO invoice_lines (fk_invoice, fk_product, label, qty, price_ht, tva_rate, total_ht, position)
    VALUES (?,?,?,?,?,?,?,?)`);
  for (const l of computed) {
    ins.run(invoiceId, l.fk_product || null, l.label, l.qty, round2(l.price_ht), l.tva_rate ?? 5.5, l.total_ht, l.position);
  }
  return { id: invoiceId, ref, total_ht: totalHt, total_ttc: totalTtc };
}

/**
 * Mouvemente le stock d'un produit (main | return). qty signee.
 * Verifie que le stock ne devient pas negatif.
 */
function stockMove(productId, warehouse, qty, label, refDoc, userId) {
  const col = warehouse === 'return' ? 'stock_return' : 'stock_main';
  const p = db.prepare(`SELECT id, ${col} AS s FROM products WHERE id = ?`).get(productId);
  if (!p) throw new ApiError(404, 'Produit introuvable');
  if (p.s + qty < -1e-9) throw new ApiError(400, `Stock insuffisant (${warehouse === 'return' ? 'stock retour' : 'stock principal'})`);
  db.prepare(`UPDATE products SET ${col} = ${col} + ? WHERE id = ?`).run(qty, productId);
  db.prepare('INSERT INTO stock_movements (fk_product, warehouse, qty, label, ref_doc, fk_user) VALUES (?,?,?,?,?,?)')
    .run(productId, warehouse, qty, label, refDoc || null, userId || null);
}

/** Ajuste la quantite d'un produit dans un gisement (qty signee, jamais negative au final). */
function gisementMove(productId, gisementId, qty) {
  const row = db.prepare('SELECT qty FROM product_gisement WHERE product_id = ? AND gisement_id = ?').get(productId, gisementId);
  const current = row ? row.qty : 0;
  if (current + qty < -1e-9) throw new ApiError(400, 'Quantite insuffisante dans ce gisement');
  if (row) {
    if (current + qty <= 1e-9) db.prepare('DELETE FROM product_gisement WHERE product_id = ? AND gisement_id = ?').run(productId, gisementId);
    else db.prepare('UPDATE product_gisement SET qty = qty + ? WHERE product_id = ? AND gisement_id = ?').run(qty, productId, gisementId);
  } else if (qty > 0) {
    db.prepare('INSERT INTO product_gisement (product_id, gisement_id, qty) VALUES (?,?,?)').run(productId, gisementId, qty);
  }
}

/** Recherche un produit par ISBN/EAN (tolere espaces et tirets). */
function findByIsbn(isbn) {
  const clean = String(isbn || '').replace(/[\s-]/g, '');
  if (!clean) return null;
  return db.prepare("SELECT * FROM products WHERE replace(replace(isbn,'-',''),' ','') = ? AND active = 1").get(clean);
}

/** Date de derniere vente d'un produit a un client (factures validees). */
function lastSaleDate(clientId, productId) {
  const row = db.prepare(`SELECT MAX(i.date_invoice) AS d FROM invoices i
    JOIN invoice_lines il ON il.fk_invoice = i.id
    WHERE i.fk_client = ? AND il.fk_product = ? AND i.type = 'facture' AND i.status >= 1`)
    .get(clientId, productId);
  return row && row.d ? row.d : null;
}

/** Montant deja regle d'une facture (somme des affectations de reglements). */
function invoicePaidAmount(invoiceId) {
  return db.prepare('SELECT COALESCE(SUM(amount),0) AS s FROM payment_allocations WHERE fk_invoice = ?').get(invoiceId).s;
}

/** Montant d'un avoir deja impute en reglement d'autres factures. */
function avoirUsedAmount(avoirId) {
  return db.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE fk_avoir = ?").get(avoirId).s;
}

/** Recalcule le statut d'une facture (1 validee / 2 reglee) selon les reglements affectes. */
function recomputeInvoiceStatus(invoiceId) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!inv || inv.status === 0) return;
  let settled;
  if (inv.type === 'avoir') {
    // Un avoir est "solde" quand il a ete entierement impute en reglement
    settled = avoirUsedAmount(inv.id) >= inv.total_ttc - 0.005;
  } else {
    settled = invoicePaidAmount(inv.id) >= inv.total_ttc - 0.005;
  }
  db.prepare('UPDATE invoices SET status = ? WHERE id = ?').run(settled ? 2 : 1, invoiceId);
}

module.exports = {
  round2, createInvoice, stockMove, gisementMove, findByIsbn, lastSaleDate,
  invoicePaidAmount, avoirUsedAmount, recomputeInvoiceStatus
};
