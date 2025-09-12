// api/docs/unified/generate.js
import crypto from 'crypto';

// ── ENV ──────────────────────────────────────────────────────────────────
const TB        = process.env.TB_SPEDIZIONI || 'SpedizioniWebApp';
const BASE      = process.env.AIRTABLE_BASE_ID;
const PAT       = process.env.AIRTABLE_PAT;
const SIGN      = process.env.DOCS_SIGNING_SECRET;
const ADMIN_KEY = (process.env.DOCS_ADMIN_KEY || '').trim();

const FIELD_BY_TYPE = (t) => {
  const k = String(t || '').toLowerCase();
  if (k === 'dle') return 'Allegato DLE';
  if (k === 'pl')  return 'Allegato PL';
  // proforma e fattura usano lo stesso campo
  return 'Allegato Fattura';
};

// ── utils ────────────────────────────────────────────────────────────────
function escapeFormula(s=''){
  // doppia singola per Airtable
  return String(s).replace(/'/g, "''");
}
function hmac(params) {
  const qs = new URLSearchParams(params).toString();
  return crypto.createHmac('sha256', SIGN).update(qs).digest('hex');
}
function parseCsv(v) {
  return String(v || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}
function logReq(req, note=''){
  const safe = {
    origin: req.headers.origin,
    referer: req.headers.referer,
    host: req.headers.host,
    ua: req.headers['user-agent']
  };
  console.log('[generate]', note || 'IN', { time: new Date().toISOString(), headers: safe });
}

async function readJson(req){
  if (req.body && typeof req.body === 'object') return req.body;
  return new Promise((resolve, reject) => {
    let b=''; req.on('data', c => b+=c);
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch(e){ reject(e);} });
    req.on('error', reject);
  });
}

// referer oppure admin header
function checkAuth(req){
  if (ADMIN_KEY) {
    const hdr = (req.headers['x-admin-key'] || req.headers.authorization || '').toString().replace(/^Bearer\s+/i,'');
    if (hdr && hdr === ADMIN_KEY) return { ok:true, how:'header' };
  }
  const allowed = parseCsv(process.env.DOCS_UI_REFERERS || 'https://spst-logistics-spsts-projects.vercel.app/api/tools/docs');
  const ref = String(req.headers.referer || '');
  if (allowed.some(x => ref.startsWith(x))) return { ok:true, how:'referer' };
  return { ok:false };
}

// ── handler ──────────────────────────────────────────────────────────────
export default async function handler(req, res){
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok:false, error:'Method Not Allowed' });
  }

  logReq(req);

  const auth = checkAuth(req);
  if (!auth.ok) {
    console.warn('[generate] 401');
    return res.status(401).json({ ok:false, error:'Unauthorized' });
  }

  try {
    const body = await readJson(req);
    // accetta sia shipmentId (recXXXX) sia idSpedizione (valore del campo)
    let { shipmentId, idSpedizione, type='proforma' } = body || {};
    type = String(type || 'proforma').toLowerCase();

    // se non ho recId, cerco via "ID Spedizione"
    if (!shipmentId && idSpedizione) {
      const url = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TB)}?maxRecords=1&filterByFormula=${encodeURIComponent(
        `{ID Spedizione}='${escapeFormula(idSpedizione)}'`
      )}`;
      const r = await fetch(url, { headers: { Authorization:`Bearer ${PAT}` } });
      const j = await r.json();
      const rec = j?.records?.[0];
      if (!rec) return res.status(422).json({ ok:false, error:'record non trovato da "ID Spedizione"' });
      shipmentId = rec.id;
      console.log('[generate] lookup idSpedizione → recId', { idSpedizione, recId: shipmentId });
    }

    if (!shipmentId) {
      return res.status(422).json({ ok:false, error:'recordId obbligatorio' });
    }

    const field = FIELD_BY_TYPE(type);

    // firma URL per /render
    const exp = String(Math.floor(Date.now()/1000) + 60*10);
    const params = { sid: shipmentId, type, exp };
    const sig = hmac(params);

    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host  = req.headers['x-forwarded-host'] || req.headers.host;

    const base = `${proto}://${host}/api/docs/unified/render?${new URLSearchParams({ ...params, sig })}`;
    const urlDownload = `${base}&dl=1`;  // per Airtable (download diretto)
    const urlView     = base;            // per apertura in tab

    // patch Airtable
    const filename = `${idSpedizione || shipmentId}-${type}.pdf`;
    const payload = {
      records: [{ id: shipmentId, fields: { [field]: [{ url: urlDownload, filename }] } }]
    };

    const r = await fetch(`https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TB)}`, {
      method:'PATCH',
      headers:{ 'Authorization':`Bearer ${PAT}`, 'Content-Type':'application/json' },
      body: JSON.stringify(payload)
    });

    const txt = await r.text();
    if (!r.ok) {
      console.error('[generate] Airtable error', r.status, txt);
      return res.status(r.status).json({ ok:false, error:`Airtable ${r.status}: ${txt}` });
    }

    console.log('[generate] OK', { field, recId: shipmentId, type, via: auth.how });
    return res.status(200).json({
      ok: true,
      url: urlDownload,
      viewUrl: urlView,
      field,
      recId: shipmentId,
      type,
      via: auth.how
    });
  } catch (e) {
    console.error('[generate] error', e);
    return res.status(500).json({ ok:false, error:String(e?.message || e) });
  }
}
