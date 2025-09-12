// api/docs/unified/generate.js — Vercel Function (Pages Router)
const crypto = require('crypto');
const fetch = global.fetch; // disponibile su Vercel runtime

const SECRET = process.env.DOCS_SIGNING_SECRET || process.env.ATTACH_SECRET || '';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || ''; // es. https://spst-logistics-....vercel.app
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.AIRTABLE_API_KEY || '';
const AIRTABLE_BASE  = process.env.AIRTABLE_BASE || '';
const TB_SPEDIZIONI  = process.env.TB_SPEDIZIONI || 'SpedizioniWebApp';

// mapping richiesto
const FIELD_BY_TYPE = {
  proforma: 'Allegato Fattura',
  fattura:  'Allegato Fattura',
  invoice:  'Allegato Fattura',
  dle:      'Allegato DLE',
  pl:       'Allegato PL',
};

function hmacHex(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
}
function bad(res, code, error, details) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(code).send(JSON.stringify({ ok: false, error, details }));
}

async function attachToAirtable({ baseId, tableName, recId, fieldName, url, filename }) {
  if (!AIRTABLE_TOKEN || !baseId || !tableName || !recId || !fieldName) {
    return { ok:false, skipped:true, reason:'missing-config' };
  }
  const api = `https://api.airtable.com/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(tableName)}/${encodeURIComponent(recId)}`;
  const body = {
    fields: {
      [fieldName]: [{ url, filename }],
    }
  };
  const r = await fetch(api, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${AIRTABLE_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const text = await r.text();
    return { ok:false, error:`Airtable ${r.status}`, details:text };
  }
  return { ok:true };
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return bad(res, 405, 'Method Not Allowed');
    }
    const now = new Date().toISOString();
    const { idSpedizione, type = 'proforma', recId: sidFromBody, courier } = (req.body || {});

    // Qui assumiamo che “recId” (sid) arrivi già risolto; in alternativa potresti
    // fare una lookup su Airtable partendo da idSpedizione. Per semplicità, usiamo recId se c'è.
    const sid = String(sidFromBody || '').trim();
    if (!sid) return bad(res, 400, 'Missing recId (sid)');

    if (!SECRET) return bad(res, 500, 'Server misconfigured', 'Missing DOCS_SIGNING_SECRET');

    const t  = String(type || 'proforma').toLowerCase();
    const exp = Math.floor(Date.now()/1000) + 60 * 15; // 15 minuti
    const base = `${sid}.${t}.${exp}`;
    const sig  = hmacHex(base);

    const origin = PUBLIC_BASE_URL || `https://${req.headers.host}`;
    const url = new URL('/api/docs/unified/render', origin);
    url.searchParams.set('sid', sid);
    url.searchParams.set('type', t);
    url.searchParams.set('exp', String(exp));
    url.searchParams.set('sig', sig);
    // parametri NON firmati (safe)
    if (idSpedizione) url.searchParams.set('ship', idSpedizione);
    if (courier)      url.searchParams.set('courier', courier);

    // Campo Airtable da usare
    const field = FIELD_BY_TYPE[t] || 'Allegato 1';

    // Allego su Airtable (se configurato)
    let at = { ok:false, skipped:true, reason:'not-attempted' };
    try {
      // filename utile per distinguere
      const fname = `${t}-${sid}-${exp}.html`;
      at = await attachToAirtable({
        baseId: AIRTABLE_BASE,
        tableName: TB_SPEDIZIONI,
        recId: sid,
        fieldName: field,
        url: url.toString() + '&format=html',
        filename: fname
      });
    } catch (e) {
      at = { ok:false, error:'attach-failed', details: e && e.message ? e.message : String(e) };
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(JSON.stringify({
      ok: true,
      url: url.toString(),
      field,
      recId: sid,
      type: t,
      via: 'generate',
      attached: at
    }, null, 2));
  } catch (err) {
    console.error('[generate] 500', err);
    return bad(res, 500, 'Generate error', err && err.message ? err.message : String(err));
  }
}
