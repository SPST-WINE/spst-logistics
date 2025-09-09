// api/notify/transit.js
export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendCORS(req, res);
  sendCORS(req, res);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { recordId, to } = await readJson(req);
    if (!recordId || !to) return res.status(400).json({ error: 'recordId and to are required' });
    if (!isEmail(to))     return res.status(400).json({ error: 'Invalid email' });

    const pat    = process.env.AIRTABLE_PAT;
    const baseId = process.env.AIRTABLE_BASE_ID;
    const table  = process.env.USE_NEW_SHIPMENTS_TABLE
      ? (process.env.TB_SPEDIZIONI_WEBAPP || 'SpedizioniWebApp')
      : (process.env.AIRTABLE_TABLE || 'SPEDIZIONI');
    if (!pat || !baseId || !table) throw new Error('Missing Airtable env');

    // 1) leggi record
    const recUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}/${encodeURIComponent(recordId)}`;
    const r = await fetch(recUrl, { headers: { Authorization: `Bearer ${pat}` } });
    if (r.status === 404) return res.status(404).json({ error: 'Record not found' });
    if (!r.ok)            return res.status(502).json({ error: 'Airtable error', details: await r.text() });

    const rec = await r.json();
    const f   = rec.fields || {};
    const stato = String(f['Stato'] || '').toLowerCase();
    const IN_TRANSIT = (stato === 'in transito');

    if (!IN_TRANSIT) {
      return res.status(409).json({ error: 'Not allowed: shipment is not "In transito"' });
    }

    // 2) prepara contenuti
    const idSped   = f['ID Spedizione'] || rec.id || recordId;
    const corriere = (typeof f['Corriere'] === 'string') ? f['Corriere']
                    : (f['Corriere']?.name || '');
    const tn       = f['Tracking Number'] || '';
    const trackingURL = f['Tracking URL'] || inferTrackingUrl(corriere, tn);
    const cliente  = f['Destinatario - Ragione sociale'] || f['Mittente - Ragione sociale'] || 'Cliente';

    const apiKey = process.env.RESEND_API_KEY;
    const from   = process.env.MAIL_FROM || 'no-reply@spst.it';
    if (!apiKey) return res.status(500).json({ error: 'RESEND_API_KEY missing' });

    // 3) invia con Resend
    const sendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to,
        subject: `SPST • Spedizione in transito — ${idSped}`,
        html: emailHtml({ idSped, cliente, corriere, tn, trackingURL })
      })
    });
    if (!sendRes.ok) {
      return res.status(502).json({ error: 'Resend error', details: await sendRes.text() });
    }

    // 4) (opzionale) scrivi data notifica su campo configurabile
    const notifyField = process.env.AIRTABLE_NOTIFY_FIELD_IN_TRANSITO || ''; // es. "Notifica in transito"
    if (notifyField) {
      const patchUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}/${encodeURIComponent(recordId)}`;
      await fetch(patchUrl, {
        method: 'PATCH',
        headers: { Authorization:`Bearer ${pat}`, 'Content-Type':'application/json' },
        body: JSON.stringify({ fields: { [notifyField]: new Date().toISOString() } })
      }).catch(()=>{});
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[notify/transit] error', e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
}

/* helpers */
function sendCORS(req,res){
  const origin = req.headers.origin || '';
  const list = (process.env.ORIGIN_ALLOWLIST || '*').split(',').map(s=>s.trim()).filter(Boolean);
  const allowed = list.includes('*') || (!origin) || list.some(p => safeWildcardMatch(origin, p));
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
function isEmail(s){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s||'')); }
async function readJson(req){
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = []; for await (const c of req) chunks.push(Buffer.isBuffer(c)? c : Buffer.from(c));
  const txt = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(txt || '{}'); } catch { return {}; }
}

function inferTrackingUrl(corriere, tn){
  const c = (corriere||'').toLowerCase();
  if (!tn) return '';
  if (c.includes('dhl'))   return `https://www.dhl.com/global-en/home/tracking.html?tracking-id=${encodeURIComponent(tn)}`;
  if (c.includes('ups'))   return `https://www.ups.com/track?loc=it_IT&tracknum=${encodeURIComponent(tn)}`;
  if (c.includes('fedex')) return `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(tn)}`;
  if (c.includes('tnt'))   return `https://www.tnt.com/express/it_it/site/shipping-tools/tracking.html?searchType=con&cons=${encodeURIComponent(tn)}`;
  return '';
}

function emailHtml({ idSped, cliente, corriere, tn, trackingURL }){
  const linkLine = trackingURL ? `<p>Link tracking: <a href="${trackingURL}">${trackingURL}</a></p>` : '';
  return `
  <div style="font-family:Inter,system-ui,Arial,sans-serif;line-height:1.45;color:#111">
    <h2 style="margin:0 0 10px">Spedizione in transito — ${idSped}</h2>
    <p>Ciao ${cliente},</p>
    <p>la tua spedizione è stata affidata al corriere ed è <strong>in transito</strong>.</p>
    <p><strong>Corriere:</strong> ${corriere || '—'}<br>
       <strong>Tracking:</strong> ${tn || '—'}</p>
    ${linkLine}
    <p style="margin-top:18px;color:#555">Grazie,<br>Team SPST</p>
  </div>`;
}
