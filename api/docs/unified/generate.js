// api/docs/unified/generate.js
export const config = { runtime: 'nodejs' };

import crypto from 'crypto';

const TB    = process.env.TB_SPEDIZIONI || 'SpedizioniWebApp';
const BASE  = process.env.AIRTABLE_BASE_ID;
const PAT   = process.env.AIRTABLE_PAT;
const SIGN  = process.env.DOCS_SIGNING_SECRET || '';
const ADMIN = (process.env.DOCS_ADMIN_KEY || '').trim();
const UI_OK = (process.env.DOCS_UI_REFERERS || 'https://spst-logistics-spsts-projects.vercel.app/api/tools/docs')
              .split(',').map(s => s.trim()).filter(Boolean);

const FIELD_BY_TYPE = {
  proforma: 'Allegato Proforma',
  fattura:  'Allegato Fattura',
  invoice:  'Allegato Fattura',
  dle:      'Allegato DLE',
  pl:       'Allegato PL',
};

function signHmac({ sid, type, exp }, secret) {
  const qs = new URLSearchParams([
    ['sid', sid],
    ['type', type],
    ['exp', String(exp)],
  ]).toString();
  return crypto.createHmac('sha256', secret).update(qs).digest('hex');
}

async function readJson(req){
  return new Promise((resolve, reject) => {
    let b=''; req.on('data', c => b+=c);
    req.on('end', () => { try{ resolve(b ? JSON.parse(b) : {}); } catch(e){ reject(e);} });
    req.on('error', reject);
  });
}

async function findRecordIdByIdSpedizione(idSped) {
  const url = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TB)}?${new URLSearchParams({
    filterByFormula: `({ID Spedizione} = '${String(idSped).replace(/'/g,"\\'")}')`,
    maxRecords: '1',
  })}`;

  const r = await fetch(url, { headers: { Authorization: `Bearer ${PAT}` } });
  const j = await r.json();
  const recId = j?.records?.[0]?.id || '';
  return recId;
}

export default async function handler(req, res){
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok:false, error:'Method Not Allowed' });
  }

  const safeHeaders = {
    origin: req.headers.origin, referer: req.headers.referer, host: req.headers.host,
    'user-agent': req.headers['user-agent']
  };
  console.log('[generate] IN', { time:new Date().toISOString(), headers: safeHeaders });

  // Autorizzo: X-Admin-Key = DOCS_ADMIN_KEY oppure referer in whitelist
  const xKey = (req.headers['x-admin-key'] || '').toString().trim();
  const ref  = (req.headers.referer || '').toString();
  const isAdmin = ADMIN && xKey && xKey === ADMIN;
  const fromUi  = UI_OK.some(p => ref.startsWith(p));

  if (!(isAdmin || fromUi)) {
    console.warn('[generate] 401 auth failed', { fromUi, hasAdmin: !!isAdmin });
    return res.status(401).json({ ok:false, error:'Unauthorized' });
  }

  if (!BASE || !PAT || !SIGN) {
    console.error('[generate] 500 missing env', { hasBASE:!!BASE, hasPAT:!!PAT, hasSIGN:!!SIGN });
    return res.status(500).json({ ok:false, error:'Server misconfigured' });
  }

  try{
    const body = await readJson(req);
    let { shipmentId, idSpedizione, type='proforma' } = body || {};
    type = (type || 'proforma').toLowerCase();

    // Se non arriva recId ma un "ID Spedizione", risolvo via lookup
    if (!shipmentId && idSpedizione) {
      shipmentId = await findRecordIdByIdSpedizione(idSpedizione);
      console.log('[generate] lookup idSpedizione → recId', { idSpedizione, recId: shipmentId });
    }
    if (!shipmentId) {
      return res.status(422).json({ ok:false, error:'recordId required (shipmentId or idSpedizione)' });
    }

    const field = FIELD_BY_TYPE[type];
    if (!field) {
      return res.status(400).json({ ok:false, error:'Unsupported type', type });
    }

    const exp = Math.floor(Date.now()/1000) + 60*10; // 10 minuti
    const sig = signHmac({ sid: shipmentId, type, exp }, SIGN);

    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host  = req.headers['x-forwarded-host']  || req.headers.host;
    const url   = `${proto}://${host}/api/docs/unified/render?${new URLSearchParams({ sid: shipmentId, type, exp: String(exp), sig })}`;

    console.log('[generate] make-sig', {
      sid: shipmentId, type, exp,
      sigPrefix: sig.slice(0, 12) + '…',
      secretLen: String(SIGN).length
    });

    // PATCH Airtable (allega l’URL firmato)
    const bodyPatch = {
      records: [{ id: shipmentId, fields: { [field]: [{ url, filename: `${shipmentId}-${type}.pdf` }] } }]
    };
    const ar = await fetch(`https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TB)}`, {
      method:'PATCH',
      headers:{ Authorization:`Bearer ${PAT}`, 'Content-Type':'application/json' },
      body: JSON.stringify(bodyPatch),
    });
    const atxt = await ar.text();
    if (!ar.ok) {
      console.error('[generate] Airtable error', ar.status, atxt);
      return res.status(422).json({ ok:false, error:`Airtable ${ar.status}: ${atxt}` });
    }

    console.log('[generate] OK', { field, recId: shipmentId, type, via: isAdmin?'admin':'referer' });
    return res.status(200).json({ ok:true, url, field, recId: shipmentId, type, via: isAdmin?'admin':'referer' });

  }catch(e){
    console.error('[generate] ERROR', e);
    return res.status(500).json({ ok:false, error:String(e?.message || e) });
  }
}
