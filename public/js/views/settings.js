import { GET, POST, PUT } from '../api.js';
import { esc, icon, toast, toastErr, modal, readForm, field, input, select, dataTable } from '../ui.js';

const ROLES = [
  { value: 'admin', label: 'Administrateur' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'entrepot', label: 'Entrepot' }
];

export async function viewSettings(el, params, ctx) {
  const isAdmin = ctx.user.role === 'admin';
  const s = await GET('/api/settings');
  let users = [];
  if (isAdmin) { try { users = await GET('/api/users'); } catch { /* non admin */ } }

  el.innerHTML = `
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><h2>Societe (en-tete des documents)</h2></div>
        <div class="card-body">
          <form id="fcompany" class="form-grid">
            ${field('Raison sociale', input('company_name', s.company_name || ''), 'wide')}
            ${field('Adresse', input('company_address', s.company_address || ''), 'wide')}
            ${field('Code postal', input('company_zip', s.company_zip || ''))}
            ${field('Ville', input('company_town', s.company_town || ''))}
            ${field('Telephone', input('company_phone', s.company_phone || ''))}
            ${field('Email', input('company_email', s.company_email || ''))}
            ${field('SIRET', input('company_siret', s.company_siret || ''))}
            ${field('N° TVA', input('company_tva', s.company_tva || ''))}
            <div class="wide"><button class="btn primary" ${isAdmin ? '' : 'disabled'}>Enregistrer</button></div>
          </form>
        </div>
      </div>

      <div>
        <div class="card">
          <div class="card-head"><h2>Frais de retour</h2></div>
          <div class="card-body">
            <form id="ffees" class="form-grid">
              ${field('DPD — frais HT par colis (€)', input('fee_dpd', s.fee_dpd || '12.50', 'type="number" step="0.01"'))}
              ${field('Representant — frais HT (€)', input('fee_representant', s.fee_representant || '3.50', 'type="number" step="0.01"'))}
              ${field('Representant — seuil HT (€)', input('fee_representant_threshold', s.fee_representant_threshold || '200', 'type="number" step="0.01"'))}
              ${field('TVA sur frais (%)', input('fee_tva', s.fee_tva || '20', 'type="number" step="0.1"'))}
              ${field('TVA par defaut livres (%)', input('default_tva', s.default_tva || '5.5', 'type="number" step="0.1"'))}
              <div class="wide"><button class="btn primary" ${isAdmin ? '' : 'disabled'}>Enregistrer</button></div>
            </form>
            <p style="color:var(--text-3);font-size:12px;margin-bottom:0">
              Gradignan et « A dispo » restent sans frais. Les frais Representant ne s'appliquent que si l'avoir depasse le seuil.</p>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h2>Comptabilite</h2></div>
          <div class="card-body">
            <form id="facc" class="form-grid">
              ${field('Delai de paiement (jours)', input('payment_terms_days', s.payment_terms_days || '30', 'type="number" min="0"'))}
              ${field('Compte clients (411)', input('acc_client', s.acc_client || '411000'))}
              ${field('Compte ventes livres (701)', input('acc_sales', s.acc_sales || '701100'))}
              ${field('Compte frais / ports (708)', input('acc_fees', s.acc_fees || '708500'))}
              ${field('Compte TVA collectee (44571)', input('acc_vat', s.acc_vat || '445710'))}
              ${field('Compte banque (512)', input('acc_bank', s.acc_bank || '512000'))}
              ${field('Compte caisse (530)', input('acc_cash', s.acc_cash || '530000'))}
              <div class="wide"><button class="btn primary" ${isAdmin ? '' : 'disabled'}>Enregistrer</button></div>
            </form>
            <p style="color:var(--text-3);font-size:12px;margin-bottom:0">
              Ces comptes alimentent les journaux, les exports CSV et le fichier FEC. L'echeance des nouvelles factures = date + delai de paiement.</p>
          </div>
        </div>

        ${isAdmin ? `<div class="card">
          <div class="card-head"><h2>Utilisateurs</h2>
            <div class="spacer"></div>
            <button class="btn primary sm" id="unew">${icon('plus', 13)} Nouvel utilisateur</button></div>
          <div class="card-body flush" id="ulist"></div>
        </div>` : ''}
      </div>
    </div>`;

  const bindForm = (sel) => {
    el.querySelector(sel).addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await PUT('/api/settings', readForm(e.target)); toast('Parametres enregistres.'); }
      catch (err) { toastErr(err); }
    });
  };
  bindForm('#fcompany');
  bindForm('#ffees');
  bindForm('#facc');

  if (!isAdmin) return;

  const renderUsers = () => {
    el.querySelector('#ulist').innerHTML = dataTable({
      empty: 'Aucun utilisateur',
      columns: [
        { label: 'Identifiant', render: (u) => `<span class="main-cell">${esc(u.login)}</span>` },
        { label: 'Nom', render: (u) => esc(u.name) },
        { label: 'Role', render: (u) => `<span class="badge">${esc((ROLES.find((r) => r.value === u.role) || { label: u.role }).label)}</span>` },
        { label: 'Statut', render: (u) => u.active ? '<span class="badge green">Actif</span>' : '<span class="badge red">Desactive</span>' },
        { label: '', cls: 'actions', render: (u) => `<button class="btn sm" data-uedit="${u.id}">${icon('edit', 13)}</button>` }
      ],
      rows: users
    });
    el.querySelectorAll('[data-uedit]').forEach((b) => b.addEventListener('click', () => {
      const u = users.find((x) => x.id === Number(b.dataset.uedit));
      const { overlay, close } = modal({
        title: 'Modifier ' + u.login,
        body: `<div class="form-grid">
          ${field('Nom', input('name', u.name))}
          ${field('Role', select('role', ROLES, u.role))}
          ${field('Nouveau mot de passe (laisser vide pour conserver)', input('password', '', 'type="password"'), 'wide')}
          <label class="field"><span>Statut</span>
            <select class="input" name="active"><option value="1" ${u.active ? 'selected' : ''}>Actif</option>
            <option value="0" ${u.active ? '' : 'selected'}>Desactive</option></select></label>
        </div>`,
        footer: `<button class="btn" data-act="c">Annuler</button><button class="btn primary" data-act="s">Enregistrer</button>`
      });
      overlay.querySelector('[data-act=c]').onclick = close;
      overlay.querySelector('[data-act=s]').onclick = async () => {
        const f = readForm(overlay);
        f.active = f.active === '1';
        if (!f.password) delete f.password;
        try {
          await PUT('/api/users/' + u.id, f);
          toast('Utilisateur modifie.');
          close();
          users = await GET('/api/users');
          renderUsers();
        } catch (e) { toastErr(e); }
      };
    }));
  };
  renderUsers();

  el.querySelector('#unew').addEventListener('click', () => {
    const { overlay, close } = modal({
      title: 'Nouvel utilisateur',
      body: `<div class="form-grid">
        ${field('Identifiant *', input('login', '', 'required'))}
        ${field('Nom *', input('name', '', 'required'))}
        ${field('Mot de passe *', input('password', '', 'type="password" required'))}
        ${field('Role', select('role', ROLES, 'commercial'))}
      </div>`,
      footer: `<button class="btn" data-act="c">Annuler</button><button class="btn primary" data-act="s">Creer</button>`
    });
    overlay.querySelector('[data-act=c]').onclick = close;
    overlay.querySelector('[data-act=s]').onclick = async () => {
      try {
        await POST('/api/users', readForm(overlay));
        toast('Utilisateur cree.');
        close();
        users = await GET('/api/users');
        renderUsers();
      } catch (e) { toastErr(e); }
    };
  });
}
