// api/quotes/send.js

const allowlist = (process.env.ORIGIN_ALLOWLIST || '').split(',').map(s=>s.trim()).filter(Boolean);
function isAllowed(origin){ if(!origin) return false; for(const it of allowlist){ if(it.includes('*')){ const esc=it.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace('\\*','.*'); if(new RegExp('^'+esc+'$').test(origin)) return true; } else if(it===origin) return true; } return false; }
function setCors(res, origin){ if(isAllowed(origin)) res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary','Origin'); res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS'); res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization'); }

const AT_BASE  = process.env.AIRTABLE_BASE_ID;
const AT_PAT   = process.env.AIRTABLE_PAT;
const TB_QUOTE = process.env.TB_PREVENTIVI;
const PUBLIC_VIEW_BASE = process.env.PUBLIC_VIEW_BASE || 'https://www.spst.it/p';

const RESEND_API_KEY = process.env.RESEND_API_KEY;   // https://resend.com/
const FROM_EMAIL     = process.env.MAIL_FROM || 'preventivi@spst.it';

async function atFindQuote({ id, slug }) {
  const baseUrl = `https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(TB_QUOTE)}`;
  let url;
  if (id) {
    url = `${baseUrl}/${encodeURIComponent(id)}`;
  } else {
    const formula = encodeURIComponent(`{Slug_Pubblico}='${slug}'`);
    url = `${baseUrl}?filterByFormula=${formula}&maxRecords=1`;
  }
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${AT_PAT}` } });
  const json = await resp.json();
  if (!resp.ok) throw new Error('Airtable find failed');
  if (id) return json;
  return json.records?.[0];
}

export default async function handler(req,res){
  setCors(res, req.headers.origin);
  if (req.method==='OPTIONS') return res.status(200).end();
  if (req.method!=='POST')    return res.status(405).json({ ok:false, error:'Method Not Allowed' });

  try{
    if(!AT_BASE || !AT_PAT || !TB_QUOTE) throw new Error('Missing Airtable env');
    if(!RESEND_API_KEY || !FROM_EMAIL)   throw new Error('RESEND_API_KEY / MAIL_FROM missing');

    const body = typeof req.body==='object' ? req.body : JSON.parse(req.body||'{}');
    const { id, slug } = body;

    const rec = await atFindQuote({ id, slug });
    const fields = id ? rec.fields : rec?.fields;
    const recordId = id || rec?.id;
    if(!fields) throw new Error('Preventivo non trovato');

    const to = fields.Email_Cliente;
    const publicSlug = fields.Slug_Pubblico;
    const url = `${PUBLIC_VIEW_BASE}/${encodeURIComponent(publicSlug)}`;

    const subject = 'Il tuo preventivo SPST';
    const html = `
      <div style="font:14px/1.5 -apple-system,Segoe UI,Roboto,Arial">
        <p>Ciao,</p>
        <p>qui trovi il <strong>preventivo SPST</strong>:</p>
        <p><a href="${url}" target="_blank" style="display:inline-block;padding:10px 14px;background:#f7911e;color:#1a1300;border-radius:8px;text-decoration:none;font-weight:600">Apri preventivo</a></p>
        <p style="color:#555">Se il pulsante non funziona, copia e incolla questo link nel browser:<br/><span style="color:#111">${url}</span></p>
        <hr style="border:none;border-top:1px solid #eee;margin:16px 0"/>
        <p style="color:#666">Grazie,<br/>Team SPST</p>
      </div>`;

    // Resend
    const r = await fetch('https://api.resend.com/emails', {
      method:'POST',
      headers:{ 'Authorization':`Bearer ${RESEND_API_KEY}`, 'Content-Type':'application/json' },
      body: JSON.stringify({ from: FROM_EMAIL, to, subject, html })
    });
    const j = await r.json();
    if(!r.ok) return res.status(r.status).json({ ok:false, error:j });

    return res.status(200).json({ ok:true, id: recordId, slug: publicSlug, url });
  }catch(err){
    console.error('[quotes/send] error', err);
    return res.status(500).json({ ok:false, error:{ message: err.message }});
  }
}
