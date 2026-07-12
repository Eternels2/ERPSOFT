'use strict';
/* Remet la base a zero (supprime data/). Au prochain demarrage, la base est recreee avec la demo. */
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, '..', 'data');
if (fs.existsSync(dir)) {
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('Base supprimee. Relancez "npm start" pour repartir sur une base neuve.');
} else {
  console.log('Aucune base a supprimer.');
}
