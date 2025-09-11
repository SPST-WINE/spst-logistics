// scripts/sync-bo.js
import { cp, mkdir, access, constants } from 'fs/promises';
import { resolve } from 'path';

const ROOT = process.cwd();
const SRC  = resolve(ROOT, 'assets', 'esm');       // TUTTO il BO (sottocartelle)
const DST  = resolve(ROOT, 'public', 'back-office'); // cartella servita da /api/back-office/*
const CSS1 = resolve(ROOT, 'assets', 'esm', 'base.css');
const CSS2 = resolve(ROOT, 'assets', 'esm', 'quotes-admin.css');

async function exists(p){ try{ await access(p, constants.F_OK); return true; } catch{ return false; } }

await mkdir(DST, { recursive: true });

// copia ricorsiva di TUTTO assets/esm -> public/back-office
await cp(SRC, DST, { recursive: true, force: true });

// (ridondante: i CSS sono già in assets/esm, ma li forziamo in root)
if (await exists(CSS1)) await cp(CSS1, resolve(DST, 'base.css'), { force:true });
if (await exists(CSS2)) await cp(CSS2, resolve(DST, 'quotes-admin.css'), { force:true });

console.log('[sync-bo] Copiato assets/esm/** + CSS → public/back-office');
