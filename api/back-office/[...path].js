// api/back-office/[...path].js
export const config = { runtime: 'nodejs' };

import { readFile, readdir } from 'fs/promises';
import { resolve, normalize, extname } from 'path';

// Primario: bundle copiato in build (vedi scripts/sync-bo.js)
const BASE = resolve(process.cwd(), 'api', 'back-office', '_bundle');
// Fallback: sorgenti (utile in locale)
const ALT  = resolve(process.cwd(), 'assets', 'esm');

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

async function ls(base, dir=''){ try { return await readdir(resolve(base, dir)); } catch { return []; } }

export default async function handler(req, res){
  if (setCORS(req, res)) return res.status(204).end();

  const parts   = Array.isArray(req.query.path) ? req.query.path : [req.query.path || ''];
  const reqPath = parts.join('/') || 'main.js';
  const safe    = normalize(reqPath).replace(/^(\.\.(\/|\\|$))+/g, '');

  // debug: GET /api/back-office/__ls
  if (safe === '__ls'){
    res.setHeader('Content-Type','application/json; charset=utf-8');
    const payload = {
      bundle: {
        base: BASE,
        top:       await ls(BASE),
        ui:        await ls(BASE, 'ui'),
        utils:     await ls(BASE, 'utils'),
        airtable:  await ls(BASE, 'airtable'),
        rules:     await ls(BASE, 'rules'),
      },
      alt: {
        base: ALT,
        top:       await ls(ALT),
        ui:        await ls(ALT, 'ui'),
        utils:     await ls(ALT, 'utils'),
        airtable:  await ls(ALT, 'airtable'),
        rules:     await ls(ALT, 'rules'),
      }
    };
    return res.status(200).send(JSON.stringify(payload, null, 2));
  }

  try{
    let buf;
    try { buf = await tryRead(BASE, safe); }
    catch { buf = await tryRead(ALT,  safe); }

    const type = TYPES[extname(safe)] || 'application/octet-stream';
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600');
    return res.status(200).send(buf);
  }catch{
    return res.status(404).send('Not Found');
  }
}
