// /api/airtable/upload.js
// POST /api/airtable/upload?filename=...&contentType=...
// Body: raw file bytes. Ritorna { url } pubblico da usare come attachment in Airtable.

import { put } from '@vercel/blob';

export default async function handler(req, res){
  if (req.method === 'OPTIONS') return sendCORS(req, res);
  sendCORS(req, res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try{
    const filename = (req.query.filename || 'upload.bin').toString();
    const contentType = (req.query.contentType || 'application/octet-stream').toString();

    const buffer = await readBuffer(req);
    if (!buffer || !buffer.length){
      return res.status(400).json({ error: 'Empty body' });
    }

    // Upload su Vercel Blob (richiede BLOB_READ_WRITE_TOKEN su Vercel)
    const blob = await put(filename, buffer, { access: 'public', contentType });

    // Ritorna solo la URL pubblica
    return res.status(200).json({ url: blob?.url });
  }catch(e){
    console.error('[upload] error', e);
    return res.status(502).json({ error: 'Upload failed', details: String(e?.message || e) });
  }
}

/* ───────── helpers ───────── */

function sendCORS(req,res){
  const origin = req.headers.origin || '';
  const list = (process.env.ORIGIN_ALLOWLIST || '*')
    .split(',')
    .map(s=>s.trim())
    .filter(Boolean);

  const allowed =
    list.includes('*') ||
    (!origin) ||
    list.some(p => safeWildcardMatch(origin, p));

  if (allowed && origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age','600');
  if (req.method === 'OPTIONS') return res.status(204).end();
}

function safeWildcardMatch(input, pattern){
  if (pattern === '*') return true;
  const rx = '^' + pattern.split('*').map(escapeRegex).join('.*') + '$';
  return new RegExp(rx).test(input);
}
function escapeRegex(str){ return str.replace(/[|\\{}()[\]^$+?.]/g, '\\$&'); }

async function readBuffer(req){
  const chunks = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks);
}
