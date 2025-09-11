// api/docs/unified/generate.js
export const config = { runtime: 'nodejs' };

import crypto from 'crypto';

const TB    = process.env.TB_SPEDIZIONI || 'SpedizioniWebApp';
const SINGLE_INVOICE_FIELD = process.env.DOCS_FIELD_FATTURA || 'Allegato Fattura';
const BASE  = process.env.AIRTABLE_BASE_ID;
const PAT   = process.env.AIRTABLE_PAT;
const SIGN  = process.env.DOCS_SIGNING_SECRET || '';
const ADMIN = (process.env.DOCS_ADMIN_KEY || '').trim();
const UI_OK = (process.env.DOCS_UI_REFERERS || 'https://spst-logistics-spsts-projects.vercel.app/api/tools/docs')
  .split(',').map(s => s.trim()).filter(Boolean);

// Override opzionali: usa questi se vuoi forzare i nomi campo da env
const OV = {
  proforma: process.env.DOCS_FIELD_PROFORMA,
  fattura:  process.env.DOCS_FIELD_FATTURA,
  invoice:  process.env.DOCS_FIELD_FATTURA, // alias
  dle:      process.env.DOCS_FIELD_DLE,
  pl:       process.env.DOCS_FIELD_PL,
};

// Preferenze (con fallback) per ogni tipo
const FIELD_PREFS = {
  proforma: [SINGLE_INVOICE_FIELD, 'Allegato Fattura', 'Fattura', 'Allegato 1'],
  fattura:  [SINGLE_INVOICE_FIELD, 'Allegato Fattura', 'Fattura', 'Allegato 2'],
  invoice:  [SINGLE_INVOICE_FIELD, 'Allegato Fattura', 'Fattura', 'Allegato 2'],
  dle: [process.env.DOCS_FIELD_DLE || 'Allegato DLE', 'DLE', 'Dichiarazione Libera Esportazione', 'Allegato 3'],
  pl:  [process.env.DOCS_FIELD_PL || 'Allegato PL',
        'Packing List', 'PL', 'Allegato 1'],
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
  const url = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TB)}?` + new URLSearchParams({
    filterByFormula: `({ID Spedizione} = '${String(idSped).replace(/'/g,"\\'")}')`,
    maxRecords: '1',
  });
  const r = await fetch(url, { headers: { Authorization: `Bearer ${PAT}` } });
  const j = await r.json();
  return j?.records?.[0]?.id || '';
}

async function tryPatchField(recId, fieldName, url) {
  const bodyPatch = {
    records: [{ id: recId, fields: { [fieldName]: [{ url, filename: `${recId}.pdf` }] } }]
  };
  const r = await fetch(`https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TB)}`, {
    method:'PATCH',
    headers:{ Authorization:`Bearer ${PAT}`, 'Content-Type':'application/json' },
    body: JSON.stringify(bodyPatch),
  });
  const text = await r.text();
  return { ok: r.ok, status: r.status, text };
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

  // Auth: X-Admin-Key = DOCS_ADMIN_KEY oppure referer whitelisted
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

    if (!shipmentId && idSpedizione) {
      shipmentId = await findRecordIdByIdSpedizione(idSpedizione);
      console.log('[generate] lookup idSpedizione → recId', { idSpedizione, recId: shipmentId });
    }
    if (!shipmentId) {
      return res.status(422).json({ ok:false, error:'recordId required (shipmentId or idSpedizione)' });
    }

    // Costruisco URL firmato per il render
    const exp = Math.floor(Date.now()/1000) + 60*10; // 10 minuti
    const sig = signHmac({ sid: shipmentId, type, exp }, SIGN);
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host  = req.headers['x-forwarded-host']  || req.headers.host;
    const url   = `${proto}://${host}/api/docs/unified/render?` +
                  new URLSearchParams({ sid: shipmentId, type, exp: String(exp), sig });

    console.log('[generate] make-sig', {
      sid: shipmentId, type, exp,
      sigPrefix: sig.slice(0,12) + '…',
      secretLen: String(SIGN).length
    });

    // Scegli i candidati per quel tipo (filtra quelli falsy o duplicati)
    const candidates = Array.from(new Set((FIELD_PREFS[type] || []).filter(Boolean)));
    if (!candidates.length) {
      return res.status(400).json({ ok:false, error:'Unsupported type', type });
    }

    // Prova in cascata i campi
    let chosen = null, lastErr = null;
    for (const fieldName of candidates) {
      const { ok, status, text } = await tryPatchField(shipmentId, fieldName, url);
      if (ok) { chosen = fieldName; break; }
      // se è UNKNOWN_FIELD_NAME, tenta il prossimo
      if (status === 422 && /UNKNOWN_FIELD_NAME/i.test(text)) {
        console.warn('[generate] field not found, trying next', { fieldName });
        lastErr = text;
        continue;
      }
      // altro errore: abort
      console.error('[generate] Airtable error (non field)', status, text);
      return res.status(422).json({ ok:false, error:`Airtable ${status}: ${text}` });
    }

    if (!chosen) {
      console.error('[generate] no candidate field worked', { candidates, lastErr });
      return res.status(422).json({
        ok:false,
        error: `Airtable 422: nessun campo valido fra: ${candidates.join(', ')}`,
        hint: 'Crea uno dei campi su Airtable oppure usa gli override DOCS_FIELD_* nelle env'
      });
    }

    console.log('[generate] OK', { field: chosen, recId: shipmentId, type, via: isAdmin?'admin':'referer' });
    return res.status(200).json({ ok:true, url, field: chosen, recId: shipmentId, type, via: isAdmin?'admin':'referer' });

  }catch(e){
    console.error('[generate] ERROR', e);
    return res.status(500).json({ ok:false, error:String(e?.message || e) });
  }
}
