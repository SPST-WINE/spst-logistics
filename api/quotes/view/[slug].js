// pages/api/quotes/[slug].js  (Next API route)

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

// ---------- Airtable helpers ----------
const AT_BASE  = process.env.AIRTABLE_BASE_ID;
const AT_PAT   = process.env.AIRTABLE_PAT;
const TB_QUOTE = process.env.TB_PREVENTIVI;   // es. "Preventivi"
const TB_OPT   = process.env.TB_OPZIONI;      // es. "OpzioniPreventivo"
const TB_COLLI = process.env.TB_COLLI;        // es. "Colli"

async function atList(table, params={}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (k === 'sort' && Array.isArray(v)) {
      v.forEach((s, i) => {
        if (!s) return;
        qs.append(`sort[${i}][field]`, s.field);
        qs.append(`sort[${i}][direction]`, s.direction || 'asc');
      });
    } else if (v !== undefined && v !== null) {
      qs.append(k, String(v));
    }
  }
  const url = `https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(table)}?${qs}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${AT_PAT}` } });
  const json = await resp.json();
  if (!resp.ok) {
    const msg = json?.error?.message || `Airtable ${resp.status}`;
    const err = new Error(msg);
    err.status = resp.status;
    err.payload = json;
    throw err;
  }
  return json;
}

const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money = (n, curr='EUR') => (typeof n === 'number'
  ? new Intl.NumberFormat('it-IT',{style:'currency',currency:curr}).format(n)
  : '—');
const fmtDate = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(+d) ? '—' : d.toISOString().slice(0,10);
};
const toNumber = x => {
  const n = Number(x);
  return Number.isFinite(n) ? n : undefined;
};
function getBestIndex(options){
  const chosen = options.find(o => !!o.recommended);
  if (chosen) return toNumber(chosen.index);
  const priced = options.filter(o => typeof o.price === 'number');
  if (!priced.length) return undefined;
  priced.sort((a,b)=>a.price-b.price);
  return toNumber(priced[0].index);
}

// ---------- HTML builder (stessa resa dell’anteprima locale) ----------
function buildPreviewHtml(model){
  const customerEmail = model.customerEmail || '';
  const currency      = model.currency || 'EUR';
  const validUntil    = model.validUntil || '';
  const notes         = model.notes || '';
  const shipmentNotes = model.shipmentNotes || '';
  const sender        = model.sender || {};
  const recipient     = model.recipient || {};
  const options       = Array.isArray(model.options) ? model.options : [];
  const packages      = Array.isArray(model.packages) ? model.packages : [];

  const best = getBestIndex(options) ?? (options[0]?.index);

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

  const pkgPieces = packages.reduce((s,p)=> s + (Number(p.qty)||0), 0);
  const pkgWeight = packages.reduce((s,p)=> s + (Number(p.kg ?? p.weight ?? 0) * (Number(p.qty)||1)), 0);

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
    '<div class="small" style="margin-bottom:8px">Totale colli: <strong>', String(pkgPieces) ,'</strong> · Peso reale totale: <strong>', pkgWeight.toFixed(2) ,' kg</strong></div>',
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

    // 1) record Preventivo
    const qResp = await atList(TB_QUOTE, {
      maxRecords: 1,
      filterByFormula: `LOWER({Slug_Pubblico}) = "${slug.toLowerCase()}"`
    });
    const quote = qResp.records?.[0];
    if (!quote) return res.status(404).send('Preventivo non trovato');

    const qf = quote.fields;

    // 2) figli: Opzioni + Colli (filtrati per link {Preventivo})
    const [optResp, pkgResp] = await Promise.all([
      atList(TB_OPT, {
        filterByFormula: `FIND("${quote.id}", ARRAYJOIN({Preventivo}))`,
        sort: [{ field: 'Indice', direction: 'asc' }]
      }),
      atList(TB_COLLI, {
        filterByFormula: `FIND("${quote.id}", ARRAYJOIN({Preventivo}))`,
        // ordina per Created time se non hai un campo Ordine
      }),
    ]);

    const options = (optResp.records || []).map(r => {
      const f = r.fields || {};
      return {
        index       : toNumber(f.Indice),
        carrier     : f.Corriere || '',
        service     : f.Servizio || '',
        transit     : f.Tempo_Resa || '',
        incoterm    : f.Incoterm || '',
        payer       : f.Oneri_A_Carico || '',
        price       : toNumber(f.Prezzo),
        currency    : f.Valuta || qf.Valuta || 'EUR',
        notes       : f.Note_Operative || '',
        recommended : !!f.Consigliata,
      };
    });

    const packages = (pkgResp.records || []).map(r => {
      const f = r.fields || {};
      return {
        qty : toNumber(f.Quantita) || 1,
        l   : toNumber(f.L_cm ?? f.L),
        w   : toNumber(f.W_cm ?? f.W),
        h   : toNumber(f.H_cm ?? f.H),
        kg  : toNumber(f.Peso ?? f.Peso_Kg) || 0,
      };
    });

    const model = {
      id           : quote.id,
      slug,
      customerEmail: qf.Email_Cliente || '',
      currency     : qf.Valuta || 'EUR',
      validUntil   : qf.Valido_Fino_Al || null,
      notes        : qf.Note_Globali || '',
      shipmentNotes: qf.Note_Spedizione || qf.Note_Generiche || '',
      sender       : {
        name   : qf.Mittente_Nome || '',
        country: qf.Mittente_Paese || '',
        city   : qf.Mittente_Citta || '',
        zip    : qf.Mittente_CAP || '',
        address: qf.Mittente_Indirizzo || '',
        phone  : qf.Mittente_Telefono || '',
        tax    : qf.Mittente_Tax || '',
      },
      recipient    : {
        name   : qf.Destinatario_Nome || '',
        country: qf.Destinatario_Paese || '',
        city   : qf.Destinatario_Citta || '',
        zip    : qf.Destinatario_CAP || '',
        address: qf.Destinatario_Indirizzo || '',
        phone  : qf.Destinatario_Telefono || '',
        tax    : qf.Destinatario_Tax || '',
      },
      options,
      packages,
    };

    // debug: ?json=1 per vedere il payload
    if ('json' in req.query) return res.status(200).json({ ok:true, quote:model });

    const html = buildPreviewHtml(model);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);

  } catch (err) {
    const status = err.status || 500;
    console.error('[quote public] error:', err.payload || err);
    return res.status(status).send('Errore nel recupero del preventivo.');
  }
}
