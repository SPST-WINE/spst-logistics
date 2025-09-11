// scripts/sync-bo.js
import { cpSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const SRC = resolve('assets/esm');            // tutto il BO (js)
const PUB = resolve('public/back-office');     // destinazione statica
mkdirSync(PUB, { recursive: true });
cpSync(SRC, PUB, { recursive: true });                     // copia TUTTO (subfolder incluse)
cpSync('back-office/base.css', `${PUB}/base.css`);         // css
cpSync('back-office/quotes-admin.css', `${PUB}/quotes-admin.css`);
console.log('[sync-bo] Copiato assets/esm → public/back-office e CSS');
