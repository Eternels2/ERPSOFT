'use strict';
const { db } = require('../lib/db');
const { route } = require('../lib/web');
const { round2 } = require('../lib/services');

route('GET', '/api/dashboard', async () => {
  const year = new Date().getFullYear();
  const y0 = `${year}-01-01`;

  const ca = db.prepare("SELECT COALESCE(SUM(total_ht),0) AS s FROM invoices WHERE type='facture' AND status >= 1 AND date_invoice >= ?").get(y0).s;
  const avoirs = db.prepare("SELECT COALESCE(SUM(total_ht),0) AS s FROM invoices WHERE type='avoir' AND status >= 1 AND date_invoice >= ?").get(y0).s;

  const kpis = {
    year,
    ca_ht: round2(ca - avoirs),
    avoirs_ht: round2(avoirs),
    taux_retour: ca > 0 ? round2(avoirs / ca * 100) : 0,
    orders_queue: db.prepare('SELECT COUNT(*) AS n FROM orders WHERE status IN (1,2)').get().n,
    orders_draft: db.prepare('SELECT COUNT(*) AS n FROM orders WHERE status = 0').get().n,
    returns_open: db.prepare('SELECT COUNT(*) AS n FROM returns WHERE status = 0').get().n,
    consignments_open: db.prepare('SELECT COUNT(*) AS n FROM consignments WHERE status = 1').get().n,
    containers_open: db.prepare('SELECT COUNT(*) AS n FROM containers WHERE status = 0').get().n,
    stock_main: db.prepare('SELECT COALESCE(SUM(stock_main),0) AS s FROM products WHERE active = 1').get().s,
    stock_return: db.prepare('SELECT COALESCE(SUM(stock_return),0) AS s FROM products WHERE active = 1').get().s,
    stock_value: round2(db.prepare('SELECT COALESCE(SUM(stock_main * buy_price_ht),0) AS s FROM products WHERE active = 1').get().s),
    nb_products: db.prepare('SELECT COUNT(*) AS n FROM products WHERE active = 1').get().n,
    nb_clients: db.prepare("SELECT COUNT(*) AS n FROM thirdparties WHERE type='client' AND active = 1").get().n
  };

  const monthly = db.prepare(`SELECT strftime('%m', date_invoice) AS m,
      SUM(CASE WHEN type='facture' THEN total_ht ELSE 0 END) AS factures,
      SUM(CASE WHEN type='avoir' THEN total_ht ELSE 0 END) AS avoirs
    FROM invoices WHERE status >= 1 AND date_invoice >= ? GROUP BY m ORDER BY m`).all(y0);

  const topClients = db.prepare(`SELECT t.id, t.name,
      SUM(CASE WHEN i.type='facture' THEN i.total_ht ELSE -i.total_ht END) AS ca
    FROM invoices i JOIN thirdparties t ON t.id = i.fk_client
    WHERE i.status >= 1 AND i.date_invoice >= ?
    GROUP BY t.id ORDER BY ca DESC LIMIT 5`).all(y0);

  const queue = db.prepare(`SELECT o.id, o.ref, o.order_type, o.priority, o.status, c.name AS client_name,
      (SELECT COALESCE(SUM(qty),0) FROM order_lines WHERE fk_order = o.id) AS qty_total,
      (SELECT COALESCE(SUM(qty_picked),0) FROM order_lines WHERE fk_order = o.id) AS qty_picked
    FROM orders o JOIN thirdparties c ON c.id = o.fk_client
    WHERE o.status IN (1,2) ORDER BY o.status DESC, o.priority ASC, o.id ASC LIMIT 8`).all();

  const lowStock = db.prepare(`SELECT id, isbn, title, stock_main FROM products
    WHERE active = 1 AND stock_main <= 10 ORDER BY stock_main ASC LIMIT 8`).all();

  const movements = db.prepare(`SELECT m.*, p.title, u.name AS user_name FROM stock_movements m
    JOIN products p ON p.id = m.fk_product LEFT JOIN users u ON u.id = m.fk_user
    ORDER BY m.id DESC LIMIT 10`).all();

  return { kpis, monthly, topClients, queue, lowStock, movements };
});
