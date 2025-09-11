// api/back-office/[...path].js
export const config = { runtime: 'nodejs' };

import { readFile, readdir } from 'fs/promises';
import { resolve, normalize, extname } from 'path';

// Serviamo DIRETTAMENTE da assets/esm (sorgenti del BO)
// (ALT è solo un fallback opzionale; puoi ignorarlo)
const BASE = resolve(process.cwd(), 'assets', 'esm');
const ALT  = resolve(process.cwd(), 'public', 'back-office');

const TYPES = {
  '.js':  'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json':'application/json; charset=utf-8'
};

function setCORS(req, res) {
  const allow = (process.env.ORIGIN_ALLOWLIST || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const origin = req.headers.origin || '';
  const ok = allow.some(p => {
    if (!p) return false;
    if (p.includes('*')) {
      const rx = new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*') + '$');
      return rx.test(origin);
    }
    return origin === p;
  });
  if (ok) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','*');
  return (req.method === 'OPTIONS');
}

async function tryRead(base, rel){ return readFile(resolve(base, rel)); }

// Mini debug: lista cosa vede la funzione nei folder principali
async function debugList() {
  async function ls(rel='') {
    try { return await readdir(resolve(BASE, rel)); } catch { return []; }
  }
  return {
    base: BASE,
    top: await ls(''),
    ui: await ls('ui'),
    utils: await ls('utils'),
    airtable: await ls('airtable'),
    rules: await ls('rules')
  };
}

export default async function handler(req, res){
  if (setCORS(req, res)) return res.status(204).end();

  const parts   = Array.isArray(req.query.path) ? req.query.path : [req.query.path || ''];
  const reqPath = parts.join('/') || 'main.js';
  const safe    = normalize(reqPath).replace(/^(\.\.(\/|\\|$))+/g, '');

  // Endpoint di test: /api/back-office/__ls
  if (safe === '__ls'){
    const info = await debugList();
    res.setHeader('Content-Type','application/json; charset=utf-8');
    return res.status(200).send(JSON.stringify(info, null, 2));
  }

  try{
    let buf;
    try { buf = await tryRead(BASE, safe); }     // assets/esm/** (principale)
    catch { buf = await tryRead(ALT,  safe); }   // fallback (se mai lo userai)
    const type = TYPES[extname(safe)] || 'application/octet-stream';
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600');
    return res.status(200).send(buf);
  }catch{
    return res.status(404).send('Not Found');
  }
}
