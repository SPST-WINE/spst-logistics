// api/quotes/[slug].js
// Restituisce: preventivo + opzioni + pacchi (da Colli_JSON) pronti per il render pubblico.

const DEFAULT_ALLOW = [
  'https://spst.it',
  'https://www.spst.it',
  'https://spst-logistics.vercel.app',
  'http://localhost:3000',
  'http://localhost:8888',
];
const allowlist = (process.env.ORIGIN_ALLOWLIST || DEFAULT_ALLOW.join(','))
  .split(',').map(s => s.trim()).filter(Boolean);

function isAllowed(origin) {
  if (!origin) return false;
  for (const item of allowlist) {
    if (item.includes('*')) {
      const esc = item.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace('\\*', '.*');
      if (new RegExp('^' + esc + '$').test(origin)) return true;
    } else if (item === origin) return true;
  }
  return false;
}
function setCors(res, origin) {
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (isAllowed(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
}

// Airtable
const AT_BASE   = process.env.AIRTABLE_BASE_ID;
const AT_PAT    = process.env.AIRTABLE_PAT;
const TB_QUOTE  = process.env.TB_PREVENTIVI;      // Preventivi
const TB_OPT    = process.env.TB_OPZIONI;         // OpzioniPreventivo

async function atList(table, params = {}) {
  const url = new URL(`https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(table)}`);
  Object.entries(params).forEach(([k,v]) => {
    if (v == null) return;
    if (k === 'sort' && Array.isArray(v)) {
      v.forEach((s, i) => {
        if (!s?.field) return;
        url.searchParams.set(`sort[${i}][field]`, s.field);
        url.searchParams.set(`sort[${i}][direction]`, s.direction || 'asc');
      });
    } else {
      url.searchParams.set(k, v);
    }
  });
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${AT_PAT}` }});
  const json = await resp.json();
  if (!resp.ok) {
    const err = new Error(json?.error?.message || 'Airtable error');
    err.status = resp.status;
    err.payload = json;
    throw err;
  }
  return json.records || [];
}

function parseJSON(s){ try { return JSON.parse(s || '[]'); } catch { return []; } }
function money(n, curr='EUR'){
  if (typeof n !== 'number') return null;
  try { return new Intl.NumberFormat('it-IT',{style:'currency',currency:curr}).format(n); }
  catch { return `${n.toFixed(2)} ${curr}`; }
}
function sanitizeSlug(slug=''){ return String(slug).replace(/[^a-z0-9-_]/gi,''); }

export default async function handler(req, res) {
  setCors(res, req.headers.origin);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')     return res.status(405).json({ ok:false, error:'Method Not Allowed' });

  try {
    if (!AT_BASE || !AT_PAT || !TB_QUOTE || !TB_OPT) {
      throw new Error('Missing env vars: AIRTABLE_BASE_ID / AIRTABLE_PAT / TB_PREVENTIVI / TB_OPZIONI');
    }

    const slug = sanitizeSlug(req.query.slug || req.query.id || '');
    if (!slug) return res.status(400).json({ ok:false, error:'Missing slug' });

    // 1) Recupero preventivo per slug, visibile e non scaduto
    const filter = [
      `{Slug_Pubblico}='${slug}'`,
      `OR({Visibilita}='Immediata', {Visibilita}='Pubblica')`,
      `OR({Scadenza_Link}='', IS_AFTER({Scadenza_Link}, NOW()))`,
    ].join(','); // AND([...]) sotto

    const recs = await atList(TB_QUOTE, {
      maxRecords: 1,
      filterByFormula: `AND(${filter})`,
    });
    const rec = recs[0];
    if (!rec) return res.status(404).json({ ok:false, error:'Not found' });

    const f = rec.fields || {};
    const id = rec.id;

    // Mappa campi (incluse P.IVA / TAX ID)
    const quote = {
      id,
      slug: f.Slug_Pubblico || slug,
      customerEmail: f.Email_Cliente || '',
      currency: f.Valuta || 'EUR',
      validUntil: f.Valido_Fino_Al || null,
      notes: f.Note_Globali || '',

      sender: {
        name   : f.Mittente_Nome || '',
        country: f.Mittente_Paese || '',
        city   : f.Mittente_Citta || '',
        zip    : f.Mittente_CAP || '',
        address: f.Mittente_Indirizzo || '',
        phone  : f.Mittente_Telefono || '',
        tax    : f.Mittente_Tax || '',         // <<< QUI
      },
      recipient: {
        name   : f.Destinatario_Nome || '',
        country: f.Destinatario_Paese || '',
        city   : f.Destinatario_Citta || '',
        zip    : f.Destinatario_CAP || '',
        address: f.Destinatario_Indirizzo || '',
        phone  : f.Destinatario_Telefono || '',
        tax    : f.Destinatario_Tax || '',     // <<< E QUI
      },

      packages: parseJSON(f.Colli_JSON),
    };

    // 2) Recupero opzioni collegate
    // filterByFormula per link: FIND(quoteId, ARRAYJOIN({Preventivo}))
    const optsRecs = await atList(TB_OPT, {
      filterByFormula: `FIND('${id}', ARRAYJOIN({Preventivo}))`,
      sort: [{ field: 'Indice', direction: 'asc' }],
    });

    const options = optsRecs.map(r => {
      const x = r.fields || {};
      return {
        index      : Number(x.Indice ?? 0) || 0,
        carrier    : x.Corriere || '',
        service    : x.Servizio || '',
        transit    : x.Tempo_Resa || '',
        incoterm   : x.Incoterm || '',
        payer      : x.Oneri_A_Carico || '',
        price      : Number(x.Prezzo ?? NaN),
        currency   : x.Valuta || quote.currency || 'EUR',
        notes      : x.Note_Operative || '',
        recommended: !!x.Consigliata,
      };
    });

    // 3) Totali colli
    const pieces = quote.packages.reduce((s,p)=> s + (Number(p.qty)||0), 0);
    const weightKg = quote.packages.reduce((s,p)=> {
      const kg = Number(p.kg ?? p.weight ?? 0);
      const q  = Number(p.qty) || 0;
      return s + (Number.isFinite(kg)?kg:0) * (q || 0 || 1);
    }, 0);

    return res.status(200).json({
      ok: true,
      quote,
      options,
      totals: { pieces, weightKg, weightFmt: money(weightKg, quote.currency) },
    });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ ok:false, error: err.payload || { name: err.name, message: err.message } });
  }
}
