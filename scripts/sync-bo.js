// scripts/sync-bo.js
import { cp, mkdir } from 'fs/promises';
import { resolve } from 'path';

const ROOT = process.cwd();
const SRC  = resolve(ROOT, 'assets', 'esm');                 // tutto il BO (JS + sottocartelle)
const DST  = resolve(ROOT, 'api', 'back-office', '_bundle'); // finisce dentro la Lambda

await mkdir(DST, { recursive: true });
await cp(SRC, DST, { recursive: true, force: true });

console.log('[sync-bo] Copiato assets/esm/** → api/back-office/_bundle');
