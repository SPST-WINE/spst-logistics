// api/docs/unified/generate.js
// COMPLETO — Routing DLE:
// - Se scegli FedEx o UPS ➜ /api/docs/unified/dle_html (template dedicato)
// - Per tutti gli altri (DHL/GLS/TNT/BRT/Generico) ➜ /api/docs/unified/render (template precedente)

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
  const t = String(type || '').toLowerCase();
  const sel = String(dleTpl || carrier || '').toLowerCase();
  // Trigga l’HTML solo per UPS/FedEx (sia da type che da selezione UI)
  if (t.includes('dle:ups') || sel === 'ups') return true;
  if (t.includes('dle:fedex') || sel === 'fedex' || sel === 'fx') return true;
  return false; // tutto il resto (DHL/GLS/TNT/BRT/Generico) usa il template precedente
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
    const type   = (body.type || 'proforma').trim(); // es.: 'proforma' | 'commercial' | 'dle' | 'dle:ups' | 'dle:fedex'
    const carrier = (body.carrier || body.courier || body.dleCarrier || '').toString().trim();
    const dleTpl  = (body.dleTpl || body.dle_template || body.template || body.dleTemplate || '').toString().trim();

    if (!idSpedizione) return res.status(400).json({ ok:false, error:'idSpedizione is required' });

    const sid = idSpedizione;            // firmato
    const ship = idSpedizione;           // mostrato nei template
    const exp = Math.floor(Date.now()/1000) + 15*60; // 15 minuti validità
    const payload = { sid, type, exp, ship };
    const sig = makeSig(sid, type, exp);

    const proto = (req.headers['x-forwarded-proto'] || 'https');
    const host  = req.headers['x-forwarded-host'] || req.headers.host;
    const base  = `${proto}://${host}`;

    // Routing: solo UPS/FedEx vanno sull’HTML; tutti gli altri restano su /render
    const isDLE = String(type).toLowerCase().startsWith('dle');
    const useHtml = isDLE && shouldUseHtmlDLE({ type, dleTpl, carrier });
    const path = useHtml ? '/api/docs/unified/dle_html' : '/api/docs/unified/render';

    // Query string: passiamo tpl/carrier solo se utile (non necessario per /render ma non fa danni)
    const extra = []
      .concat(carrier ? [`carrier=${encodeURIComponent(carrier)}`] : [])
      .concat(dleTpl ? [`tpl=${encodeURIComponent(dleTpl)}`] : []);
    const qs = canonical(payload) + `&sig=${sig}` + (extra.length ? `&${extra.join('&')}` : '');
    const url = `${base}${path}?${qs}`;

    console.log('[generate] OK', { time: now, type, sid, path, dleTpl, carrier });

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
