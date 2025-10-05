// api/docs/unified/generate.js
// COMPLETO — Fix passaggio corriere alla DLE generica (DHL/GLS/TNT/BRT)
// - FedEx/UPS ➜ /api/docs/unified/dle_html (template dedicato)
// - Tutti gli altri ➜ /api/docs/unified/render (DLE generica) con ?carrier=<selezione>

import crypto from 'node:crypto';
export const config = { runtime: 'nodejs' };

const SECRET = process.env.DOCS_SIGN_SECRET || '';

function makeSig(sid, type, exp) {
  return crypto.createHmac('sha256', SECRET).update(`${sid}.${type}.${exp}`).digest('hex');
}

function canonical(params) {
  const keys = ['sid', 'type', 'exp', 'ship'];
  return keys
    .filter(k => params[k] !== undefined && params[k] !== null)
    .map(k => `${k}=${encodeURIComponent(String(params[k]))}`)
    .join('&');
}

function shouldUseHtmlDLE({ type, dleTpl, carrier }) {
  const t   = String(type || '').toLowerCase();
  const sel = String(dleTpl || carrier || '').toLowerCase();
  if (t.includes('dle:ups') || sel === 'ups') return true;
  if (t.includes('dle:fedex') || sel === 'fedex' || sel === 'fx') return true;
  return false;
}

// Usa qualsiasi campo arrivi dalla UI per determinare il corriere scelto
function pickCarrierForDLE(body) {
  const rawCarrier = (body.carrier || body.courier || body.dleCarrier || '').toString().trim();
  const rawTpl     = (body.dleTpl || body.dle_template || body.template || body.dleTemplate || '').toString().trim();
  // Se è stato scelto un template (DHL/GLS/TNT/BRT/UPS/FedEx), preferisci quello quando manca "carrier"
  let chosen = rawCarrier || rawTpl;
  // Normalizza alcune varianti
  if (/^fx$/i.test(chosen)) chosen = 'FedEx';
  if (/^brt$/i.test(chosen)) chosen = 'BRT';
  if (/^gls$/i.test(chosen)) chosen = 'GLS';
  if (/^dhl$/i.test(chosen)) chosen = 'DHL';
  if (/^tnt$/i.test(chosen)) chosen = 'TNT';
  if (/^ups$/i.test(chosen)) chosen = 'UPS';
  // Valori “neutri” della UI che non devono sovrascrivere Airtable
  if (/^(usa|use).*(valore|value)|generico|altro|other$/i.test(chosen)) return '';
  return chosen;
}

export default async function handler(req, res) {
  const now = new Date().toISOString();
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ ok:false, error:'Method Not Allowed' });
    }
    if (!SECRET) return res.status(500).json({ ok:false, error:'Missing DOCS_SIGN_SECRET' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const idSpedizione = (body.idSpedizione || body.shipmentId || '').trim();
    const type   = (body.type || 'proforma').trim(); // 'proforma' | 'commercial' | 'dle' | 'dle:ups' | 'dle:fedex'
    if (!idSpedizione) return res.status(400).json({ ok:false, error:'idSpedizione is required' });

    // Valori firmati
    const sid  = idSpedizione;
    const ship = idSpedizione;
    const exp  = Math.floor(Date.now()/1000) + 15*60;
    const sig  = makeSig(sid, type, exp);

    // Scelte UI per DLE
    const dleTpl     = (body.dleTpl || body.dle_template || body.template || body.dleTemplate || '').toString().trim();
    const uiCarrier  = pickCarrierForDLE(body); // DHL/GLS/TNT/BRT/UPS/FedEx/''

    const proto = (req.headers['x-forwarded-proto'] || 'https');
    const host  = req.headers['x-forwarded-host'] || req.headers.host;
    const base  = `${proto}://${host}`;

    const isDLE   = String(type).toLowerCase().startsWith('dle');
    const useHtml = isDLE && shouldUseHtmlDLE({ type, dleTpl, carrier: uiCarrier });
    const path    = useHtml ? '/api/docs/unified/dle_html' : '/api/docs/unified/render';

    const payload = { sid, type, exp, ship };
    const extraQS = [];
    // Passiamo SEMPRE il corriere selezionato alla DLE generica (DHL/GLS/TNT/BRT)
    if (uiCarrier) extraQS.push(`carrier=${encodeURIComponent(uiCarrier)}`);
    if (dleTpl)    extraQS.push(`tpl=${encodeURIComponent(dleTpl)}`);

    const qs  = canonical(payload) + `&sig=${sig}` + (extraQS.length ? `&${extraQS.join('&')}` : '');
    const url = `${base}${path}?${qs}`;

    console.log('[generate] OK', { time: now, type, sid, path, uiCarrier, dleTpl });

    const fieldMap = {
      proforma:     'Allegato Fattura',
      fattura:      'Allegato Fattura',
      commercial:   'Allegato Fattura',
      dle:          'Allegato DLE',
      'dle:fedex':  'Allegato DLE',
      'dle:ups':    'Allegato DLE',
    };

    return res.status(200).json({
      ok: true,
      url,
      field: fieldMap[type.toLowerCase()] || 'Allegato Fattura',
      type,
      via: 'referer',
    });
  } catch (err) {
    console.error('[generate] 500', now, err);
    return res.status(500).json({ ok:false, error:'Server error' });
  }
}
