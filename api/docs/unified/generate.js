// api/docs/unified/generate.js  (ESM + Node 20)
// RUNTIME: Node.js (NOT Edge)
export const config = { runtime: 'nodejs' };

import crypto from 'node:crypto';

const SECRET          = process.env.DOCS_SIGNING_SECRET || process.env.ATTACH_SECRET || '';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || '';
const AIRTABLE_TOKEN  = process.env.AIRTABLE_TOKEN || process.env.AIRTABLE_API_KEY || '';
const AIRTABLE_BASE   = process.env.AIRTABLE_BASE || '';
const TB_SPEDIZIONI   = process.env.TB_SPEDIZIONI || 'SpedizioniWebApp';

const FIELD_BY_TYPE = {
  proforma: 'Allegato Fattura',          // campo unico per proforma/fattura
  fattura : 'Allegato Fattura',
  invoice : 'Allegato Fattura',
  dle     : 'Allegato DLE',
  pl      : 'Allegato PL',
};

const hmacHex = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('hex');
const bad = (res, code, error, details) => {
  res.setHeader('Content-Type','application/json; charset=utf-8');
  return res.status(code).send(JSON.stringify({ ok:false, error, details }));
};

function readJsonBody(req){
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    let data=''; req.on('data', c => data += c);
    req.on('end', () => { try{ resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

async function airtableLookupRecId(idSpedizione){
  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE || !idSpedizione) return null;
  const table = encodeURIComponent(TB_SPEDIZIONI);
  const base  = encodeURIComponent(AIRTABLE_BASE);
  const escaped = idSpedizione.replace(/'/g,"''");
  const url = `https://api.airtable.com/v0/${base}/${table}?maxRecords=1&filterByFormula=${encodeURIComponent(`{ID Spedizione}='${escaped}'`)}`;
  const r = await fetch(url, { headers: { Authorization:`Bearer ${AIRTABLE_TOKEN}` }});
  if (!r.ok) return null;
  const j = await r.json().catch(()=>null);
  return j?.records?.[0]?.id || null;
}

async function attachToAirtable({ recId, fieldName, url, filename }){
  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE || !recId || !fieldName) {
    return { ok:false, skipped:true, reason:'missing-config-or-recId' };
  }
  const api = `https://api.airtable.com/v0/${encodeURIComponent(AIRTABLE_BASE)}/${encodeURIComponent(TB_SPEDIZIONI)}/${encodeURIComponent(recId)}`;
  const body = { fields: { [fieldName]: [{ url, filename }] } };
  const r = await fetch(api, {
    method:'PATCH',
    headers:{ 'Authorization':`Bearer ${AIRTABLE_TOKEN}`, 'Content-Type':'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const text = await r.text();
    return { ok:false, error:`Airtable ${r.status}`, details:text };
  }
  return { ok:true };
}

export default async function handler(req, res){
  const started = Date.now();
  try{
    if (req.method !== 'POST') { res.setHeader('Allow','POST'); return bad(res,405,'Method Not Allowed'); }

    const body = await readJsonBody(req);
    const idSpedizione = (body.idSpedizione || '').trim();
    const type = String(body.type || 'proforma').toLowerCase();

    if (!SECRET) return bad(res,500,'Server misconfigured','Missing DOCS_SIGNING_SECRET');
    if (!idSpedizione) return bad(res,400,'Missing parameter','idSpedizione');

    // ricava recId da Airtable (se non passato)
    let recId = (body.recId || '').startsWith('rec') ? body.recId : null;
    if (!recId) { try { recId = await airtableLookupRecId(idSpedizione); } catch {} }

    // firma URL con sid coerente a render
    const sid = recId || idSpedizione;
    const exp = Math.floor(Date.now()/1000) + 60*15;
    const sig = hmacHex(`${sid}.${type}.${exp}`);

    const origin = PUBLIC_BASE_URL || `https://${req.headers.host}`;
    const u = new URL('/api/docs/unified/render', origin);
    u.searchParams.set('sid', sid);
    u.searchParams.set('type', type);
    u.searchParams.set('exp', String(exp));
    u.searchParams.set('sig', sig);
    u.searchParams.set('ship', idSpedizione);
    if (body.courier) u.searchParams.set('courier', String(body.courier));

    const field = FIELD_BY_TYPE[type] || 'Allegato 1';

    let attach = { ok:false, skipped:true, reason:'not-attempted' };
    if (recId) {
      try{
        attach = await attachToAirtable({
          recId, fieldName: field,
          url: u.toString() + '&format=html',
          filename: `${type}-${idSpedizione}-${exp}.html`
        });
      }catch(e){
        attach = { ok:false, error:'attach-failed', details: e?.message || String(e) };
      }
    }

    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.setHeader('Cache-Control','no-store');
    return res.status(200).send(JSON.stringify({
      ok:true,
      url: u.toString(),
      field,
      recId: recId || null,
      sid,
      type,
      via:'generate',
      attached: attach,
      ms: Date.now() - started
    }, null, 2));
  }catch(e){
    console.error('[generate] 500', e);
    return bad(res,500,'Generate error', e?.message || String(e));
  }
}
