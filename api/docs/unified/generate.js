// api/docs/unified/generate.js
export const config = { runtime: 'nodejs' };

import crypto from 'crypto';

const TB    = process.env.TB_SPEDIZIONI || 'Spedizioni';
const BASE  = process.env.AIRTABLE_BASE_ID || '';
const PAT   = process.env.AIRTABLE_PAT || '';
const SIGN  = process.env.DOCS_SIGNING_SECRET || '';
const ADMIN = (process.env.DOCS_ADMIN_KEY || '').trim();

function parseCsv(v) {
  return String(v || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function checkAuth(req) {
  // 1) Header admin key
  const hdrAdmin =
    (req.headers['x-admin-key'] && String(req.headers['x-admin-key'])) ||
    (req.headers.authorization && String(req.headers.authorization).replace(/^Bearer\s+/i, ''));

  if (ADMIN && hdrAdmin && hdrAdmin === ADMIN) {
    return { ok: true, how: 'header' };
  }

  // 2) Referer allowlist (default: la pagina utility su questo progetto)
  const referer = String(req.headers.referer || '');
  const allowed = parseCsv(process.env.DOCS_UI_REFERERS || 'https://spst-logistics.vercel.app/api/tools/docs');
  const byRef = allowed.some(p => referer.startsWith(p));
  if (byRef) return { ok: true, how: 'referer' };

  // 3) Se non hai impostato ADMIN e non vuoi bloccare in locale, consenti tutto (opzionale)
  if (!ADMIN && !process.env.DOCS_UI_REFERERS) {
    return { ok: true, how: 'open' };
  }
  return { ok: false };
}

function logReq(req, note = '') {
  const safeHeaders = {
    host: req.headers.host,
    origin: req.headers.origin,
    referer: req.headers.referer,
    'x-forwarded-for': req.headers['x-forwarded-for'],
    'user-agent': req.headers['user-agent'],
  };
  console.log('[docs/unified/generate]', note, {
    method: req.method,
    headers: safeHeaders,
    time: new Date().toISOString(),
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', c => (b += c));
    req.on('end', () => {
      try { resolve(b ? JSON.parse(b) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function hmac(params) {
  const qs = new URLSearchParams(params).toString();
  return crypto.createHmac('sha256', SIGN).update(qs).digest('hex');
}

async function findRecIdByIdSpedizione(idSped) {
  // Cerca il record con {ID Spedizione} = '...'
  const formula = `({ID Spedizione} = '${String(idSped).replace(/'/g, "\\'")}')`;
  const qs = new URLSearchParams({ filterByFormula: formula, maxRecords: '1' });
  const url = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TB)}?${qs}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${PAT}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Airtable ${r.status}: ${JSON.stringify(j)}`);
  const rec = Array.isArray(j.records) && j.records[0];
  return rec?.id || null;
}

function typeKey(t) {
  const s = String(t || '').trim().toLowerCase();
  if (s === 'invoice' || s === 'fattura') return 'fattura';
  if (s === 'proforma' || s === 'pf') return 'proforma';
  if (s === 'dle' || s.includes('dichiarazione')) return 'dle';
  if (s === 'pl' || s.includes('packing')) return 'pl';
  return 'proforma';
}

function candidatesFor(type) {
  const byEnv = {
    proforma: process.env.DOCS_FIELD_PROFORMA,
    fattura:  process.env.DOCS_FIELD_FATTURA,
    dle:      process.env.DOCS_FIELD_DLE,
    pl:       process.env.DOCS_FIELD_PL,
  };
  const defEnv = process.env.DOCS_FIELD_DEFAULT;

  // Alias comuni in base al README / mapping storico
  const fallbacks = {
    proforma: ['Allegato Proforma', 'Fattura Proforma', 'Proforma', 'Allegato 1', 'Allegato_1', 'Doc_Unified_URL'],
    fattura:  ['Allegato Fattura', 'Fattura - Allegato Cliente', 'Allegato 2', 'Allegato_2', 'Doc_Unified_URL'],
    dle:      ['Allegato DLE', 'Dichiarazione Esportazione', 'Allegato 3', 'Allegato_3', 'Doc_Unified_URL'],
    pl:       ['Allegato PL', 'Packing List', 'Packing List - Allegato Cliente', 'Doc_Unified_URL'],
  };

  const arr = [
    byEnv[type],        // override per tipo
    defEnv,             // override generico
    ...fallbacks[type], // alias noti
  ].filter(Boolean);

  // de-dup conservando l’ordine
  return Array.from(new Set(arr));
}

async function patchAttachment(recId, field, url, filename) {
  const endpoint = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TB)}/${encodeURIComponent(recId)}`;
  const body = JSON.stringify({ fields: { [field]: [{ url, filename }] } });
  const r = await fetch(endpoint, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body,
  });
  const text = await r.text();
  if (!r.ok) {
    const short = text.length > 400 ? text.slice(0, 400) + '…' : text;
    return { ok: false, status: r.status, text: short };
  }
  return { ok: true };
}

export default async function handler(req, res) {
  logReq(req, 'IN');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  if (!BASE || !PAT || !SIGN) {
    return res.status(500).json({
      ok: false,
      error: 'Missing env: AIRTABLE_BASE_ID, AIRTABLE_PAT, DOCS_SIGNING_SECRET are required',
    });
  }

  const auth = checkAuth(req);
  if (!auth.ok) {
    logReq(req, '401 Unauthorized');
    return res.status(401).json({
      ok: false,
      error: 'Unauthorized',
      hint: 'Add X-Admin-Key header or open from a URL in DOCS_UI_REFERERS.',
    });
  }

  try {
    const body = await readJson(req).catch(() => ({}));
    let { shipmentId, idSpedizione, type = 'proforma' } = body || {};

    // Accetta anche shipmentId=ID Spedizione (se non è recXXXX)
    const looksRec = typeof shipmentId === 'string' && shipmentId.startsWith('rec');
    if (!looksRec && !idSpedizione && shipmentId) {
      idSpedizione = shipmentId;
      shipmentId = undefined;
    }

    if (!shipmentId && !idSpedizione) {
      return res.status(400).json({ ok: false, error: 'Provide shipmentId (recXXXX) or idSpedizione' });
    }

    // Risolvi recId
    let recId = shipmentId;
    if (!recId) {
      recId = await findRecIdByIdSpedizione(idSpedizione);
      if (!recId) {
        return res.status(422).json({
          ok: false,
          error: 'Airtable 422: il recordId è obbligatorio. Ho cercato tramite "ID Spedizione" ma non riesco a patchare.',
          hint: 'Controlla che il campo "ID Spedizione" corrisponda esattamente; in alternativa passa shipmentId=recXXXX nel body.',
        });
      }
    }

    const kind = typeKey(type);

    // Firma URL di render
    const exp = String(Math.floor(Date.now() / 1000) + 60 * 10);
    const params = { sid: recId, type: kind, exp };
    const sig = hmac(params);

    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const renderUrl = `${proto}://${host}/api/docs/unified/render?${new URLSearchParams({ ...params, sig })}`;
    const filename = `${kind.toUpperCase()}-${recId}.pdf`;

    // Scegli campo e patcha con tentativi multipli
    const tried = [];
    const candidates = candidatesFor(kind);
    let lastErr = null;

    for (const field of candidates) {
      const out = await patchAttachment(recId, field, renderUrl, filename);
      if (out.ok) {
        console.log('[docs/generate] OK', { field, url: renderUrl, recId, type: kind });
        return res.status(200).json({ ok: true, url: renderUrl, field, recId, type: kind, via: auth.how });
      }
      tried.push({ field, status: out.status, error: out.text });
      lastErr = out;
      // Se è UNKNOWN_FIELD_NAME o INVALID_CELL_VALUE continua; in altri casi puoi anche continuare comunque
    }

    // Tutti falliti
    console.warn('[docs/generate] tutti i tentativi falliti', { recId, type: kind, tried });
    return res.status(422).json({
      ok: false,
      error: lastErr ? `Airtable ${lastErr.status}: ${lastErr.text}` : 'Airtable 422',
      tried,
      hint: 'Verifica i nomi dei campi allegato o imposta DOCS_FIELD_* negli env.',
    });
  } catch (e) {
    console.error('[docs/generate] error', e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
