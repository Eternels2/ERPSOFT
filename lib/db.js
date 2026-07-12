'use strict';
/*
 * ERPSOFT - base de donnees SQLite (module natif node:sqlite, zero dependance)
 * Schema + migrations + jeu de donnees de demonstration au premier lancement.
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'erpsoft.db');
const firstRun = !fs.existsSync(DB_PATH);

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

/* ------------------------------------------------------------------ schema */
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  login TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin', -- admin | commercial | entrepot
  active INTEGER NOT NULL DEFAULT 1,
  date_creation TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_type TEXT NOT NULL, -- staff | portal
  user_id INTEGER NOT NULL,
  expires TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS thirdparties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'client', -- client | fournisseur
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  zip TEXT,
  town TEXT,
  country TEXT DEFAULT 'France',
  delai_retour_mois INTEGER DEFAULT 12,
  notes TEXT,
  portal_login TEXT UNIQUE,
  portal_password_hash TEXT,
  portal_salt TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  date_creation TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  isbn TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  author TEXT,
  publisher TEXT,
  collection TEXT,
  format TEXT, -- broche | poche | relie | beau-livre
  pages INTEGER,
  date_parution TEXT,
  remise_editeur REAL DEFAULT 0,   -- % de remise accordee par l'editeur
  fk_supplier INTEGER REFERENCES thirdparties(id),
  price_ht REAL NOT NULL DEFAULT 0,   -- prix de vente unitaire HT
  buy_price_ht REAL DEFAULT 0,
  tva_rate REAL NOT NULL DEFAULT 5.5,
  stock_main REAL NOT NULL DEFAULT 0,     -- Stock Principal (commandable)
  stock_return REAL NOT NULL DEFAULT 0,   -- Stock Retour (non commandable)
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  date_creation TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gisements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  etage TEXT,
  date_creation TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS product_gisement (
  product_id INTEGER NOT NULL REFERENCES products(id),
  gisement_id INTEGER NOT NULL REFERENCES gisements(id),
  qty REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, gisement_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  fk_client INTEGER NOT NULL REFERENCES thirdparties(id),
  order_type TEXT NOT NULL DEFAULT 'livraison',
  -- a-dispo | prioritaire | par-nos-soins | mise-au-banc | livraison | proforma
  priority INTEGER NOT NULL DEFAULT 5,       -- 1 = le plus urgent
  status INTEGER NOT NULL DEFAULT 0,
  -- 0 brouillon, 1 validee (en file), 2 en preparation, 3 preparee, 4 expediee, 5 facturee, -1 annulee
  date_order TEXT NOT NULL DEFAULT (date('now')),
  date_shipped TEXT,
  fk_invoice INTEGER,
  source TEXT DEFAULT 'interne', -- interne | portail
  note TEXT,
  date_creation TEXT NOT NULL DEFAULT (datetime('now')),
  fk_user_creat INTEGER
);

CREATE TABLE IF NOT EXISTS order_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fk_order INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  fk_product INTEGER NOT NULL REFERENCES products(id),
  qty REAL NOT NULL DEFAULT 1,
  qty_picked REAL NOT NULL DEFAULT 0,
  price_ht REAL NOT NULL DEFAULT 0,
  discount_pct REAL NOT NULL DEFAULT 0,
  position INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS consignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  fk_client INTEGER NOT NULL REFERENCES thirdparties(id),
  date_consignment TEXT NOT NULL DEFAULT (date('now')),
  status INTEGER NOT NULL DEFAULT 0, -- 0 brouillon, 1 valide (stock sorti), 2 facture
  fk_invoice INTEGER,
  note TEXT,
  date_creation TEXT NOT NULL DEFAULT (datetime('now')),
  fk_user_creat INTEGER
);

CREATE TABLE IF NOT EXISTS consignment_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fk_consignment INTEGER NOT NULL REFERENCES consignments(id) ON DELETE CASCADE,
  fk_product INTEGER NOT NULL REFERENCES products(id),
  qty_delivered REAL NOT NULL DEFAULT 0,
  qty_returned REAL NOT NULL DEFAULT 0,
  price_ht REAL NOT NULL DEFAULT 0,
  position INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  fk_client INTEGER NOT NULL REFERENCES thirdparties(id),
  return_mode TEXT NOT NULL DEFAULT 'gradignan', -- dpd | gradignan | representant | a-dispo
  objet TEXT,
  nb_colis INTEGER NOT NULL DEFAULT 1,
  status INTEGER NOT NULL DEFAULT 0, -- 0 en scan, 1 finalise
  total_fees REAL NOT NULL DEFAULT 0,
  fk_invoice INTEGER, -- avoir genere
  note TEXT,
  date_creation TEXT NOT NULL DEFAULT (datetime('now')),
  fk_user_creat INTEGER
);

CREATE TABLE IF NOT EXISTS return_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fk_return INTEGER NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  fk_product INTEGER NOT NULL REFERENCES products(id),
  qty REAL NOT NULL DEFAULT 1,
  price_ht REAL NOT NULL DEFAULT 0,
  line_status INTEGER NOT NULL DEFAULT 1,     -- 1 accepte, 0 refuse
  refuse_reason TEXT,                          -- hors-delai | non-achete | autre
  fk_supplier INTEGER,
  fk_container INTEGER,
  date_last_sale TEXT
);

CREATE TABLE IF NOT EXISTS containers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  fk_supplier INTEGER NOT NULL REFERENCES thirdparties(id),
  supplier_return_number TEXT,
  status INTEGER NOT NULL DEFAULT 0, -- 0 ouvert, 1 expedie
  date_creation TEXT NOT NULL DEFAULT (datetime('now')),
  date_shipped TEXT,
  fk_user_creat INTEGER
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'facture', -- facture | avoir
  fk_client INTEGER NOT NULL REFERENCES thirdparties(id),
  date_invoice TEXT NOT NULL DEFAULT (date('now')),
  status INTEGER NOT NULL DEFAULT 1, -- 0 brouillon, 1 validee, 2 reglee
  total_ht REAL NOT NULL DEFAULT 0,
  total_tva REAL NOT NULL DEFAULT 0,
  total_ttc REAL NOT NULL DEFAULT 0,
  source_type TEXT,  -- commande | depot-vente | retour | manuel
  source_id INTEGER,
  note TEXT,
  date_creation TEXT NOT NULL DEFAULT (datetime('now')),
  fk_user_creat INTEGER
);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fk_invoice INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  fk_product INTEGER REFERENCES products(id),
  label TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 1,
  price_ht REAL NOT NULL DEFAULT 0,
  tva_rate REAL NOT NULL DEFAULT 5.5,
  total_ht REAL NOT NULL DEFAULT 0,
  position INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fk_product INTEGER NOT NULL REFERENCES products(id),
  warehouse TEXT NOT NULL DEFAULT 'main', -- main | return
  qty REAL NOT NULL,          -- signe : + entree, - sortie
  label TEXT NOT NULL,
  ref_doc TEXT,
  fk_user INTEGER,
  date_creation TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  fk_client INTEGER NOT NULL REFERENCES thirdparties(id),
  date_payment TEXT NOT NULL DEFAULT (date('now')),
  mode TEXT NOT NULL DEFAULT 'virement', -- virement | cheque | cb | especes | avoir
  amount REAL NOT NULL,
  fk_avoir INTEGER REFERENCES invoices(id), -- si mode = avoir : l'avoir impute
  reference TEXT,   -- n° de cheque, reference de virement...
  note TEXT,
  date_creation TEXT NOT NULL DEFAULT (datetime('now')),
  fk_user_creat INTEGER
);

CREATE TABLE IF NOT EXISTS payment_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fk_payment INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  fk_invoice INTEGER NOT NULL REFERENCES invoices(id),
  amount REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payments_client ON payments(fk_client);
CREATE INDEX IF NOT EXISTS idx_palloc_payment ON payment_allocations(fk_payment);
CREATE INDEX IF NOT EXISTS idx_palloc_invoice ON payment_allocations(fk_invoice);
CREATE INDEX IF NOT EXISTS idx_orders_client ON orders(fk_client);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_olines_order ON order_lines(fk_order);
CREATE INDEX IF NOT EXISTS idx_clines_consignment ON consignment_lines(fk_consignment);
CREATE INDEX IF NOT EXISTS idx_rlines_return ON return_lines(fk_return);
CREATE INDEX IF NOT EXISTS idx_rlines_container ON return_lines(fk_container);
CREATE INDEX IF NOT EXISTS idx_ilines_invoice ON invoice_lines(fk_invoice);
CREATE INDEX IF NOT EXISTS idx_moves_product ON stock_movements(fk_product);
CREATE INDEX IF NOT EXISTS idx_pg_product ON product_gisement(product_id);
`);

/* --------------------------------------------------- migrations (bases existantes) */
try { db.exec('ALTER TABLE invoices ADD COLUMN date_due TEXT'); } catch { /* colonne deja presente */ }

/* Parametres ajoutes apres coup : valeurs par defaut sans ecraser l'existant */
const LATE_DEFAULTS = {
  payment_terms_days: '30',
  acc_client: '411000',
  acc_sales: '701100',
  acc_fees: '708500',
  acc_vat: '445710',
  acc_bank: '512000',
  acc_cash: '530000'
};
{
  const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?,?)');
  for (const [k, v] of Object.entries(LATE_DEFAULTS)) ins.run(k, v);
}

/* ------------------------------------------------------------- utilitaires */
function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}
function makeUser(login, password, name, role) {
  const salt = crypto.randomBytes(16).toString('hex');
  db.prepare('INSERT INTO users (login, password_hash, salt, name, role) VALUES (?,?,?,?,?)')
    .run(login, hashPassword(password, salt), salt, name, role);
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(key, String(value));
}
function getSetting(key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

/* Transaction helper */
function tx(fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/* Numerotation des documents : PREFIX-AAMM-NNNN, compteur mensuel en settings */
function nextRef(prefix) {
  const now = new Date();
  const yymm = String(now.getFullYear()).slice(2) + String(now.getMonth() + 1).padStart(2, '0');
  const key = 'counter_' + prefix + '_' + yymm;
  const n = parseInt(getSetting(key, '0'), 10) + 1;
  setSetting(key, n);
  return `${prefix}${yymm}-${String(n).padStart(4, '0')}`;
}

/* --------------------------------------------------------------- seed */
function seed() {
  makeUser('admin', 'admin', 'Administrateur', 'admin');
  makeUser('prepa', 'prepa', 'Preparateur Entrepot', 'entrepot');

  const defaults = {
    company_name: 'ERPSOFT Diffusion',
    company_address: '12 avenue du Livre',
    company_zip: '33170',
    company_town: 'Gradignan',
    company_phone: '05 56 00 00 00',
    company_email: 'contact@erpsoft-diffusion.fr',
    company_siret: '000 000 000 00000',
    company_tva: 'FR00000000000',
    fee_dpd: '12.50',
    fee_representant: '3.50',
    fee_representant_threshold: '200',
    default_tva: '5.5',
    fee_tva: '20'
  };
  for (const [k, v] of Object.entries(defaults)) setSetting(k, v);

  // Fournisseurs
  const insSoc = db.prepare(`INSERT INTO thirdparties
    (code, name, type, contact_name, email, phone, address, zip, town, delai_retour_mois, portal_login, portal_password_hash, portal_salt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  insSoc.run('FRN001', 'Interforum', 'fournisseur', 'Service retours', 'retours@interforum.fr', '01 49 59 10 10', 'Immeuble Vivendi, 20 rue des Vignerons', '94300', 'Vincennes', 12, null, null, null);
  insSoc.run('FRN002', 'Hachette Distribution', 'fournisseur', 'Cellule reprises', 'reprises@hachette.fr', '01 43 92 30 00', '58 rue Jean Bleuzen', '92170', 'Vanves', 12, null, null, null);
  insSoc.run('FRN003', 'MDS - Media Diffusion', 'fournisseur', 'Retours editeurs', 'retours@mds.fr', '03 25 70 67 89', 'ZI Torvilliers', '10440', 'Torvilliers', 12, null, null, null);

  // Clients libraires (le premier avec acces portail : librairie / livre)
  const psalt = crypto.randomBytes(16).toString('hex');
  insSoc.run('CLI001', 'Librairie Mollat', 'client', 'Camille Duret', 'commande@mollat.fr', '05 56 56 40 40', '15 rue Vital-Carles', '33000', 'Bordeaux', 12, 'librairie', hashPassword('livre', psalt), psalt);
  insSoc.run('CLI002', 'Librairie La Machine a Lire', 'client', 'Paul Vergne', 'contact@machinealire.fr', '05 56 48 03 87', '8 place du Parlement', '33000', 'Bordeaux', 6, null, null, null);
  insSoc.run('CLI003', 'Librairie Georges', 'client', 'Anne Laborde', 'librairie@georges.fr', '05 56 04 68 00', '300 cours de la Liberation', '33400', 'Talence', 12, null, null, null);
  insSoc.run('CLI004', 'Maison du Livre Arcachon', 'client', 'Julien Mora', 'contact@mla33.fr', '05 57 52 00 12', '3 avenue Gambetta', '33120', 'Arcachon', 12, null, null, null);

  const supplierId = { interforum: 1, hachette: 2, mds: 3 };

  // Produits (livres)
  const insP = db.prepare(`INSERT INTO products
    (isbn, title, author, publisher, collection, format, pages, date_parution, remise_editeur, fk_supplier, price_ht, buy_price_ht, tva_rate, stock_main)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const books = [
    ['9782070368228', "L'Etranger", 'Albert Camus', 'Gallimard', 'Folio', 'poche', 184, '1972-01-01', 38, supplierId.interforum, 7.01, 4.35, 5.5, 120],
    ['9782070413119', 'La Peste', 'Albert Camus', 'Gallimard', 'Folio', 'poche', 288, '1972-02-01', 38, supplierId.interforum, 8.34, 5.17, 5.5, 85],
    ['9782253004226', 'Le Grand Meaulnes', 'Alain-Fournier', 'Le Livre de Poche', 'Classiques', 'poche', 352, '1983-01-01', 36, supplierId.hachette, 5.97, 3.82, 5.5, 40],
    ['9782253093008', "Voyage au bout de la nuit", 'L.-F. Celine', 'Le Livre de Poche', 'Litterature', 'poche', 505, '1972-01-01', 36, supplierId.hachette, 9.38, 6.00, 5.5, 25],
    ['9782226392121', 'La Vie secrete des arbres', 'Peter Wohlleben', 'Les Arenes', 'Documents', 'broche', 260, '2017-03-01', 35, supplierId.mds, 19.81, 12.88, 5.5, 60],
    ['9782330086619', 'Le Chant du monde', 'Jean Giono', 'Actes Sud', 'Babel', 'poche', 320, '2017-06-07', 36, supplierId.mds, 8.53, 5.46, 5.5, 30],
    ['9782072729886', 'Les Furtifs', 'Alain Damasio', 'Gallimard', 'Folio SF', 'poche', 912, '2021-04-01', 38, supplierId.interforum, 11.28, 6.99, 5.5, 55],
    ['9782413025337', 'Le Monde sans fin', 'Jancovici / Blain', 'Dargaud', null, 'relie', 196, '2021-10-29', 40, supplierId.mds, 25.59, 15.35, 5.5, 75],
    ['9782075136686', 'Harry Potter a l ecole des sorciers', 'J.K. Rowling', 'Gallimard Jeunesse', 'Folio Junior', 'poche', 320, '2017-10-12', 38, supplierId.interforum, 8.44, 5.23, 5.5, 140],
    ['9782092493274', "Le Petit Prince (ed. illustree)", 'A. de Saint-Exupery', 'Gallimard', null, 'beau-livre', 96, '2015-11-05', 38, supplierId.interforum, 14.12, 8.75, 5.5, 35],
    ['9782749951935', 'Veiller sur elle', 'Jean-Baptiste Andrea', "L'Iconoclaste", null, 'broche', 592, '2023-08-17', 36, supplierId.mds, 21.71, 13.89, 5.5, 90],
    ['9782246831457', 'Triste tigre', 'Neige Sinno', 'P.O.L', null, 'broche', 288, '2023-08-17', 36, supplierId.hachette, 18.96, 12.13, 5.5, 45]
  ];
  for (const b of books) insP.run(...b);

  // Gisements + repartition du stock
  const insG = db.prepare('INSERT INTO gisements (code, etage) VALUES (?,?)');
  insG.run('01-INTERFORUM-A', 'RDC');
  insG.run('01-INTERFORUM-B', 'RDC');
  insG.run('02-HACHETTE-A', 'RDC');
  insG.run('03-MDS-A', 'Etage 1');
  insG.run('04-NOUVEAUTES', 'RDC');
  insG.run('05-JEUNESSE', 'Etage 1');

  const insPG = db.prepare('INSERT INTO product_gisement (product_id, gisement_id, qty) VALUES (?,?,?)');
  // product 1..12 ; repartition coherente avec stock_main
  insPG.run(1, 1, 80); insPG.run(1, 2, 40);
  insPG.run(2, 1, 85);
  insPG.run(3, 3, 40);
  insPG.run(4, 3, 25);
  insPG.run(5, 4, 60);
  insPG.run(6, 4, 30);
  insPG.run(7, 2, 55);
  insPG.run(8, 5, 75);
  insPG.run(9, 6, 140);
  insPG.run(10, 6, 35);
  insPG.run(11, 5, 90);
  insPG.run(12, 5, 45);

  const insMove = db.prepare("INSERT INTO stock_movements (fk_product, warehouse, qty, label, ref_doc, fk_user) VALUES (?,?,?,?,?,1)");
  for (let p = 1; p <= 12; p++) {
    insMove.run(p, 'main', books[p - 1][13], 'Stock initial', 'INIT');
  }

  // Une commande en file de preparation
  const oref = nextRef('CO');
  db.prepare(`INSERT INTO orders (ref, fk_client, order_type, priority, status, note, fk_user_creat)
    VALUES (?,?,?,?,1,?,1)`).run(oref, 4, 'prioritaire', 2, 'Reassort rentree litteraire');
  const insOL = db.prepare('INSERT INTO order_lines (fk_order, fk_product, qty, price_ht, position) VALUES (1,?,?,?,?)');
  insOL.run(11, 6, 21.71, 1);
  insOL.run(12, 4, 18.96, 2);
  insOL.run(1, 10, 7.01, 3);

  // Un depot-vente valide chez Mollat (stock deja sorti)
  const dvref = nextRef('DV');
  db.prepare(`INSERT INTO consignments (ref, fk_client, status, note, fk_user_creat) VALUES (?,?,1,?,1)`)
    .run(dvref, 4, 'Table de Noel - beaux livres');
  const insCL = db.prepare('INSERT INTO consignment_lines (fk_consignment, fk_product, qty_delivered, price_ht, position) VALUES (1,?,?,?,?)');
  insCL.run(8, 10, 25.59, 1);
  insCL.run(10, 8, 14.12, 2);
  db.prepare('UPDATE products SET stock_main = stock_main - 10 WHERE id = 8').run();
  db.prepare('UPDATE products SET stock_main = stock_main - 8 WHERE id = 10').run();
  db.prepare('UPDATE product_gisement SET qty = qty - 10 WHERE product_id = 8 AND gisement_id = 5').run();
  db.prepare('UPDATE product_gisement SET qty = qty - 8 WHERE product_id = 10 AND gisement_id = 6').run();
  insMove.run(8, 'main', -10, 'Depot-vente ' + dvref, dvref);
  insMove.run(10, 'main', -8, 'Depot-vente ' + dvref, dvref);
}

if (firstRun) {
  tx(seed);
  console.log('[db] Base initialisee avec le jeu de donnees de demonstration (admin / admin).');
}

module.exports = { db, tx, nextRef, getSetting, setSetting, hashPassword };
