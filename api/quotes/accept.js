// api/quotes/accept.js

const allowlist = (process.env.ORIGIN_ALLOWLIST || '')
  .split(',').map(s => s.trim()).filter(Boolean);

function isAllowed(origin) {
  if (!origin) return false;
  for (const item of allowlist) {
    if (item.includes('*')) {
      const esc = item.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace('\\*','.*');
      if (new RegExp('^'+esc+'$').test(origin)) return true;
    } else if (item === origin) return true;
  }
  return false;
}
function setCors(res, origin){
  if (isAllowed(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');
  res.setHeader('Access-Control-Allow-Credentials','true');
}

const AT_BASE = process.env.AIRTABLE_BASE_ID;
const AT_PAT  = process.env.AIRTABLE_PAT;
const TB_QUOTE= process.env.TB_PREVENTIVI;

async function atList(table, params){
  const qs = new URLSearchParams(params).toString();
  const url = `https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(table)}?${qs}`;
  const resp = await fetch(url, { headers:{ Authorization:`Bearer ${AT_PAT}` }});
  const json = await resp.json();
  if (!resp.ok) throw new Error(json?.error?.message || JSON.stringify(json));
  return json;
}
async function atUpdate(table, records){
  const url = `https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(table)}`;
  const resp = await fetch(url, {
    method:'PATCH',
    headers:{ Authorization:`Bearer ${AT_PAT}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ records })
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error(json?.error?.message || JSON.stringify(json));
  return json;
}

export default async function handler(req, res){
  setCors(res, req.headers.origin);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ok:false,error:'Method Not Allowed'});

  try{
    if (!AT_BASE || !AT_PAT || !TB_QUOTE) throw new Error('Missing env vars');

    const body = typeof req.body === 'object' ? req.body : JSON.parse(req.body||'{}');
    const { slug, optionIndex } = body || {};
    if (!slug || !optionIndex) return res.status(400).json({ ok:false, error:'Missing slug/optionIndex' });

    // 1) trova il preventivo via Slug_Pubblico
    const list = await atList(TB_QUOTE, { filterByFormula: `{Slug_Pubblico}='${slug}'`, maxRecords: 1 });
    const rec = list.records?.[0];
    if (!rec) return res.status(404).json({ ok:false, error:'Quote not found' });

    // 2) (facoltativo) verifica scadenza / stato
    const stato = rec.fields?.Stato;
    const scad  = rec.fields?.Scadenza_Link;
    if (stato === 'Annullato') return res.status(409).json({ ok:false, error:'Quote cancelled' });
    if (scad && new Date(scad) < new Date()) return res.status(409).json({ ok:false, error:'Quote expired' });

    // 3) aggiorna come "Accettato"
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket?.remoteAddress || '';
    const ua = req.headers['user-agent'] || '';

    await atUpdate(TB_QUOTE, [{
      id: rec.id,
      fields: {
        Stato: 'Accettato',
        Opzione_Accettata: Number(optionIndex),
        Accettato_Il: new Date().toISOString(),
        Accettato_IP: ip,
        Accettato_UA: ua,
      }
    }]);

    return res.status(200).json({ ok:true });
  }catch(err){
    console.error('[quotes/accept] err:', err);
    return res.status(500).json({ ok:false, error: String(err.message||err) });
  }
}
