# Installation et lancement sous Windows

## 1. Prerequis : Node.js (la seule chose a installer)

ERPSOFT n'a **aucune dependance externe** : pas de `npm install`, pas de base de donnees a
installer (SQLite est integre a Node.js), pas de PHP ni de serveur web. Il faut uniquement :

- **Node.js version 22.5 ou plus recente**

### Verifier si Node.js est deja installe
Ouvrez l'invite de commandes (Windows + R → `cmd` → Entree) et tapez :
```
node -v
```
- Si vous voyez `v22.x`, `v24.x` ou plus recent → tout est bon, passez a l'etape 2.
- Si vous voyez une erreur ou une version < 22 → installez Node.js :

### Installer Node.js
- Telechargez la version **LTS** sur https://nodejs.org/fr et installez-la (suivant → suivant),
- ou en ligne de commande : `winget install OpenJS.NodeJS.LTS`

Fermez puis rouvrez l'invite de commandes apres installation.

## 2. Lancer l'application

### Methode 1 — double-clic (recommandee)
Double-cliquez sur **`Lancer ERPSOFT.bat`** dans le dossier ERPSOFT.
Le serveur demarre et votre navigateur s'ouvre automatiquement sur l'application.

### Methode 2 — ligne de commande
```
cd C:\Users\ericz\Desktop\ERPSOFT
npm start
```
Puis ouvrez http://localhost:3000 dans votre navigateur.

## 3. Connexion

| Acces | Adresse | Identifiants demo |
|---|---|---|
| Back-office (gestion) | http://localhost:3000 | `admin` / `admin` |
| Back-office (preparateur) | http://localhost:3000 | `prepa` / `prepa` |
| Portail libraires (B2B) | http://localhost:3000/portal | `librairie` / `livre` |

> Changez ces mots de passe dans **Parametres → Utilisateurs** avant une utilisation reelle.

## 4. Bon a savoir

- **Laissez la fenetre noire ouverte** : c'est le serveur. La fermer arrete l'application.
- Vos donnees sont dans `data\erpsoft.db`. **Sauvegarde** = copier ce fichier.
- **Remise a zero** (base de demonstration neuve) : arretez le serveur puis `npm run reset`,
  et relancez.
- Port deja utilise (`EADDRINUSE`) : une autre instance tourne deja — fermez-la d'abord.
  Pour utiliser un autre port : `set PORT=3010` puis `npm start`.
- **Acces depuis un autre PC / une tablette du reseau local** (ex. douchette de l'entrepot) :
  lancez le serveur, puis sur l'autre appareil ouvrez `http://IP-DU-PC:3000`
  (trouvez l'IP avec `ipconfig`). Autorisez Node.js dans le pare-feu Windows si demande.
