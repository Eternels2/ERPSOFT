# ERPSOFT — ERP Grossiste Livres

Application web complete de gestion pour un grossiste / diffuseur de livres, creee from scratch.
Elle reprend et modernise les fonctionnalites du projet Dolibarr + module « Grossiste Livres »
(DoliLOOOL) avec une interface plus simple, plus rapide et pensee pour l'usage quotidien
(ecrans de scan entrepot, portail libraires, tableau de bord).

## Demarrage

Prerequis : **Node.js 22.5 ou plus recent** (aucune autre dependance, `npm install` inutile).

```
npm start
```

- Back-office : http://localhost:3000 — identifiants demo : `admin` / `admin` (ou `prepa` / `prepa`)
- Portail libraires (B2B) : http://localhost:3000/portal — demo : `librairie` / `livre`

Au premier lancement, la base SQLite est creee dans `data/erpsoft.db` avec un jeu de donnees
de demonstration (livres, libraires, fournisseurs, gisements, une commande en file, un depot-vente).

Remise a zero complete :

```
npm run reset
```

## Fonctionnalites

### Referentiels
- **Catalogue livres** : ISBN/EAN13, auteur, editeur, collection, format, pages, date de parution,
  remise editeur, fournisseur, prix vente/achat, TVA, double stock (principal / retour).
- **Clients libraires** : coordonnees, delai de retour (mois), CA annuel, avoirs, taux de retour,
  acces portail B2B activable par client.
- **Fournisseurs** : livres references, conteneurs de retour.

### Ventes
- **Commandes clients** : types (A dispo Gradignan, prioritaire, par nos soins, mise au banc,
  livraison, proforma), priorite 1-9, cycle brouillon → validee → preparation → preparee →
  expediee → facturee, facturation des quantites reellement preparees.
- **Depots-vente** : validation avec sortie de stock, enregistrement des retours partiels
  (reintegration stock), facturation du vendu (livree - retournee), bon de depot imprimable.
- **Factures & avoirs** : numerotation automatique (FA/AV+AAMM-NNNN), impression / export PDF,
  suivi des reglements.

### Entrepot
- **Gisements** (emplacements) : le code du gisement sert de code-barres.
- **File de preparation** triee par priorite, avec avancement.
- **Picking scanne** : scan ISBN + gisement, decompte du stock et de l'emplacement,
  cloture automatique quand tout est prepare, gestion des reliquats.
- **Rangement** (reception) : scan gisement puis ISBN → entree en stock principal + emplacement.
- **Transfert** entre gisements et **reintegration** stock retour → stock principal.

### Retours clients
- Scan des livres avec **controle automatique** : achete chez nous ? delai de retour respecte
  (base sur la derniere vente facturee au client) ? → acceptation / refus propose, corrigeable.
- **Frais par mode** : DPD (frais HT par colis), Gradignan (gratuit), Representant (frais si
  avoir > seuil), A dispo (gratuit) — montants configurables dans Parametres.
- **Finalisation** : generation de l'avoir (livres acceptes - frais), entree en stock retour,
  affectation automatique aux conteneurs fournisseurs ouverts.

### Conteneurs fournisseurs
- Un conteneur = un fournisseur ; regroupe les retours acceptes, n° de retour fournisseur,
  bordereau imprimable, expedition avec sortie definitive du stock retour.

### Comptabilite
- **Reglements** : virement, cheque, CB, especes et **imputation d'avoirs** ; reglements
  partiels, affectation aux factures (avec repartition automatique plus anciennes d'abord),
  acomptes (montant non affecte), suppression avec recalcul des statuts.
- **Echeances** : date d'echeance automatique (delai de paiement configurable), detection
  des factures en retard.
- **Encours clients & balance agee** : non echu / 1-30 / 31-60 / 61-90 / +90 jours,
  avoirs disponibles, releve de compte client imprimable.
- **Journaux en partie double** (ventes VE, banque BQ) sur plan comptable francais
  configurable (411 clients, 701 ventes, 708 frais, 44571 TVA collectee, 512 banque, 530 caisse).
- **Declaration de TVA** par periode et par taux (base HT avoirs deduits, TVA collectee).
- **Exports** : journal des ventes CSV, ecritures comptables CSV, **fichier FEC officiel**
  (18 colonnes, tabulations) pour l'expert-comptable.

### Portail B2B libraires (`/portal`)
- Catalogue avec disponibilite, panier et passage de commande (entre directement en file de
  preparation), suivi des commandes ligne a ligne, factures et avoirs imprimables.

### Administration
- Utilisateurs et roles (admin / commercial / entrepot), parametres societe (en-tete des
  documents), frais de retour, TVA.

## Architecture

```
server.js          Serveur HTTP (node:http) + routage + statique
lib/db.js          Schema SQLite (node:sqlite) + seed de demonstration
lib/web.js         Mini framework: routes, sessions (cookies), JSON
lib/services.js    Metier partage: facturation, mouvements stock, gisements
lib/print.js       Documents imprimables (facture, avoir, bordereau, bons)
api/*.js           Endpoints REST par domaine
public/            SPA back-office (vanilla JS, aucune dependance)
public/portal.html Portail B2B libraires
data/              Base SQLite (creee au premier lancement)
```

Zero dependance externe : uniquement les modules natifs de Node.js (http, sqlite, crypto).
