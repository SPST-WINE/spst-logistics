// api/quotes/accept.js

/* ====================== CORS ====================== */
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

/* =================== Airtable ENV ================== */
const AT_BASE  = process.env.AIRTABLE_BASE_ID;
const AT_PAT   = process.env.AIRTABLE_PAT;
const TB_QUOTE = process.env.TB_PREVENTIVI;   // es. "Preventivi"
const TB_OPT   = process.env.TB_OPZIONI;      // es. "OpzioniPreventivo"

/* =================== Airtable utils =================== */
async function atFetch(url) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${AT_PAT}` } });
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const e = new Error(j?.error?.message || "Airtable error");
    e.status = r.status; e.payload = j; throw e;
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
  const json = await resp.json().catch(() => null);
  if (!resp.ok) {
    const err = new Error(json?.error?.message || "Airtable error");
    err.status = resp.status; err.payload = json; throw err;
  }
  return json;
}
const toNumber = (x) => { const n = Number(x); return Number.isFinite(n) ? n : undefined; };
function money(n, curr="EUR"){
  const num = Number(n);
  if (!Number.isFinite(num)) return "—";
  try { return new Intl.NumberFormat("it-IT", { style:"currency", currency:curr }).format(num); }
  catch { return `${num.toFixed(2)} ${curr}`; }
}
const escapeHtml = (s="") => String(s).replace(/[&<>"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[m]));

/* -------- Opzioni del preventivo collegate al record -------- */
async function fetchOptionsForQuote(quoteId) {
  const base = `https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(TB_OPT)}`;
  const sort = `&sort[0][field]=Indice&sort[0][direction]=asc`;

  // 1) via campo testo Preventivo_Id
  let url = `${base}?filterByFormula=${encodeURIComponent(`{Preventivo_Id}='${quoteId}'`)}${sort}`;
  try {
    const j = await atFetch(url);
    if (Array.isArray(j.records) && j.records.length) return j.records;
  } catch {}

  // 2) fallback su linked record {Preventivo}
  url = `${base}?filterByFormula=${encodeURIComponent(`FIND('${quoteId}', ARRAYJOIN({Preventivo}))`)}${sort}`;
  const j = await atFetch(url);
  return j.records || [];
}

/* =================== Email (Resend) =================== */
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const MAIL_FROM = process.env.MAIL_FROM || "SPST Notifications <notification@spst.it>";
const PUBLIC_QUOTE_BASE_URL = (process.env.PUBLIC_QUOTE_BASE_URL || "https://spst-logistics.vercel.app/quote").replace(/\/$/,"");

function buildEmailHtml({ fields, optionIdx, optionFields, quoteUrl }) {
  const brand  = "#f7911e";
  const label  = "#6b7280";
  const text   = "#111111";
  const border = "#e8e8e8";
  const bg     = "#ffffff";
  const outerBg= "#f6f7fb";

  const row = (k, v) => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid ${border};color:${label};width:34%;font:500 13px/1.3 system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial">${escapeHtml(k)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid ${border};color:${text};font:600 13px/1.3 system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial">${v}</td>
    </tr>`;

  const rows = [
    row("Opzione", escapeHtml(String(optionIdx))),
    row("Cliente", `<a style="color:${text};text-decoration:underline" href="mailto:${escapeHtml(fields?.Email_Cliente||"")}">${escapeHtml(fields?.Email_Cliente||"—")}</a>`),
    row("Corriere", escapeHtml(optionFields?.Corriere || "—")),
    row("Servizio", escapeHtml(optionFields?.Servizio || "—")),
    row("Incoterm", escapeHtml(optionFields?.Incoterm || "—")),
    row("Oneri a carico", escapeHtml(optionFields?.Oneri_A_Carico || "—")),
    row("Prezzo", escapeHtml(money(optionFields?.Prezzo, optionFields?.Valuta || fields?.Valuta))),
    row("Link preventivo", `<a style="color:${text};text-decoration:underline" href="${quoteUrl}" target="_blank" rel="noopener">${escapeHtml(quoteUrl)}</a>`),
  ].join("");

  return `
  <div style="background:${outerBg};padding:24px">
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
          <div style="font:600 
