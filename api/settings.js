'use strict';
const { db, setSetting } = require('../lib/db');
const { route, ApiError } = require('../lib/web');

const EDITABLE = [
  'company_name', 'company_address', 'company_zip', 'company_town', 'company_phone',
  'company_email', 'company_siret', 'company_tva',
  'fee_dpd', 'fee_representant', 'fee_representant_threshold', 'fee_tva', 'default_tva',
  'payment_terms_days', 'acc_client', 'acc_sales', 'acc_fees', 'acc_vat', 'acc_bank', 'acc_cash'
];

route('GET', '/api/settings', async () => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const r of rows) if (EDITABLE.includes(r.key)) out[r.key] = r.value;
  return out;
});

route('PUT', '/api/settings', async (ctx) => {
  if (ctx.session.user.role !== 'admin') throw new ApiError(403, 'Reserve aux administrateurs');
  for (const [k, v] of Object.entries(ctx.body)) {
    if (EDITABLE.includes(k)) setSetting(k, v);
  }
  return { ok: true };
});
