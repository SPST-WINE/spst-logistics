// api/back-office/[...path].js
export const config = { runtime: 'nodejs' };

import { readFile } from 'fs/promises';
import { resolve, normalize, extname } from 'path';

// 1) sorgente primaria: tutto il BO sta qui
const ALT  = resolve(process.cwd(), 'assets', 'esm');          // assets/esm/**/*
// 2) fallback: eventuale copia in public
const BASE = resolve(process.cwd(), 'public', 'back-office');  // public/back-office/**/*

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

async function tryRead(root, rel){
  const file = resolve(root, rel);
  return readFile(file);
}

export default async function handler(req, res){
  if (setCORS(req, res)) return res.status(204).end();

  const parts = Array.isArray(req.query.path) ? req.query.path : [req.query.path || ''];
  const reqPath = parts.join('/') || 'main.js';

  // hardening: no path traversal
  const safe = normalize(reqPath).replace(/^(\.\.(\/|\\|$))+/g, '');

  try{
    let buf;
    try { buf = await tryRead(ALT,  safe); }     // 1) assets/esm/**
    catch { buf = await tryRead(BASE, safe); }   // 2) fallback public/back-office/**
    const type = TYPES[extname(safe)] || 'application/octet-stream';
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600');
    return res.status(200).send(buf);
  }catch{
    return res.status(404).send('Not Found');
  }
}
