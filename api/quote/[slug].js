// quote/[slug].js
// Serverless page che mostra il preventivo pubblico

const AT_BASE  = process.env.AIRTABLE_BASE_ID;
const AT_PAT   = process.env.AIRTABLE_PAT;
const TB_QUOTE = process.env.TB_PREVENTIVI;
const TB_OPT   = process.env.TB_OPZIONI;

const H = {
  html: (res, code, body) => {
    res.statusCode = code;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(body);
  }
};

const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

function money(n, curr='EUR'){
  if (typeof n !== 'number') return '—';
  try { return new Intl.NumberFormat('it-IT',{style:'currency',currency:curr}).format(n); }
  catch { return `${n.toFixed(2)} ${curr}`; }
}

function pageShell(content, title = "Preventivo SPST"){
  return `<!doctype html><html lang="it"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)}</title>
<style>
:root{--bg:#0b1224;--card:#0e162b;--text:#e7ecf5;--muted:#9aa3b7;--brand:#f7911e;--accent:#6ea8ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 Inter,system-ui,Segoe UI,Roboto,Helvetica,Arial}
.wrap{max-width:960px;margin:24px auto;padding:0 16px}
.header{display:flex;justify-content:space-between;align-items:center;margin:8px 0 16px}
.brand{display:flex;align-items:center;gap:10px}
.logo{width:26px;height:26px}
h1{margin:0;font-size:22px}
.card{background:var(--card);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:14px;margin:12px 0}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.k{font-size:12px;color:var(--muted)}.v{font-weight:600}
.badge{display:inline-block;padding:3px 8px;border-radius:999px;border:1px solid var(--brand);color:var(--brand);background:rgba(247,145,30,.12);font-size:10px}
.pill{display:inline-block;padding:4px 9px;border-radius:999px;background:rgba(110,168,255,.15);border:1px solid rgba(110,168,255,.4);font-size:11px}
.opt{border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:12px;margin:10px 0;background:#0d152a}
.opt.best{box-shadow:inset 0 0 0 1px rgba(110,168,255,.45), 0 6px 16px rgba(0,0,0,.25)}
.opt-head{display:flex;gap:8px;align-items:center;margin-bottom:8px}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.notes{margin-top:8px;color:var(--muted)}
.small{font-size:12px;color:var(--muted)}
@media (max-width:900px){.grid{grid-template-columns:1fr 1fr}.grid2{grid-template-columns:1fr}}
</style></head><body><div class="wrap">${content}</div></body></html>`;
}

function messageView(msg){
  return pageShell(`<div class="card"><div class="v">${esc(msg)}</div></div>`, "Preventivo");
}

async function atSelect(table, filterByFormula, fields = []) {
  const url = new URL(`https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(table)}`);
  url.searchParams.set("filterByFormula", filterByFormula);
  if (fields?.length) fields.forEach(f => url.searchParams.append("fields[]", f));
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${AT_PAT}` }});
  const json = await resp.json();
  if (!resp.ok) {
    const e = new Error(json?.error?.message || "Airtable error");
    e.status = resp.status;
    e.payload = json;
    throw e;
  }
  return json.records || [];
}

export default async function handler(req, res){
  try {
    if (!AT_BASE || !AT_PAT || !TB_QUOTE || !TB_OPT) {
      return H.html(res, 500, messageView("Configurazione mancante."));
    }

    const slug = decodeURIComponent((req.query?.slug || "").toString());
    if (!slug) return H.html(res, 404, messageView("Link non valido."));

    // cerca per Slug_Pubblico OPPURE Slug
    const filter = `OR({Slug_Pubblico}='${slug}', {Slug}='${slug}')`;
    const recs = await atSelect(TB_QUOTE, filter);
    const q = recs[0];
    if (!q) return H.html(res, 404, messageView("Link non valido."));

    const f = q.fields || {};

    // visibilità / scadenza
    if (f.Visibilita === "Solo_Bozza") {
      return H.html(res, 403, messageView("Link non ancora attivo."));
    }
    if (f.Scadenza_Link) {
      const exp = new Date(f.Scadenza_Link);
      if (!Number.isNaN(+exp) && Date.now() > +exp) {
        return H.html(res, 410, messageView("Link scaduto"));
      }
    }

    // opzioni collegate
    const optFilter = `FIND('${q.id}', ARRAYJOIN(Preventivo))`;
    const opts = await atSelect(
      TB_OPT,
      optFilter,
      ["Indice","Corriere","Servizio","Tempo_Resa","Incoterm","Oneri_A_Carico","Prezzo","Valuta","Peso_Kg","Note_Operative","Consigliata"]
    );

    const bestIndex = (() => {
      const explicit = opts.find(r => !!r.fields?.Consigliata)?.fields?.Indice;
      if (explicit != null) return Number(explicit);
      const withPrice = opts.filter(r => typeof r.fields?.Prezzo === "number")
                            .sort((a,b)=>a.fields.Prezzo - b.fields.Prezzo);
      return withPrice[0]?.fields?.Indice;
    })();

    const rows = opts.map(r => {
      const o = r.fields || {};
      return `<div class="opt ${o.Consigliata || (o.Indice===bestIndex) ? "best":""}">
        <div class="opt-head">
          <span class="badge">OPZIONE ${esc(o.Indice)}</span>
          ${(o.Consigliata || (o.Indice===bestIndex)) ? '<span class="pill">Consigliata</span>' : ''}
        </div>
        <div class="grid">
          <div><div class="k">Corriere</div><div class="v">${esc(o.Corriere)}</div></div>
          <div><div class="k">Servizio</div><div class="v">${esc(o.Servizio)}</div></div>
          <div><div class="k">Tempo di resa</div><div class="v">${esc(o.Tempo_Resa)}</div></div>
          <div><div class="k">Incoterm</div><div class="v">${esc(o.Incoterm)}</div></div>
          <div><div class="k">Oneri a carico</div><div class="v">${esc(o.Oneri_A_Carico)}</div></div>
          <div><div class="k">Prezzo</div><div class="v">${money(o.Prezzo, o.Valuta || f.Valuta || "EUR")}</div></div>
          <div><div class="k">Peso reale</div><div class="v">${typeof o.Peso_Kg==="number" ? (o.Peso_Kg.toFixed(2)+" kg") : "—"}</div></div>
        </div>
        ${o.Note_Operative ? `<div class="notes"><strong>Note aggiuntive:</strong> ${esc(o.Note_Operative)}</div>` : ""}
      </div>`;
    }).join("");

    const content = `
      <div class="header">
        <div class="brand">
          <img class="logo" src="https://cdn.prod.website-files.com/6800cc3b5f399f3e2b7f2ffa/68079e968300482f70a36a4a_output-onlinepngtools%20(1).png" alt="SPST logo" />
          <h1>Preventivo SPST</h1>
        </div>
        <div class="small">Valido fino al <strong>${esc(f.Valido_Fino_Al || "")}</strong></div>
      </div>

      <div class="card">
        <div class="grid2">
          <div><div class="k">Cliente</div><div class="v">${esc(f.Email_Cliente || "—")}</div></div>
          <div><div class="k">Valuta</div><div class="v">${esc(f.Valuta || "EUR")}</div></div>
        </div>
        ${f.Note_Globali ? `<div style="margin-top:10px"><div class="k">Note</div><div class="v">${esc(f.Note_Globali)}</div></div>` : ""}
      </div>

      <div class="card">
        <div class="grid2">
          <div>
            <div class="k">Mittente</div>
            <div class="v">${esc(f.Mittente_Nome || "—")}</div>
            <div class="small">${esc([f.Mittente_Indirizzo,f.Mittente_CAP,f.Mittente_Citta,f.Mittente_Paese].filter(Boolean).join(", "))}</div>
          </div>
          <div>
            <div class="k">Destinatario</div>
            <div class="v">${esc(f.Destinatario_Nome || "—")}</div>
            <div class="small">${esc([f.Destinatario_Indirizzo,f.Destinatario_CAP,f.Destinatario_Citta,f.Destinatario_Paese].filter(Boolean).join(", "))}</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="k" style="margin-bottom:6px">Opzioni di spedizione</div>
        ${rows || '<div class="small">Nessuna opzione disponibile.</div>'}
      </div>

      <div class="small" style="margin-top:8px">
        Anteprima non vincolante. Eventuali costi accessori potrebbero essere applicati dal corriere ed addebitati al cliente.
        Per maggiori informazioni consulta i <a style="color:#9ec1ff" href="https://www.spst.it/termini-di-utilizzo" target="_blank" rel="noopener">Termini di utilizzo</a>.
      </div>
    `;

    return H.html(res, 200, pageShell(content));
  } catch (err) {
    console.error("[quote/[slug]] error:", err);
    return H.html(res, 500, messageView("Errore interno."));
  }
}
