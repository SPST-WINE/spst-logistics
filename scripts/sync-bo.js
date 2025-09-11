import { rm, mkdir, cp, stat } from 'fs/promises';
import { resolve } from 'path';
async function exists(p){ try{ await stat(p); return true; }catch{ return false; } }

const ROOT = process.cwd();
const SRC  = resolve(ROOT, 'assets', 'esm');         // tutto il BO
const DST  = resolve(ROOT, 'public', 'back-office'); // servito da /api/back-office/*
const CSS1 = resolve(ROOT, 'back-office', 'base.css');
const CSS2 = resolve(ROOT, 'back-office', 'quotes-admin.css');

await rm(DST, { recursive:true, force:true });
await mkdir(DST, { recursive:true });

// copia ricorsiva
await cp(SRC, DST, { recursive:true });

// copia CSS root
if (await exists(CSS1)) await cp(CSS1, resolve(DST, 'base.css'));
if (await exists(CSS2)) await cp(CSS2, resolve(DST, 'quotes-admin.css'));

console.log('[sync-bo] Copiato assets/esm/** + CSS → public/back-office');
