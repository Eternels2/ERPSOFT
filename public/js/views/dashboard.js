import { GET } from '../api.js';
import { esc, eur, num, icon, fdatetime, orderStatusBadge, orderTypeLabel } from '../ui.js';

const MONTHS = ['Jan', 'Fev', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aou', 'Sep', 'Oct', 'Nov', 'Dec'];

export async function viewDashboard(el) {
  const d = await GET('/api/dashboard');
  const k = d.kpis;

  const kpi = (label, value, sub, ic) => `<div class="kpi">
    <div class="kpi-label">${icon(ic, 15)} ${esc(label)}</div>
    <div class="kpi-value">${value}</div>
    ${sub ? `<div class="kpi-sub">${sub}</div>` : ''}
  </div>`;

  const byMonth = {};
  for (const m of d.monthly) byMonth[Number(m.m)] = m;
  const maxV = Math.max(1, ...d.monthly.map((m) => Math.max(m.factures, m.avoirs)));
  const bars = Array.from({ length: 12 }, (_, i) => {
    const m = byMonth[i + 1] || { factures: 0, avoirs: 0 };
    return `<div class="bar" title="${MONTHS[i]} : ${eur(m.factures)} factures / ${eur(m.avoirs)} avoirs">
      <i style="height:${Math.round(m.factures / maxV * 100)}%"></i>
      <i class="neg" style="height:${Math.max(1, Math.round(m.avoirs / maxV * 100))}%"></i>
      <span>${MONTHS[i]}</span></div>`;
  }).join('');

  el.innerHTML = `
    <div class="kpi-grid">
      ${kpi(`CA ${k.year} HT`, eur(k.ca_ht), `${eur(k.avoirs_ht)} d'avoirs — taux de retour ${k.taux_retour}%`, 'euro')}
      ${kpi('Commandes en file', num(k.orders_queue), `${num(k.orders_draft)} brouillons`, 'queue')}
      ${kpi('Retours en cours', num(k.returns_open), `${num(k.containers_open)} conteneurs ouverts`, 'returns')}
      ${kpi('Depots-vente actifs', num(k.consignments_open), '', 'store')}
      ${kpi('Stock principal', num(k.stock_main) + ' ex.', `${num(k.stock_return)} ex. en stock retour — valeur ${eur(k.stock_value)}`, 'warehouse')}
      ${kpi('Catalogue', num(k.nb_products) + ' titres', `${num(k.nb_clients)} clients actifs`, 'book')}
    </div>

    <div class="grid-3-2">
      <div>
        <div class="card">
          <div class="card-head"><h2>Facturation ${k.year}</h2>
            <div class="spacer"></div>
            <span class="badge green">Factures</span> <span class="badge orange">Avoirs</span></div>
          <div class="card-body"><div class="bars">${bars}</div></div>
        </div>

        <div class="card">
          <div class="card-head"><h2>File de preparation</h2><div class="spacer"></div><a class="btn sm" href="#/queue">Tout voir ${icon('arrow', 13)}</a></div>
          <div class="card-body flush">
            ${d.queue.length ? `<table class="table"><tbody>
              ${d.queue.map((o) => `<tr class="clickable" onclick="location.hash='#/orders/${o.id}'">
                <td class="main-cell">${esc(o.ref)}<span class="sub">${esc(o.client_name)}</span></td>
                <td><span class="badge">${esc(orderTypeLabel(o.order_type))}</span></td>
                <td class="num">P${o.priority}</td>
                <td class="num">${num(o.qty_picked)} / ${num(o.qty_total)} ex.</td>
                <td>${orderStatusBadge(o.status)}</td></tr>`).join('')}
            </tbody></table>` : '<div class="empty">Aucune commande en attente de preparation</div>'}
          </div>
        </div>
      </div>

      <div>
        <div class="card">
          <div class="card-head"><h2>Top clients ${k.year}</h2></div>
          <div class="card-body flush">
            ${d.topClients.length ? `<table class="table"><tbody>
              ${d.topClients.map((c, i) => `<tr class="clickable" onclick="location.hash='#/tiers/${c.id}'">
                <td style="width:30px;color:var(--text-3)">${i + 1}.</td>
                <td class="main-cell">${esc(c.name)}</td>
                <td class="num">${eur(c.ca)}</td></tr>`).join('')}
            </tbody></table>` : '<div class="empty">Aucune facturation cette annee</div>'}
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h2>Stock faible (≤ 10 ex.)</h2></div>
          <div class="card-body flush">
            ${d.lowStock.length ? `<table class="table"><tbody>
              ${d.lowStock.map((p) => `<tr class="clickable" onclick="location.hash='#/products/${p.id}'">
                <td class="main-cell">${esc(p.title)}<span class="sub">${esc(p.isbn)}</span></td>
                <td class="num"><span class="badge ${p.stock_main <= 3 ? 'red' : 'orange'}">${num(p.stock_main)} ex.</span></td></tr>`).join('')}
            </tbody></table>` : '<div class="empty">Aucune alerte stock</div>'}
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h2>Derniers mouvements</h2></div>
          <div class="card-body flush">
            ${d.movements.length ? `<table class="table"><tbody>
              ${d.movements.map((m) => `<tr>
                <td class="main-cell">${esc(m.title)}<span class="sub">${esc(m.label)} — ${fdatetime(m.date_creation)}</span></td>
                <td class="num"><span class="badge ${m.qty > 0 ? 'green' : 'orange'}">${m.qty > 0 ? '+' : ''}${num(m.qty)}</span></td></tr>`).join('')}
            </tbody></table>` : '<div class="empty">Aucun mouvement</div>'}
          </div>
        </div>
      </div>
    </div>`;
}
