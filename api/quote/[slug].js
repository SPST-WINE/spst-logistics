// api/quote/[slug].js
const AT_BASE  = process.env.AIRTABLE_BASE_ID;
const AT_PAT   = process.env.AIRTABLE_PAT;
const TB_QUOTE = process.env.TB_PREVENTIVI;    // es. "Preventivi"
const TB_OPT   = process.env.TB_OPZIONI;       // es. "OpzioniPreventivo"

function esc(s=''){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function money(n, curr='EUR'){ return typeof n==='number' ? new Intl.NumberFormat('it-IT',{style:'currency',currency:curr}).format(n) : '—'; }
function fmtDateISO(s){ try{ return new Date(s).toISOString().slice(0,10);}catch{ return '—'; } }

async function airList(table, params) {
  const usp = new URLSearchParams(params || {});
  const url = `https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(table)}?${usp.toString()}`;
  const r = await fetch(url, { headers:{Authorization:`Bearer ${AT_PAT}`} });
  const j = await r.json();
  if (!r.ok) {
    const e = new Error(j?.error?.message || 'Airtable error');
    e.status = r.status; e.payload = j; throw e;
  }
  return j;
}

async function getQuoteBySlug(slug){
  const formula = `{Slug_Pubblico}='${slug.replace(/'/g,"\\'")}'`;
  const { records=[] } = await airList(TB_QUOTE, { filterByFormula: formula, maxRecords: 1 });
  return records[0] || null;
}

async function getOptionsForQuote(quoteId){
  // Trova Opzioni dove il link "Preventivo" contiene l'ID del record
  const formula = `FIND('${quoteId}', ARRAYJOIN({Preventivo}))`;
  const { records=[] } = await airList(TB_OPT, { filterByFormula: formula, pageSize: 50, sort: [{field:'Indice',direction:'asc'}] });
  return records;
}

function renderHtml(q, opts){
  const f = q.fields || {};
  const currency = f.Valuta || 'EUR';
  const validTo  = f.Valido_Fino_Al ? fmtDateISO(f.Valido_Fino_Al) : '—';

  const rows = opts.map((o, i) => {
    const x = o.fields || {};
    const isBest = !!x.Consigliata;
    return `
      <div class="opt ${isBest?'is-best':''}">
        <div class="opt-head">
          <div class="badge">OPZIONE ${i+1}</div>
          ${isBest ? '<span class="pill">Consigliata</span>' : ''}
        </div>
        <div class="grid">
          <div><div class="k">Corriere</div><div class="v">${esc(x.Corriere||'—')}</div></div>
          <div><div class="k">Servizio</div><div class="v">${esc(x.Servizio||'—')}</div></div>
          <div><div class="k">Tempo di resa</div><div class="v">${esc(x.Tempo_Resa||'—')}</div></div>
          <div><div class="k">Incoterm</div><div class="v">${esc(x.Incoterm||'—')}</div></div>
          <div><div class="k">Oneri a carico</div><div class="v">${esc(x.Oneri_A_Carico||'—')}</div></div>
          <div><div class="k">Prezzo</div><div class="v">${money(Number(x.Prezzo), x.Valuta || currency)}</div></div>
          <div><div class="k">Peso reale</div><div class="v">${typeof x.Peso_Kg==='number' ? x.Peso_Kg.toFixed(2)+' kg' : '—'}</div></div>
        </div>
        ${x.Note_Operative ? `<div class="notes"><div class="k">Note Aggiuntive</div>${esc(x.Note_Operative)}</div>` : ''}
      </div>
    `;
  }).join('');

  const noteGlob = f.Note_Globali ? `
    <div style="margin-top:10px">
      <div class="k">Note</div><div class="v">${esc(f.Note_Globali)}</div>
    </div>` : '';

  return `<!doctype html>
<html lang="it"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Preventivo SPST</title>
<style>
:root{--bg:#0b1224;--card:#0e162b;--text:#e7ecf5;--muted:#9aa3b7;--brand:#f7911e;--accent:#6ea8ff}
*{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 Inter,system-ui,Segoe UI,Roboto,Helvetica,Arial}
.wrap{max-width:960px;margin:24px auto;padding:0 16px}
.header{display:flex;justify-content:space-between;align-items:center;margin:8px 0 16px}
.brand{display:flex;align-items:center;gap:10px}
.brand .logo{width:28px;height:28px}
h1{margin:0;font-size:22px}
.card{background:var(--card);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:14px;margin:12px 0}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.k{font-size:12px;color:var(--muted)} .v{font-weight:600}
.badge{display:inline-block;padding:3px 8px;border-radius:999px;border:1px solid var(--brand);color:var(--brand);background:rgba(247,145,30,.12);font-size:10px}
.pill{display:inline-block;padding:4px 9px;border-radius:999px;background:rgba(110,168,255,.15);border:1px solid rgba(110,168,255,.4);font-size:11px}
.opt{border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:12px;margin:10px 0;background:#0d152a}
.opt.is-best{box-shadow:inset 0 0 0 1px rgba(110,168,255,.45), 0 6px 16px rgba(0,0,0,.25)}
.opt-head{display:flex;gap:8px;align-items:center;margin-bottom:8px}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.notes{margin-top:8px;color:var(--muted)}
.small{font-size:12px;color:var(--muted)}
@media (max-width:900px){ .grid{grid-template-columns:1fr 1fr} .grid2{grid-template-columns:1fr} }
@media print{ body{background:#fff;color:#000} .card{border-color:#ddd} .opt{background:#fff;border-color:#ddd} .small{color:#444} }
a{color:#9ec4ff}
</style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <div class="brand">
        <img class="logo" src="https://cdn.prod.website-files.com/6800cc3b5f399f3e2b7f2ffa/68079e968300482f70a36a4a_output-onlinepngtools%20(1).png" alt="SPST" />
        <h1>Preventivo SPST</h1>
      </div>
      <div class="small">Valido fino al <strong>${esc(validTo)}</strong></div>
    </div>

    <div class="card">
      <div class="grid2">
        <div>
          <div class="k">Cliente</div>
          <div class="v">${esc(f.Email_Cliente || '—')}</div>
        </div>
        <div>
          <div class="k">Valuta</div>
          <div class="v">${esc(f.Valuta || 'EUR')}</div>
        </div>
      </div>
      ${noteGlob}
    </div>

    <div class="card">
      <div class="grid2">
        <div>
          <div class="k">Mittente</div>
          <div class="v">${esc(f.Mittente_Nome || '—')}</div>
          <div class="small">${esc([f.Mittente_Indirizzo, f.Mittente_CAP, f.Mittente_Citta, f.Mittente_Paese].filter(Boolean).join(', '))}</div>
        </div>
        <div>
          <div class="k">Destinatario</div>
          <div class="v">${esc(f.Destinatario_Nome || '—')}</div>
          <div class="small">${esc([f.Destinatario_Indirizzo, f.Destinatario_CAP, f.Destinatario_Citta, f.Destinatario_Paese].filter(Boolean).join(', '))}</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="k" style="margin-bottom:6px">Opzioni di spedizione</div>
      ${rows || '<div class="small">Nessuna opzione disponibile.</div>'}
    </div>

    <div class="small" style="margin-top:8px">
      Anteprima non vincolante. Eventuali costi accessori potrebbero essere applicati dal corriere ed addebitati al cliente.
      Per maggiori informazioni consulta i <a href="https://www.spst.it/termini-di-utilizzo" target="_blank" rel="noopener">Termini di utilizzo</a>.
    </div>
  </div>
</body></html>`;
}

export default async function handler(req, res){
  try{
    const slug = (req.query?.slug || '').toString();
    if (!slug) { res.status(400).send('Bad Request'); return; }

    // trova preventivo
    const quote = await getQuoteBySlug(slug);
    if (!quote) { res.status(404).send('Not found'); return; }

    // visibilità / scadenza
    const v = (quote.fields?.Visibilita || '').toString();
    if (v && v.toLowerCase().includes('bozza')) { res.status(404).send('Not found'); return; }
    const exp = quote.fields?.Scadenza_Link;
    if (exp && new Date(exp) < new Date(new Date().toISOString().slice(0,10))) {
      res.status(410).send('Link scaduto'); return;
    }

    const opts = await getOptionsForQuote(quote.id);
    const html = renderHtml(quote, opts);

    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.status(200).send(html);
  }catch(err){
    console.error('[quote/[slug]]', err);
    res.status(500).send('Server error');
  }
}
