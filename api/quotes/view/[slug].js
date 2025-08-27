// pages/api/quotes/[slug].js

// ---------- CORS ----------
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
  for (const pat of allowlist) {
    if (pat.includes('*')) {
      const esc = pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace('\\*', '.*');
      if (new RegExp('^' + esc + '$').test(origin)) return true;
    } else if (pat === origin) return true;
  }
  return false;
}
function setCors(res, origin) {
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (isAllowed(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
}

// ---------- Airtable ----------
const AT_BASE  = process.env.AIRTABLE_BASE_ID;
const AT_PAT   = process.env.AIRTABLE_PAT;
const TB_QUOTE = process.env.TB_PREVENTIVI;
const TB_OPT   = process.env.TB_OPZIONI;
const TB_COLLI = process.env.TB_COLLI;

async function atFetch(url) {
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${AT_PAT}` } });
  const json = await resp.json();
  if (!resp.ok) {
    const err = new Error(json?.error?.message || `Airtable ${resp.status}`);
    err.status = resp.status; err.payload = json;
    throw err;
  }
  return json;
}
async function atList(table, params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (k === 'sort' && Array.isArray(v)) {
      v.forEach((s, i) => {
        if (!s) return;
        qs.append(`sort[${i}][field]`, s.field);
        qs.append(`sort[${i}][direction]`, s.direction || 'asc');
      });
    } else {
      qs.append(k, String(v));
    }
  }
  const base = `https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(table)}`;
  let url = `${base}?${qs}`;
  let records = [], guard = 0;
  while (true) {
    const data = await atFetch(url);
    records = records.concat(data.records || []);
    if (!data.offset || ++guard > 10) break;
    const next = new URL(base);
    for (const [k, v] of qs) next.searchParams.append(k, v);
    next.searchParams.append('offset', data.offset);
    url = next.toString();
  }
  return { records };
}

// ---------- utils + HTML ----------
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money = (n, curr='EUR') => (typeof n === 'number'
  ? new Intl.NumberFormat('it-IT',{style:'currency',currency:curr}).format(n)
  : '—');
const fmtDate = v => { if (!v) return '—'; const d = new Date(v); return Number.isNaN(+d) ? '—' : d.toISOString().slice(0,10); };
const toNumber = x => { const n = Number(x); return Number.isFinite(n) ? n : undefined; };
function getBestIndex(opts){
  const chosen = opts.find(o => !!o.recommended);
  if (chosen) return toNumber(chosen.index);
  const priced = opts.filter(o => typeof o.price === 'number');
  if (!priced.length) return undefined;
  priced.sort((a,b)=>a.price-b.price);
  return toNumber(priced[0].index);
}

function buildHtml(model){
  const { customerEmail, currency='EUR', validUntil, notes='', shipmentNotes='',
          sender={}, recipient={}, options=[], packages=[] } = model;

  const best = getBestIndex(options) ?? options[0]?.index;

  const optRows = options.map(o =>
    '<div class="opt ' + (o.index===best?'is-best':'') + '">'
    + '<div class="opt-head"><div class="badge">OPZIONE ' + escapeHtml(String(o.index??'')) + '</div>'
      + (o.index===best ? '<span class="pill">Consigliata</span>' : '') + '</div>'
    + '<div class="grid">'
      + '<div><div class="k">Corriere</div><div class="v">'+escapeHtml(o.carrier||'—')+'</div></div>'
      + '<div><div class="k">Servizio</div><div class="v">'+escapeHtml(o.service||'—')+'</div></div>'
      + '<div><div class="k">Tempo di resa previsto</div><div class="v">'+escapeHtml(o.transit||'—')+'</div></div>'
      + '<div><div class="k">Incoterm</div><div class="v">'+escapeHtml(o.incoterm||'—')+'</div></div>'
      + '<div><div class="k">Oneri a carico di</div><div class="v">'+escapeHtml(o.payer||'—')+'</div></div>'
      + '<div><div class="k">Prezzo</div><div class="v">'+money(o.price, o.currency||currency)+'</div></div>'
    + '</div>'
    + (o.notes ? '<div class="notes"><strong>Note operative:</strong> '+escapeHtml(o.notes)+'</div>' : '')
    + '</div>'
  ).join('');

  const pieces = packages.reduce((s,p)=> s + (Number(p.qty)||0), 0);
  const weight = packages.reduce((s,p)=> s + (Number(p.kg ?? p.weight ?? 0) * (Number(p.qty)||1)), 0);

  let pkgTable = '';
  if (packages.length){
    const rows = packages.map(p => {
      const qty = Number(p.qty)||1;
      const l   = Number(p.l ?? p.length ?? 0);
      const w   = Number(p.w ?? p.width  ?? 0);
      const h   = Number(p.h ?? p.height ?? 0);
      const kg  = Number(p.kg ?? p.weight ?? 0);
      const dims = [l,w,h].map(n => (Number.isFinite(n)?n:0).toFixed(1)).join(' × ');
      return '<tr>'
        + '<td style="padding:6px 8px">' + qty + '</td>'
        + '<td style="padding:6px 8px">' + dims + '</td>'
        + '<td style="padding:6px 8px">' + (Number.isFinite(kg)?kg:0).toFixed(2) + '</td>'
      + '</tr>';
    }).join('');
    pkgTable =
      '<div style="overflow:auto"><table style="width:100%;border-collapse:collapse">'
      + '<thead><tr>'
      +   '<th class="k" style="text-align:left;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.1)">Quantità</th>'
      +   '<th class="k" style="text-align:left;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.1)">L × W × H (cm)</th>'
      +   '<th class="k" style="text-align:left;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.1)">Peso (kg)</th>'
      + '</tr></thead><tbody>'+rows+'</tbody></table></div>';
  }

  const parts = [];
  parts.push(
    '<!doctype html><html lang="it"><head>',
    '<meta charset="utf-8"/>',
    '<meta name="viewport" content="width=device-width,initial-scale=1"/>',
    '<title>Preventivo SPST</title>',
    '<style>',
      ':root{--bg:#0b1224;--card:#0e162b;--text:#e7ecf5;--muted:#9aa3b7;--brand:#f7911e;--accent:#6ea8ff}',
      '*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 Inter,system-ui,Segoe UI,Roboto,Helvetica,Arial}',
      '.wrap{max-width:960px;margin:24px auto;padding:0 16px}',
      '.header{display:flex;justify-content:space-between;align-items:center;margin:8px 0 16px}',
      '.brand{display:flex;align-items:center;gap:10px}.logo{width:26px;height:26px}',
      'h1{margin:0;font-size:22px}',
      '.card{background:var(--card);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:14px;margin:12px 0}',
      '.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}',
      '.k{font-size:12px;color:var(--muted)}.v{font-weight:600}',
      '.badge{display:inline-block;padding:3px 8px;border-radius:999px;border:1px solid var(--brand);color:var(--brand);background:rgba(247,145,30,.12);font-size:10px}',
      '.pill{display:inline-block;padding:4px 9px;border-radius:999px;background:rgba(110,168,255,.15);border:1px solid rgba(110,168,255,.4);font-size:11px}',
      '.opt{border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:12px;margin:10px 0;background:#0d152a}',
      '.opt.is-best{box-shadow:inset 0 0 0 1px rgba(110,168,255,.45), 0 6px 16px rgba(0,0,0,.25)}',
      '.opt-head{display:flex;gap:8px;align-items:center;margin-bottom:8px}',
      '.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}',
      '.notes{margin-top:8px;color:var(--muted)}.small{font-size:12px;color:var(--muted)}',
      '@media (max-width:900px){.grid{grid-template-columns:1fr 1fr}.grid2{grid-template-columns:1fr}}',
      'table{border-collapse:collapse;width:100%}th,td{padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.1);text-align:left}',
    '</style></head><body><div class="wrap">'
  );

  parts.push(
    '<div class="header"><div class="brand">',
      '<img class="logo" src="https://cdn.prod.website-files.com/6800cc3b5f399f3e2b7f2ffa/68079e968300482f70a36a4a_output-onlinepngtools%20(1).png" alt="SPST logo" />',
      '<h1>Preventivo SPST</h1>',
    '</div>',
    '<div class="small">Valido fino al <strong>', escapeHtml(fmtDate(validUntil)) ,'</strong></div>',
    '</div>'
  );

  parts.push(
    '<div class="card"><div class="grid2">',
      '<div><div class="k">Cliente</div><div class="v">', escapeHtml(customerEmail||'—') ,'</div></div>',
      '<div><div class="k">Valuta</div><div class="v">',   escapeHtml(currency||'EUR') ,'</div></div>',
    '</div>',
    (notes ? '<div style="margin-top:10px"><div class="k">Note</div><div class="v">'+escapeHtml(notes)+'</div></div>' : ''),
    '</div>'
  );

  parts.push(
    '<div class="card"><div class="grid2">',
      '<div>',
        '<div class="k">Mittente</div><div class="v">', escapeHtml(sender.name||'—') ,'</div>',
        '<div class="small">', escapeHtml([sender.address,sender.zip,sender.city,sender.country].filter(Boolean).join(', ')) ,'</div>',
        (sender.tax ? '<div class="small">P. IVA / EORI: '+escapeHtml(sender.tax)+'</div>' : ''),
      '</div>',
      '<div>',
        '<div class="k">Destinatario</div><div class="v">', escapeHtml(recipient.name||'—') ,'</div>',
        '<div class="small">', escapeHtml([recipient.address,recipient.zip,recipient.city,recipient.country].filter(Boolean).join(', ')) ,'</div>',
        (recipient.tax ? '<div class="small">Tax ID / EORI: '+escapeHtml(recipient.tax)+'</div>' : ''),
      '</div>',
    '</div></div>'
  );

  if (shipmentNotes) {
    parts.push('<div class="card"><div class="k">Note generiche sulla spedizione</div><div class="v">', escapeHtml(shipmentNotes) ,'</div></div>');
  }

  parts.push(
    '<div class="card"><div class="k" style="margin-bottom:6px">Colli</div>',
    '<div class="small" style="margin-bottom:8px">Totale colli: <strong>', String(pieces) ,'</strong> · Peso reale totale: <strong>', weight.toFixed(2) ,' kg</strong></div>',
    pkgTable || '',
    '</div>'
  );

  parts.push(
    '<div class="card"><div class="k" style="margin-bottom:6px">Opzioni di spedizione</div>',
    (optRows || '<div class="small">Nessuna opzione.</div>'),
    '</div>'
  );

  parts.push(
    '<div class="small" style="margin-top:8px">Anteprima non vincolante. Eventuali costi accessori potrebbero essere applicati dal corriere ed addebitati al cliente. ',
    'Per maggiori informazioni consulta i <a style="color:#9ec1ff" href="https://www.spst.it/termini-di-utilizzo" target="_blank" rel="noopener">Termini di utilizzo</a>.',
    '</div>'
  );

  parts.push('</div></body></html>');
  return parts.join('');
}

// ---------- handler ----------
export default async function handler(req, res) {
  setCors(res, req.headers.origin);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok:false, error:'Method Not Allowed' });

  try {
    if (!AT_BASE || !AT_PAT || !TB_QUOTE || !TB_OPT || !TB_COLLI) {
      throw new Error('Missing env vars: AIRTABLE_BASE_ID / AIRTABLE_PAT / TB_PREVENTIVI / TB_OPZIONI / TB_COLLI');
    }

    const slug = String(req.query.slug || '').trim();
    if (!slug) return res.status(400).json({ ok:false, error:'Missing slug' });

    // 1) Preventivo dal suo slug
    const q = await atList(TB_QUOTE, {
      maxRecords: 1,
      filterByFormula: `LOWER({Slug_Pubblico}) = "${slug.toLowerCase()}"`
    });
    const rec = q.records?.[0];
    if (!rec) return res.status(404).send('Preventivo non trovato');
    const f = rec.fields;

    // 2) Opzioni + Colli: fetch all (pagine) e filtro by linked record IDs
    const [optAll, pkgAll] = await Promise.all([
      atList(TB_OPT,   { sort:[{field:'Indice',direction:'asc'}], pageSize:100 }),
      atList(TB_COLLI, { pageSize:100 }),
    ]);

    const options = (optAll.records || [])
      .filter(r => Array.isArray(r.fields?.Preventivo) && r.fields.Preventivo.includes(rec.id))
      .map(r => {
        const x = r.fields || {};
        return {
          index       : toNumber(x.Indice),
          carrier     : x.Corriere || '',
          service     : x.Servizio || '',
          transit     : x.Tempo_Resa || x['Tempo di resa previsto'] || '',
          incoterm    : x.Incoterm || '',
          payer       : x.Oneri_A_Carico || x['Oneri a carico di'] || '',
          price       : toNumber(x.Prezzo),
          currency    : x.Valuta || f.Valuta || 'EUR',
          notes       : x.Note_Operative || x['Note operative'] || '',
          recommended : !!x.Consigliata,
        };
      });

    const packages = (pkgAll.records || [])
      .filter(r => Array.isArray(r.fields?.Preventivo) && r.fields.Preventivo.includes(rec.id))
      .map(r => {
        const x = r.fields || {};
        return {
          qty : toNumber(x.Quantita) || 1,
          l   : toNumber(x.L_cm ?? x.L),
          w   : toNumber(x.W_cm ?? x.W),
          h   : toNumber(x.H_cm ?? x.H),
          kg  : toNumber(x.Peso ?? x.Peso_Kg) || 0,
        };
      });

    const model = {
      id           : rec.id,
      slug,
      customerEmail: f.Email_Cliente || '',
      currency     : f.Valuta || 'EUR',
      validUntil   : f.Valido_Fino_Al || null,
      notes        : f.Note_Globali || '',
      shipmentNotes: f.Note_Spedizione || f.Note_Generiche || '',
      sender       : {
        name   : f.Mittente_Nome || '',
        country: f.Mittente_Paese || '',
        city   : f.Mittente_Citta || '',
        zip    : f.Mittente_CAP || '',
        address: f.Mittente_Indirizzo || '',
        phone  : f.Mittente_Telefono || '',
        tax    : f.Mittente_Tax || '',
      },
      recipient    : {
        name   : f.Destinatario_Nome || '',
        country: f.Destinatario_Paese || '',
        city   : f.Destinatario_Citta || '',
        zip    : f.Destinatario_CAP || '',
        address: f.Destinatario_Indirizzo || '',
        phone  : f.Destinatario_Telefono || '',
        tax    : f.Destinatario_Tax || '',
      },
      options,
      packages,
    };

    // debug: /quote/[slug]?json=1
    if ('json' in req.query) return res.status(200).json({ ok:true, counts:{options:options.length, packages:packages.length}, model });

    const html = buildHtml(model);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);

  } catch (err) {
    const status = err.status || 500;
    console.error('[quote public] error:', err.payload || err);
    return res.status(status).send('Errore nel recupero del preventivo.');
  }
}
