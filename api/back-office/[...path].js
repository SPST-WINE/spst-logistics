// api/back-office/[...path].js
// Serve gli asset del Back Office direttamente dal repo (assets/esm + css in back-office)

import { promises as fs } from 'fs';
import path from 'path';

export const config = { runtime: 'nodejs' };

const ROOT = process.cwd();

function contentType(p) {
  const ext = path.extname(p).toLowerCase();
  if (ext === '.js' || ext === '.mjs') return 'application/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.map') return 'application/json; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.woff2') return 'font/woff2';
  return 'application/octet-stream';
}

export default async function handler(req, res) {
  // CORS per Webflow
  res.setHeader('Access-Control-Allow-Origin', 'https://www.spst.it');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    // path richiesto (catch-all)
    const segs = Array.isArray(req.query.path) ? req.query.path : [req.query.path].filter(Boolean);
    let rel = segs.join('/');

    // hardening
    if (!rel || rel.includes('..') || rel.startsWith('/')) {
      return res.status(400).send('Bad Request');
    }

    // dove cerchiamo i file:
    // 1) CSS in /back-office (base.css, quotes-admin.css, ecc.)
    // 2) tutto il resto in /assets/esm
    const candidates = [
      path.join(ROOT, 'back-office', rel),
      path.join(ROOT, 'assets', 'esm', rel),
    ];

    let filePath = null;
    for (const p of candidates) {
      try {
        const st = await fs.stat(p);
        if (st.isFile()) { filePath = p; break; }
      } catch { /* next */ }
    }

    if (!filePath) return res.status(404).send('Not Found');

    const buf = await fs.readFile(filePath);
    res.setHeader('Content-Type', contentType(filePath));
    res.setHeader('Cache-Control', 'public, max-age=300'); // 5 min
    return res.status(200).end(buf);
  } catch (e) {
    console.error('back-office static error', e);
    return res.status(500).send('Internal Error');
  }
}
