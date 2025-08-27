// api/quotes/accept.js
// ———————————————————————————————————————————————————————————————
// Accetta un preventivo + invia email (Resend) con i dettagli opzione.
// Aggiunti fallback robusti e LOG estesi per capire perché i campi
// dell’opzione in email risultavano vuoti.
// ———————————————————————————————————————————————————————————————

/* =================== CORS =================== */
const DEFAULT_ALLOW = [
  "https://spst.it",
  "https://www.spst.it",
  "https://spst-logistics.vercel.app",
  "http://localhost:3000",
  "http://localhost:8888",
];
const allowlist = (process.env.ORIGIN_ALLOWLIST || DEFAULT_ALLOW.join(","))
  .split(",").map(s => s.trim()).filter(Boolean);

function isAllowed(origin) {
  if (!origin) return false;
  for (const item of allowlist) {
    if (item.includes("*")) {
      const esc = item.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace("\\*", ".*");
      if (new RegExp("^" + esc + "$").test(origin)) return true;
    } else if (item === origin) return true;
  }
  return false;
}
function setCors(res, origin) {
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (isAllowed(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
}

/* =================== ENV / Airtable =================== */
const AT_BASE  = process.env.AIRTABLE_BASE_ID;
const AT_PAT   = process.env.AIRTABLE_PAT;
const TB_QUOTE = process.env.TB_PREVENTIVI;   // Preventivi
const TB_OPT   = process.env.TB_OPZIONI;      // OpzioniPreventivo

async function atFetch(url) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${AT_PAT}` } });
  const j = await r.json().catch(()=>null);
  if (!r.ok) {
    const e = new Error(j?.error?.message || "Airtable error");
    e.status = r.status; e.payload = j;
    throw e;
  }
  return j;
}
async function atUpdate(table, records) {
  const url = `https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(table)}`;
  const resp = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${AT_PAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ records }),
  });
  const json = await resp.json().catch(()=>null);
  if (!resp.ok) {
    const err = new Error(json?.error?.message || "Airtable error");
    err.status = resp.status; err.payload = json;
    throw err;
  }
  return json;
}

/* =================== Utils =================== */
const toNumber = (x) => {
  if (x === null || x === undefined) return undefined;
  const n = Number(x);
  return Number.isFinite(n) ? n : undefined;
};
const money = (n, curr = "EUR") => {
  const num = Number(n);
  if (!Number.isFinite(num)) return "—";
  try { return new Intl.NumberFormat("it-IT", { style: "currency", currency: curr }).format(num); }
  catch { return `${num.toFixed(2)} ${curr}`; }
};
const escapeHtml = (s = "") =>
  String(s).replace(/[&<>"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[m]));
const pick = (obj, keys, fallback="") => {
  for (const k of keys) if (obj && obj[k] != null && obj[k] !== "") return obj[k];
  return fallback;
};

/** Legge opzioni per un preventivo (1: campo testo Preventivo_Id, 2: linked {Preventivo}, 3: full scan) */
async function fetchOptionsForQuote(quoteId) {
  const base = `https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(TB_OPT)}`;
  const sort = `&sort[0][field]=Indice&sort[0][direction]=asc`;

  // 1) via campo testo
  let url = `${base}?filterByFormula=${encodeURIComponent(`{Preventivo_Id}='${quoteId}'`)}${sort}`;
  try {
    const j = await atFetch(url);
    if (j?.records?.length) return j.records;
  } catch {}

  // 2) fallback linked
  url = `${base}?filterByFormula=${encodeURIComponent(`FIND('${quoteId}', ARRAYJOIN({Preventivo}))`)}${sort}`;
  try {
    const j = await atFetch(url);
    if (j?.records?.length) return j.records;
  } catch {}

  // 3) last resort: carico (max 100) e filtro client-side
  const all = await atFetch(`${base}?pageSize=100${sort}`);
  return (all.records || []).filter(r => {
    const f = r.fields || {};
    const link = f.Preventivo;
    const txt  = f.Preventivo_Id;
    return (Array.isArray(link) && link.includes(quoteId)) || (txt === quoteId);
  });
}

/** Normalizza i campi dell'opzione in un oggetto coerente per email */
function normalizeOption(fields, quoteCurrency) {
  const priceRaw = pick(fields, ["Prezzo","Price","prezzo"], undefined);
  const currency = pick(fields, ["Valuta","Currency","valuta"], quoteCurrency || "EUR");
  return {
    index   : toNumber(pick(fields, ["Indice","Index","Opzione","Option","opzione"], undefined)),
    carrier : pick(fields, ["Corriere","Carrier","corriere"], "—"),
    service : pick(fields, ["Servizio","Service","servizio"], "—"),
    incoterm: pick(fields, ["Incoterm","INCOTERM","incoterm"], "—"),
    payer   : pick(fields, ["Oneri_A_Carico","Oneri a carico di","Payer","oneri a carico di"], "—"),
    price   : toNumber(priceRaw),
    currency,
  };
}

/* =================== Email (Resend) =================== */
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const MAIL_FROM = process.env.MAIL_FROM || "SPST Notifications <notification@spst.it>";
const PUBLIC_QUOTE_BASE_URL = (process.env.PUBLIC_QUOTE_BASE_URL || "https://spst-logistics.vercel.app/quote").replace(/\/$/,"");

function buildEmailHtml({ fields, optionIdx, opt, quoteUrl }) {
  const brand  = "#f7911e";
  const label  = "#6b7280";
  const text   = "#111111";
  const border = "#e8e8e8";
  const bg     = "#ffffff";
  const outer  = "#f6f7fb";

  const row = (k, v) => `
  <tr>
    <td style="padding:10px 12px;border-bottom:1px solid ${border};color:${label};width:34%;font:500 13px/1.3 system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial">${escapeHtml(k)}</td>
    <td style="padding:10px 12px;border-bottom:1px solid ${border};color:${text};font:600 13px/1.3 system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial">${v}</td>
  </tr>`;

  const rows = [
    row("Opzione", escapeHtml(String(optionIdx))),
    row("Cliente",
      `<a style="color:${text};text-decoration:underline" href="mailto:${escapeHtml(fields?.Email_Cliente||"")}">${escapeHtml(fields?.Email_Cliente||"—")}</a>`
    ),
    row("Corriere", escapeHtml(opt.carrier || "—")),
    row("Servizio", escapeHtml(opt.service || "—")),
    row("Incoterm", escapeHtml(opt.incoterm || "—")),
    row("Oneri a carico", escapeHtml(opt.payer || "—")),
    row("Prezzo", escapeHtml(money(opt.price, opt.currency))),
    row("Link preventivo",
      `<a style="color:${text};text-decoration:underline" href="${quoteUrl}" target="_blank" rel="noopener">${escapeHtml(quoteUrl)}</a>`
    ),
  ].join("");

  return `
  <div style="background:${outer};padding:24px">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px;margin:0 auto;background:${bg};border:1px solid ${border};border-radius:14px">
      <tr>
        <td style="padding:18px 20px 0 20px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="vertical-align:middle;padding-right:10px">
                <img src="https://cdn.prod.website-files.com/6800cc3b5f399f3e2b7f2ffa/68079e968300482f70a36a4a_output-onlinepngtools%20(1).png"
                     alt="SPST" width="28" height="28" style="display:block;border:0;outline:0;margin:0 10px 0 0" />
              </td>
              <td style="vertical-align:middle">
                <div style="font:700 18px/1.2 system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;color:${brand};margin:0 0 6px">Preventivo accettato!</div>
                <div style="font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;color:${text}">
                  Gentile Cliente,<br/>il tuo preventivo è stato accettato. Evaderemo la tua spedizione al più presto.
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <tr>
        <td style="padding:16px 20px 8px 20px">
          <div style="font:600 13px/1.2 system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;color:${label};text-transform:uppercase;letter-spacing:.3px;margin:0 0 6px">
            Dettagli del preventivo accettato
          </div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                 style="border:1px solid ${border};border-radius:10px;overflow:hidden">
            ${rows}
          </table>
        </td>
      </tr>

      <tr>
        <td style="padding:14px 20px 4px 20px">
          <a href="${quoteUrl}" target="_blank" rel="noopener"
             style="display:inline-block;background:${brand};color:#111;text-decoration:none;font:700 14px/1 system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;padding:12px 16px;border-radius:10px;border:1px solid rgba(0,0,0,.06)">
            Apri il preventivo
          </a>
        </td>
      </tr>

      <tr>
        <td style="padding:14px 20px 20px 20px;color:${label};font:12px/1.5 system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial">
          Per ulteriore supporto, puoi scriverci su WhatsApp:
          <a href="https://wa.me/393201441789" style="color:${text};text-decoration:underline">+39 320 144 1789</a><br/>
          Grazie per aver scelto SPST!
        </td>
      </tr>
    </table>
  </div>`.trim();
}

async function sendAcceptanceEmail({ slug, fields, optionIdx, opt }) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    console.warn("[accept] RESEND_API_KEY mancante: salto invio email");
    return { sent:false, reason:"missing api key" };
  }

  const toSet = new Set([
    "commerciale@spst.it",
    "info@spst.it",
    (fields?.Email_Cliente || "").trim()
  ].filter(Boolean).map(e => e.toLowerCase()));
  const to = Array.from(toSet);
  if (!to.length) return { sent:false, reason:"no recipients" };

  const subject  = `Conferma accettazione preventivo • Opzione ${optionIdx}`;
  const quoteUrl = `${PUBLIC_QUOTE_BASE_URL}/${encodeURIComponent(slug)}`;

  const textLines = [
    "Preventivo accettato!",
    "",
    "Dettagli:",
    `Opzione: ${optionIdx}`,
    `Cliente: ${fields?.Email_Cliente || "—"}`,
    `Corriere: ${opt.carrier || "—"}`,
    `Servizio: ${opt.service || "—"}`,
    `Incoterm: ${opt.incoterm || "—"}`,
    `Oneri a carico: ${opt.payer || "—"}`,
    `Prezzo: ${money(opt.price, opt.currency)}`,
    "",
    `Link preventivo: ${quoteUrl}`,
    "",
    "Per supporto WhatsApp: +39 320 144 1789",
  ].join("\n");

  const html = buildEmailHtml({ fields, optionIdx, opt, quoteUrl });

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: MAIL_FROM, to, subject, html, text: textLines }),
  });
  const json = await resp.json().catch(()=>null);
  if (!resp.ok) {
    console.error("[accept] email send failed:", json || resp.statusText);
    return { sent:false, status:resp.status, payload:json };
  }
  return { sent:true, payload:json };
}

/* =================== Handler =================== */
export default async function handler(req, res) {
  setCors(res, req.headers.origin);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")   return res.status(405).json({ ok:false, error:"Method Not Allowed" });

  try {
    if (!AT_BASE || !AT_PAT || !TB_QUOTE || !TB_OPT) {
      throw new Error("Missing env vars: AIRTABLE_BASE_ID / AIRTABLE_PAT / TB_PREVENTIVI / TB_OPZIONI");
    }

    const body   = (req.body && typeof req.body === "object") ? req.body : JSON.parse(req.body || "{}");
    const slug   = String(body.slug || "").trim();
    // Supporta sia "option" che "optionIndex" dal client
    const optionIdx = toNumber(body.option ?? body.optionIndex);
    if (!slug || !optionIdx) return res.status(400).json({ ok:false, error:"Missing slug/option" });

    // 1) Preventivo per slug
    const qUrl = `https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(TB_QUOTE)}?filterByFormula=${encodeURIComponent(`{Slug_Pubblico}='${slug}'`)}`;
    const q    = await atFetch(qUrl);
    const rec  = q.records?.[0];
    if (!rec) return res.status(404).json({ ok:false, error:"Quote not found" });

    const f = rec.fields || {};
    const already = f?.Opzione_Accettata;
    if (already && Number(already) !== optionIdx) {
      return res.status(409).json({ ok:false, error:"Quote already accepted with a different option" });
    }

    // 2) Aggiorna Preventivo
    const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
    const ua = String(req.headers["user-agent"] || "");
    await atUpdate(TB_QUOTE, [{
      id: rec.id,
      fields: {
        Opzione_Accettata: optionIdx,
        Accettato_Il     : new Date().toISOString(),
        Accettato_IP     : ip || undefined,
        Accettato_UA     : ua || undefined,
        Stato            : "Accettato",
      },
    }]);

    // 3) Carica opzioni e scegli quella giusta (con fallback + LOG)
    const options = await fetchOptionsForQuote(rec.id);
    console.log("[accept] options.count:", options?.length, "for quote:", rec.id, "slug:", slug);

    let chosen = null;
    if (Array.isArray(options) && options.length) {
      // a) match numerico su Indice
      chosen = options.find(r => {
        const idxNum = toNumber(pick(r.fields || {}, ["Indice","Index","Opzione","Option"]));
        return idxNum === optionIdx;
      });
      // b) match stringa su Indice (es. "1")
      if (!chosen) {
        chosen = options.find(r => {
          const raw = pick(r.fields || {}, ["Indice","Index","Opzione","Option"]);
          return String(raw).trim() === String(optionIdx);
        });
      }
      // c) consigliata
      if (!chosen) {
        chosen = options.find(r => !!pick(r.fields || {}, ["Consigliata","Recommended","consigliata"], false));
      }
      // d) min prezzo
      if (!chosen) {
        chosen = [...options].sort((a,b)=>{
          const pa = toNumber(pick(a.fields || {}, ["Prezzo","Price"]));
          const pb = toNumber(pick(b.fields || {}, ["Prezzo","Price"]));
          if (pa == null && pb == null) return 0;
          if (pa == null) return 1;
          if (pb == null) return -1;
          return pa - pb;
        })[0];
      }
      // e) prima disponibile
      if (!chosen) chosen = options[0];
    }

    if (!chosen) {
      console.warn("[accept] no option record found. Will send email with defaults.", { optionIdx, quoteId: rec.id });
    } else {
      console.log("[accept] chosen.option.fields:", chosen.fields);
    }

    // Normalizza per email (se non c’è chosen, opt con default e valuta del preventivo)
    const optNorm = chosen?.fields
      ? normalizeOption(chosen.fields, f?.Valuta || f?.Currency)
      : { index: optionIdx, carrier:"—", service:"—", incoterm:"—", payer:"—", price: undefined, currency: f?.Valuta || "EUR" };

    console.log("[accept] normalized option used in email:", optNorm);

    // 4) Email (best-effort, non blocca il 200)
    let emailResult = null;
    try {
      emailResult = await sendAcceptanceEmail({
        slug,
        fields: f,
        optionIdx,
        opt: optNorm,
      });
    } catch (e) {
      console.error("[accept] email error:", e);
    }

    return res.status(200).json({ ok:true, email: emailResult?.sent ? "sent" : "skipped" });
  } catch (err) {
    const status  = err.status || 500;
    const details = err.payload || { name: err.name, message: err.message, stack: err.stack };
    console.error("[api/quotes/accept] error:", details);
    return res.status(status).json({ ok:false, error: details });
  }
}
