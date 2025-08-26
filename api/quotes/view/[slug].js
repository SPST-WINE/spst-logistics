// api/quotes/view/[slug].js

const AT_BASE  = process.env.AIRTABLE_BASE_ID;
const AT_PAT   = process.env.AIRTABLE_PAT;
const TB_QUOTE = process.env.TB_PREVENTIVI;
const TB_OPT   = process.env.TB_OPZIONI;

function money(n, curr='EUR'){
  if (typeof n !== 'number') return '—';
  try { return new Intl.NumberFormat('it-IT',{style:'currency',currency:curr}).format(n); }
  catch { return `${n.toFixed(2)} ${curr}`; }
}
function esc(s=''){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function fmtDate(value){ if(!value) return '—'; try{ const d=new Date(value); if(Number.isNaN(+d)) return '—'; return d.toISOString().slice(0,10);}catch{ return '—'; } }

async function fetchJson(url){
  const r = await fetch(url, { headers:{ Authorization:`Bearer ${AT_PAT}` }});
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || 'Airtable error');
  return j;
}

export default async function handler(req,res){
  try{
    const slug = req.query?.slug;
    if(!slug) return res.status(400).send('Missing slug');

    // 1) Preventivo
    const qUrl = `https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(TB_QUOTE)}?filterByFormula=${encodeURIComponent(`{Slug_Pubblico}='${slug}'`)}`;
    const q = await fetchJson(qUrl);
    const rec = q.records?.[0];
    if(!rec) return res.status(404).send('Preventivo non trovato');

    const f = rec.fields;

    // (opzionale) blocca link scaduto
    if (f.Scadenza_Link) {
      const today = new Date().toISOString().slice(0,10);
      if (today > f.Scadenza_Link) return res.status(410).send('Link scaduto');
    }

    // 2) Opzioni del preventivo
    const optUrl = `https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(TB_OPT)}?filterByFormula=${encodeURIComponent(`SEARCH('${rec.id}', ARRAYJOIN({Preventivo}))`)}&sort[0][field]=Indice&sort[0][direction]=asc`;
    const o = await fetchJson(optUrl);
    const options = (o.records||[]).map(x => ({
      index: x.fields.Indice,
      carrier: x.fields.Corriere,
      service: x.fields.Servizio,
      transit: x.fields.Tempo_Resa,
      incoterm: x.fields.Incoterm,
      payer: x.fields.Oneri_A_Carico,
      price: Number(x.fields.Prezzo),
      currency: x.fields.Valuta || f.Valuta,
      weight: Number(x.fields.Peso_Kg),
      notes: x.fields.Note_Operative,
      recommended: !!x.fields.Consigliata,
    }));

    const best = options.find(o=>o.recommended)?.index ?? options[0]?.index;

    const rows = options.map(o => `
      <div class="opt ${o.index===best?'is-best':''}">
        <div class="opt-head">
          <div class="badge">OPZIONE ${o.index}</div>
          ${o.index===best ? '<span class="pill">Consigliata</span>' : ''}
        </div>
        <div class="grid">
          <div><div class="k">Corriere</div><div class="v">${esc(o.carrier||'—')}</div></div>
          <div><div class="k">Servizio</div><div class="v">${esc(o.service||'—')}</div></div>
          <div><div class="k">Tempo di resa</div><div class="v">${esc(o.transit||'—')}</div></div>
          <div><div class="k">Incoterm</div><div class="v">${esc(o.incoterm||'—')}</div></div>
          <div><div class="k">Oneri a carico</div><div class="v">${esc(o.payer||'—')}</div></div>
          <div><div class="k">Prezzo</div><div class="v">${money(o.price, o.currency||f.Valuta)}</div></div>
          <div><div class="k">Peso reale</div><div class="v">${Number.isFinite(o.weight)?o.weight.toFixed(2)+' kg':'—'}</div></div>
        </div>
        ${o.notes ? `<div class="notes"><div class="k" style="margin-bottom:4px">Note aggiuntive</div>${esc(o.notes)}</div>` : ''}
      </div>
    `).join('');

    const html = `<!doctype html>
<html lang="it"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Preventivo SPST</title>
<style>
:root{--bg:#0b1224;--card:#0e162b;--text:#e7ecf5;--muted:#9aa3b7;--brand:#f7911e;--accent:#6ea8ff}
*{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 Inter,system-ui,Segoe UI,Roboto,Helvetica,Arial}
.wrap{max-width:960px;margin:24px auto;padding:0 16px}
.header{display:flex;justify-content:space-between;align-items:center;margin:8px 0 16px}
.brand{display:flex;align-items:center;gap:10px}
.brand img{width:24px;height:24px}
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
a{color:#a9c6ff}
</style></head>
<body>
  <div class="wrap">
    <div class="header">
      <div class="brand">
        <img alt="" src="https://cdn.prod.website-files.com/6800cc3b5f399f3e2b7f2ffa/68079e968300482f70a36a4a_output-onlinepngtools%20(1).png"/>
        <h1>Preventivo SPST</h1>
      </div>
      <div class="small">Valido fino al <strong>${fmtDate(f.Valido_Fino_Al)}</strong></div>
    </div>

    <div class="card">
      <div class="grid2">
        <div><div class="k">Cliente</div><div class="v">${esc(f.Email_Cliente||'—')}</div></div>
        <div><div class="k">Valuta</div><div class="v">${esc(f.Valuta||'EUR')}</div></div>
      </div>
      ${f.Note_Globali ? `<div style="margin-top:10px"><div class="k">Note</div><div class="v">${esc(f.Note_Globali)}</div></div>`:''}
    </div>

    <div class="card">
      <div class="grid2">
        <div>
          <div class="k">Mittente</div>
          <div class="v">${esc(f.Mittente_Nome||'—')}</div>
          <div class="small">${esc([f.Mittente_Indirizzo,f.Mittente_CAP,f.Mittente_Citta,f.Mittente_Paese].filter(Boolean).join(', '))}</div>
        </div>
        <div>
          <div class="k">Destinatario</div>
          <div class="v">${esc(f.Destinatario_Nome||'—')}</div>
          <div class="small">${esc([f.Destinatario_Indirizzo,f.Destinatario_CAP,f.Destinatario_Citta,f.Destinatario_Paese].filter(Boolean).join(', '))}</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="k" style="margin-bottom:6px">Opzioni di spedizione</div>
      ${rows || '<div class="small">Nessuna opzione.</div>'}
    </div>

    <div class="small" style="margin-top:8px">
      Anteprima non vincolante. Eventuali costi accessori potrebbero essere applicati dal corriere ed addebitati al cliente.
      Per maggiori informazioni consulta i <a href="https://www.spst.it/termini-di-utilizzo" target="_blank" rel="noopener">Termini di utilizzo</a>.
    </div>
  </div>
</body></html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  }catch(err){
    console.error('[view/slug] error', err);
    return res.status(500).send('Errore interno');
  }
}
