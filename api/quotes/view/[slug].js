// api/quotes/view/[slug].js

const AT_BASE  = process.env.AIRTABLE_BASE_ID;
const AT_PAT   = process.env.AIRTABLE_PAT;
const TB_QUOTE = process.env.TB_PREVENTIVI;
const TB_OPT   = process.env.TB_OPZIONI;

/* --------------------------- Utils di formattazione --------------------------- */
function money(n, curr = "EUR") {
  const num = Number(n);
  if (!Number.isFinite(num)) return "—";
  try { return new Intl.NumberFormat("it-IT", { style: "currency", currency: curr }).format(num); }
  catch { return `${num.toFixed(2)} ${curr}`; }
}
function esc(s = "") {
  return String(s).replace(/[&<>"']/g, m => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[m]));
}
function fmtDate(val) {
  if (!val) return "—";
  try {
    const d = new Date(val);
    if (Number.isNaN(+d)) return "—";
    return d.toISOString().slice(0, 10);
  } catch { return "—"; }
}
function parseDate(val) {
  const d = new Date(val);
  return Number.isNaN(+d) ? null : d;
}
function isExpired(scadenza) {
  if (!scadenza) return false;
  const d = parseDate(scadenza);
  if (!d) return false;
  return d.getTime() < Date.now();
}

/* ------------------------------ Helpers HTTP/Airtable ------------------------------ */
async function fetchJson(url) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${AT_PAT}` } });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || "Airtable error");
  return j;
}
function htmlPage(title, body, extraHead='') {
  return `<!doctype html><html lang="it"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)}</title>
<style>
:root{--bg:#0b1224;--card:#0e162b;--text:#e7ecf5;--muted:#9aa3b7;--brand:#f7911e;--accent:#6ea8ff;--ok:#42c17a}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 Inter,system-ui,Segoe UI,Roboto,Helvetica,Arial}
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
.opt-head{display:flex;gap:8px;align-items:center;justify-content:space-between;margin-bottom:8px}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.notes{margin-top:8px;color:var(--muted)}
.small{font-size:12px;color:var(--muted)}
a{color:#a9c6ff}
.btn{appearance:none;border:1px solid rgba(255,255,255,.2);background:#101a32;color:#fff;border-radius:10px;padding:8px 12px;cursor:pointer}
.btn[disabled]{opacity:.6;cursor:not-allowed}
.ok{color:var(--ok);border-color:rgba(66,193,122,.5);background:rgba(66,193,122,.1)}
@media (max-width:900px){ .grid{grid-template-columns:1fr 1fr} .grid2{grid-template-columns:1fr} }
@media print{ body{background:#fff;color:#000} .card{border-color:#ddd} .opt{background:#fff;border-color:#ddd} .small{color:#444} .btn{display:none} }
.center{display:flex;min-height:60vh;align-items:center;justify-content:center;text-align:center}
</style>
${extraHead}
</head><body>${body}</body></html>`;
}

/* ------------------------------ Fetch opzioni robuste ------------------------------ */
async function fetchOptionsForQuote(quoteId) {
  const base = `https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(TB_OPT)}`;
  const sort = `&sort[0][field]=Indice&sort[0][direction]=asc`;

  let url = `${base}?filterByFormula=${encodeURIComponent(`{Preventivo_Id}='${quoteId}'`)}${sort}`;
  try {
    const j = await fetchJson(url);
    if (Array.isArray(j.records) && j.records.length > 0) return j;
  } catch { /* ignore */ }

  url = `${base}?filterByFormula=${encodeURIComponent(`FIND('${quoteId}', ARRAYJOIN({Preventivo}))`)}${sort}`;
  return await fetchJson(url);
}

/* ------------------------------------ Handler ------------------------------------ */
export default async function handler(req, res) {
  try {
    const slug = req.query?.slug;
    const debug = String(req.query?.debug || '') === '1';
    if (!slug) return res.status(400).send("Missing slug");

    // 1) Preventivo
    const qUrl = `https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(TB_QUOTE)}?filterByFormula=${encodeURIComponent(`{Slug_Pubblico}='${slug}'`)}`;
    const q = await fetchJson(qUrl);
    const rec = q.records?.[0];
    if (!rec) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(404).send(htmlPage("Preventivo non trovato",
        `<div class="wrap center"><div>
           <h1>Preventivo non trovato</h1>
           <p class="small">Verifica il link ricevuto o contatta SPST.</p>
         </div></div>`));
    }
    const f = rec.fields;

    // blocco link scaduto
    if (isExpired(f.Scadenza_Link)) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(410).send(htmlPage("Link scaduto",
        `<div class="wrap center"><div>
           <h1>Link scaduto</h1>
           <p class="small">Questo link non è più attivo. Richiedi un nuovo preventivo a SPST.</p>
         </div></div>`));
    }

    // 2) Opzioni
    const o = await fetchOptionsForQuote(rec.id);
    const options = (o.records || []).map(r => ({
      id: r.id,
      index: r.fields.Indice,
      carrier: r.fields.Corriere,
      service: r.fields.Servizio,
      transit: r.fields.Tempo_Resa,
      incoterm: r.fields.Incoterm,
      payer: r.fields.Oneri_A_Carico,
      price: Number(r.fields.Prezzo),
      currency: r.fields.Valuta || f.Valuta,
      weight: Number(r.fields.Peso_Kg),
      notes: r.fields.Note_Operative,
      recommended: !!r.fields.Consigliata,
      accepted: !!r.fields.Accettata,
    }));

    // consigliata / accettata
    const acceptedIndex = Number(f.Opzione_Accettata) || null;
    let best = acceptedIndex || f.Opzione_Consigliata;
    if (!best) {
      best = options.find(x => x.recommended)?.index;
      if (!best) {
        const priced = options.filter(x => Number.isFinite(x.price)).sort((a,b)=>a.price-b.price);
        best = priced[0]?.index ?? options[0]?.index;
      }
    }

    const rows = options.map(o => {
      const isBest = String(o.index) === String(best);
      const isAccepted = acceptedIndex && String(o.index) === String(acceptedIndex);
      const acceptUI = !acceptedIndex
        ? `<button class="btn" data-accept="${esc(String(o.index))}">Accetta questa opzione</button>`
        : (isAccepted ? `<span class="pill ok">Accettata</span>` : '');

      return `
      <div class="opt ${isBest ? "is-best" : ""}">
        <div class="opt-head">
          <div>
            <span class="badge">OPZIONE ${esc(o.index ?? "")}</span>
            ${isBest ? '<span class="pill">Consigliata</span>' : ''}
          </div>
          ${acceptUI}
        </div>
        <div class="grid">
          <div><div class="k">Corriere</div><div class="v">${esc(o.carrier||"—")}</div></div>
          <div><div class="k">Servizio</div><div class="v">${esc(o.service||"—")}</div></div>
          <div><div class="k">Tempo di resa</div><div class="v">${esc(o.transit||"—")}</div></div>
          <div><div class="k">Incoterm</div><div class="v">${esc(o.incoterm||"—")}</div></div>
          <div><div class="k">Oneri a carico</div><div class="v">${esc(o.payer||"—")}</div></div>
          <div><div class="k">Prezzo</div><div class="v">${money(o.price, o.currency||f.Valuta)}</div></div>
          <div><div class="k">Peso reale</div><div class="v">${Number.isFinite(o.weight) ? o.weight.toFixed(2)+" kg" : "—"}</div></div>
        </div>
        ${o.notes ? `<div class="notes"><div class="k" style="margin-bottom:4px">Note aggiuntive</div>${esc(o.notes)}</div>` : ""}
      </div>`;
    }).join("");

    // script accettazione
    const extraHead = `
<script>
(function(){
  function qs(s,el){return (el||document).querySelector(s)}
  function qsa(s,el){return Array.from((el||document).querySelectorAll(s))}
  const slug = ${JSON.stringify(slug)};

  async function acceptOption(idx, btn){
    if (!idx) return;
    try{
      btn && (btn.disabled = true, btn.textContent = "Invio…");
      const r = await fetch("/api/quotes/accept", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ slug, option: Number(idx) })
      });
      const j = await r.json().catch(()=>null);
      if (!r.ok || j?.ok===false) {
        const msg = j?.error?.message || j?.error || ("HTTP "+r.status);
        alert("Non è stato possibile accettare il preventivo.\\n" + msg);
        btn && (btn.disabled = false, btn.textContent = "Accetta questa opzione");
        return;
      }
      // ricarica per aggiornare lo stato UI
      location.reload();
    }catch(err){
      alert("Errore di rete. Riprova.");
      btn && (btn.disabled = false, btn.textContent = "Accetta questa opzione");
    }
  }

  document.addEventListener("click", (e)=>{
    const b = e.target.closest("[data-accept]");
    if (!b) return;
    e.preventDefault();
    const idx = b.getAttribute("data-accept");
    if (!idx) return;
    if (!confirm("Confermi di accettare l'opzione "+idx+"?")) return;
    acceptOption(idx, b);
  });
})();
</script>`;

    const debugTail = debug
      ? `<div class="small" style="margin-top:8px">DEBUG: quoteId=${esc(rec.id)}, options=${(options||[]).length}</div>`
      : '';

    const html = htmlPage("Preventivo SPST", `
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
            <div><div class="k">Cliente</div><div class="v">${esc(f.Email_Cliente||"—")}</div></div>
            <div><div class="k">Valuta</div><div class="v">${esc(f.Valuta||"EUR")}</div></div>
          </div>
          ${f.Note_Globali ? `<div style="margin-top:10px"><div class="k">Note</div><div class="v">${esc(f.Note_Globali)}</div></div>` : ""}
        </div>

        <div class="card">
          <div class="grid2">
            <div>
              <div class="k">Mittente</div>
              <div class="v">${esc(f.Mittente_Nome||"—")}</div>
              <div class="small">${esc([f.Mittente_Indirizzo,f.Mittente_CAP,f.Mittente_Citta,f.Mittente_Paese].filter(Boolean).join(", "))}</div>
            </div>
            <div>
              <div class="k">Destinatario</div>
              <div class="v">${esc(f.Destinatario_Nome||"—")}</div>
              <div class="small">${esc([f.Destinatario_Indirizzo,f.Destinatario_CAP,f.Destinatario_Citta,f.Destinatario_Paese].filter(Boolean).join(", "))}</div>
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

        ${debugTail}
      </div>
    `, extraHead);

    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (err) {
    console.error("[view/[slug]] error:", err);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(500).send(htmlPage("Errore", `<div class="wrap center"><div><h1>Errore</h1><p class="small">Si è verificato un errore inatteso.</p></div></div>`));
  }
}
