// api/quote/[slug].js

const AT_BASE  = process.env.AIRTABLE_BASE_ID;
const AT_PAT   = process.env.AIRTABLE_PAT;
const TB_QUOTE = process.env.TB_PREVENTIVI;
const TB_OPT   = process.env.TB_OPZIONI;

async function atFetch(path) {
  const r = await fetch(`https://api.airtable.com/v0/${AT_BASE}/${path}`, {
    headers: { Authorization: `Bearer ${AT_PAT}` }
  });
  const j = await r.json();
  if (!r.ok) { const e=new Error(j?.error?.message||`Airtable ${r.status}`); e.status=r.status; e.payload=j; throw e; }
  return j;
}
function esc(s=''){ return String(s).replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
function money(n,c='EUR'){ const v=Number(n); if(!Number.isFinite(v)) return '—'; try{return new Intl.NumberFormat('it-IT',{style:'currency',currency:c}).format(v);}catch{return `${v.toFixed(2)} ${c}`;} }
function fmtDate(value){ try{ const d=new Date(value); if(Number.isNaN(+d)) return '—'; return d.toISOString().slice(0,10);}catch{return '—';} }

function page(title, bodyHtml) {
  return `<!doctype html><html lang="it"><head>
  <meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${esc(title)}</title>
  <style>
  :root{--bg:#0b1224;--card:#0e162b;--text:#e7ecf5;--muted:#9aa3b7;--brand:#f7911e;--accent:#6ea8ff}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 Inter,system-ui,Segoe UI,Roboto,Helvetica,Arial}
  .wrap{max-width:960px;margin:24px auto;padding:0 16px}
  .header{display:flex;justify-content:space-between;align-items:center;margin:8px 0 16px}
  .brand{display:flex;align-items:center;gap:10px}
  .brand img{width:28px;height:28px}
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
  a{color:#9ec1ff;text-decoration:none} a:hover{text-decoration:underline}
  @media (max-width:900px){ .grid{grid-template-columns:1fr 1fr} .grid2{grid-template-columns:1fr} }
  </style>
  </head><body><div class="wrap">${bodyHtml}</div></body></html>`;
}

export default async function handler(req,res){
  try{
    const slug = decodeURIComponent(req.query.slug || '').trim();
    if (!slug) return res.status(400).send('Missing slug');

    // 1) Preventivo by slug
    const ff = encodeURIComponent(`{Slug_Pubblico}="${slug}"`);
    const q = await atFetch(`${encodeURIComponent(TB_QUOTE)}?maxRecords=1&filterByFormula=${ff}`);
    const rec = q.records?.[0];
    if (!rec) return res.status(404).send(page('Preventivo non trovato', `<h1>404</h1><p>Link non valido.</p>`));

    const f = rec.fields;

    // 2) access control: visibilità e scadenza
    const today = new Date().toISOString().slice(0,10);
    if (f.Visibilita === 'Solo_Bozza') {
      return res.status(403).send(page('Preventivo non pubblico', `<h1>Bozza</h1><p>Questo preventivo non è ancora pubblico.</p>`));
    }
    if (f.Scadenza_Link && today > String(f.Scadenza_Link)) {
      return res.status(410).send(page('Link scaduto', `<h1>Link scaduto</h1><p>Contatta SPST per un nuovo preventivo.</p>`));
    }

    const quoteId = rec.id;

    // 3) Opzioni collegate
    const ffOpt = encodeURIComponent(`FIND("${quoteId}", ARRAYJOIN({Preventivo}))`);
    const opts = await atFetch(`${encodeURIComponent(TB_OPT)}?filterByFormula=${ffOpt}&sort[0][field]=Indice&sort[0][direction]=asc`);
    const options = (opts.records||[]).map(r => r.fields);

    // 4) best: consigliata o prima
    const bestIndex = options.find(o => o.Consigliata) ? options.find(o=>o.Consigliata).Indice : options[0]?.Indice;

    // 5) render
    const rows = options.map(o => `
      <div class="opt ${o.Indice===bestIndex?'is-best':''}">
        <div class="opt-head">
          <div class="badge">OPZIONE ${o.Indice ?? '—'}</div>
          ${o.Consigliata ? '<span class="pill">Consigliata</span>' : ''}
        </div>
        <div class="grid">
          <div><div class="k">Corriere</div><div class="v">${esc(o.Corriere||'—')}</div></div>
          <div><div class="k">Servizio</div><div class="v">${esc(o.Servizio||'—')}</div></div>
          <div><div class="k">Tempo di resa</div><div class="v">${esc(o.Tempo_Resa||'—')}</div></div>
          <div><div class="k">Incoterm</div><div class="v">${esc(o.Incoterm||'—')}</div></div>
          <div><div class="k">Oneri a carico</div><div class="v">${esc(o.Oneri_A_Carico||'—')}</div></div>
          <div><div class="k">Prezzo</div><div class="v">${money(o.Prezzo, o.Valuta||f.Valuta||'EUR')}</div></div>
          <div><div class="k">Peso reale</div><div class="v">${Number.isFinite(+o.Peso_Kg) ? `${(+o.Peso_Kg).toFixed(2)} kg` : '—'}</div></div>
        </div>
        ${o.Note_Operative ? `<div class="notes"><span class="k">Note aggiuntive</span><br/>${esc(o.Note_Operative)}</div>` : ''}
      </div>
    `).join('');

    const body = `
      <div class="header">
        <div class="brand">
          <img src="https://cdn.prod.website-files.com/6800cc3b5f399f3e2b7f2ffa/68079e968300482f70a36a4a_output-onlinepngtools%20(1).png" alt="SPST"/>
          <h1>Preventivo SPST</h1>
        </div>
        <div class="k">Valido fino al <strong>${esc(f.Valido_Fino_Al || '—')}</strong></div>
      </div>

      <div class="card">
        <div class="grid2">
          <div><div class="k">Cliente</div><div class="v">${esc(f.Email_Cliente || '—')}</div></div>
          <div><div class="k">Valuta</div><div class="v">${esc(f.Valuta || 'EUR')}</div></div>
        </div>
        ${f.Note_Globali ? `<div style="margin-top:10px"><div class="k">Note</div><div class="v">${esc(f.Note_Globali)}</div></div>`:''}
      </div>

      <div class="card">
        <div class="grid2">
          <div>
            <div class="k">Mittente</div>
            <div class="v">${esc(f.Mittente_Nome||'—')}</div>
            <div class="k" style="margin-top:4px">${esc([f.Mittente_Indirizzo,f.Mittente_CAP,f.Mittente_Citta,f.Mittente_Paese].filter(Boolean).join(', '))}</div>
          </div>
          <div>
            <div class="k">Destinatario</div>
            <div class="v">${esc(f.Destinatario_Nome||'—')}</div>
            <div class="k" style="margin-top:4px">${esc([f.Destinatario_Indirizzo,f.Destinatario_CAP,f.Destinatario_Citta,f.Destinatario_Paese].filter(Boolean).join(', '))}</div>
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
    `;

    res.setHeader('Content-Type','text/html; charset=utf-8');
    return res.status(200).send(page('Preventivo SPST', body));
  }catch(err){
    const code = err.status || 500;
    return res.status(code).send(page('Errore', `<h1>${code}</h1><pre>${esc(err.message||'Errore')}</pre>`));
  }
}
