// api/quotes/accept.js

/* ===== CORS (come create.js) ===== */
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

/* ===== Airtable ===== */
const AT_BASE  = process.env.AIRTABLE_BASE_ID;
const AT_PAT   = process.env.AIRTABLE_PAT;
const TB_QUOTE = process.env.TB_PREVENTIVI;   // Preventivi
const TB_OPT   = process.env.TB_OPZIONI;      // OpzioniPreventivo

async function atFetch(url) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${AT_PAT}` } });
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const e = new Error(j?.error?.message || `Airtable ${r.status}`);
    e.status = r.status;
    e.payload = j;
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
  const json = await resp.json().catch(() => null);
  if (!resp.ok) {
    const err = new Error(json?.error?.message || "Airtable error");
    err.status = resp.status;
    err.payload = json;
    throw err;
  }
  return json;
}
const toNumber = (x) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : undefined;
};
function money(n, curr="EUR"){
  const num = Number(n);
  if (!Number.isFinite(num)) return "—";
  try { return new Intl.NumberFormat("it-IT", { style:"currency", currency:curr }).format(num); }
  catch { return `${num.toFixed(2)} ${curr}`; }
}
const pick = (obj, keys, fallback="") => {
  for (const k of keys) {
    if (obj && obj[k] != null && obj[k] !== "") return obj[k];
  }
  return fallback;
};
function escapeHtml(s=""){
  return String(s).replace(/[&<>"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[m]));
}

/* Opzioni del preventivo (prima campo testo Preventivo_Id, poi fallback su linked) */
async function fetchOptionsForQuote(quoteId) {
  const base = `https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(TB_OPT)}`;
  const sort = `&sort[0][field]=Indice&sort[0][direction]=asc`;

  // 1) campo testo (usa DOPPI apici nelle formule Airtable)
  let url = `${base}?filterByFormula=${encodeURIComponent(`{Preventivo_Id} = "${quoteId}"`)}${sort}`;
  try {
    const j = await atFetch(url);
    if (Array.isArray(j.records) && j.records.length) return j.records;
  } catch {}

  // 2) fallback sul linked
  url = `${base}?filterByFormula=${encodeURIComponent(`FIND("${quoteId}", ARRAYJOIN({Preventivo}))`)}${sort}`;
  const j = await atFetch(url);
  return j.records || [];
}

/* ===== Email (Resend) ===== */
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const MAIL_FROM = process.env.MAIL_FROM || "SPST Notifications <notification@spst.it>";
const PUBLIC_QUOTE_BASE_URL = (process.env.PUBLIC_QUOTE_BASE_URL || "https://spst-logistics.vercel.app/quote").replace(/\/$/,"");

/* Normalizzazione campi opzione (indipendente dai nomi in Airtable) */
function normalizeOptionFields(x) {
  const f = x || {};
  const priceRaw = pick(f, ["Prezzo","price","Price"]);
  const price = Number(priceRaw);
  const data = {
    index   : toNumber(pick(f, ["Indice","Opzione","Index","Option"])),
    carrier : pick(f, ["Corriere","Carrier","carrier"], "—"),
    service : pick(f, ["Servizio","Service","service"], "—"),
    transit : pick(f, ["Tempo_Resa","Tempo di resa previsto","Tempo resa previsto","Transit","transit"], "—"),
    incoterm: pick(f, ["Incoterm","incoterm"], "—"),
    payer   : pick(f, ["Oneri_A_Carico","Oneri a carico di","Payer","payer"], "—"),
    price   : Number.isFinite(price) ? price : undefined,
    currency: pick(f, ["Valuta","Currency","currency"], "EUR"),
  };
  return data;
}

function buildEmailHtml({ fields, optionIdx, optionData, quoteUrl }) {
  const brand = "#f7911e";
  const label = "#6b7280";
  const text  = "#111111";
  const border = "#e8e8e8";
  const bg = "#ffffff";
  const outerBg = "#f6f7fb";

  const row = (k, v) => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid ${border};color:${label};width:34%;font:500 13px/1.3 system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial">${escapeHtml(k)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid ${border};color:${text};font:600 13px/1.3 system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial">${v}</td>
    </tr>`;

  const rows = [
    row("Opzione", escapeHtml(String(optionIdx))),
    row("Cliente", `<a style="color:${text};text-decoration:underline" href="mailto:${escapeHtml(fields?.Email_Cliente||"")}">${escapeHtml(fields?.Email_Cliente||"—")}</a>`),
    row("Corriere", escapeHtml(optionData.carrier || "—")),
    row("Servizio", escapeHtml(optionData.service || "—")),
    row("Incoterm", escapeHtml(optionData.incoterm || "—")),
    row("Oneri a carico", escapeHtml(optionData.payer || "—")),
    row("Prezzo", escapeHtml(money(optionData.price, optionData.currency))),
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

async function sendAcceptanceEmail({ slug, fields, optionIdx, optionData }) {
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

  const subject = `Conferma accettazione preventivo • Opzione ${optionIdx}`;
  const quoteUrl = `${PUBLIC_QUOTE_BASE_URL}/${encodeURIComponent(slug)}`;

  const textLines = [
    "Preventivo accettato!",
    "",
    "Dettagli:",
    `Opzione: ${optionIdx}`,
    `Cliente: ${fields?.Email_Cliente || "—"}`,
    `Corriere: ${optionData.carrier || "—"}`,
    `Servizio: ${optionData.service || "—"}`,
    `Incoterm: ${optionData.incoterm || "—"}`,
    `Oneri a carico: ${optionData.payer || "—"}`,
    `Prezzo: ${money(optionData.price, optionData.currency)}`,
    "",
    `Link preventivo: ${quoteUrl}`,
    "",
    "Per supporto WhatsApp: +39 320 144 1789",
  ].join("\n");

  const html = buildEmailHtml({ fields, optionIdx, optionData, quoteUrl });

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: MAIL_FROM,
      to,
      subject,
      html,
      text: textLines,
    }),
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok) {
    console.error("[accept] email send failed:", json || resp.statusText);
    return { sent:false, status:resp.status, payload:json };
  }
  return { sent:true, payload:json };
}

/* ===== Handler ===== */
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
    const option = toNumber(body.option) ?? toNumber(body.optionIndex);
    if (!slug || !option) return res.status(400).json({ ok:false, error:"Missing slug/option" });

    // 1) preventivo per slug
    const qUrl = `https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(TB_QUOTE)}?filterByFormula=${encodeURIComponent(`{Slug_Pubblico} = "${slug}"`)}`;
    const q = await atFetch(qUrl);
    const rec = q.records?.[0];
    if (!rec) return res.status(404).json({ ok:false, error:"Quote not found" });

    const f = rec.fields || {};
    const already = f.Opzione_Accettata;
    if (already && Number(already) !== option) {
      return res.status(409).json({ ok:false, error:"Quote already accepted with a different option" });
    }

    // 2) aggiorna il preventivo
    const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
    const ua = String(req.headers["user-agent"] || "");
    await atUpdate(TB_QUOTE, [{
      id: rec.id,
      fields: {
        Opzione_Accettata: option,
        Accettato_Il     : new Date().toISOString(),
        Accettato_IP     : ip || undefined,
        Accettato_UA     : ua || undefined,
        Stato            : "Accettato",
      },
    }]);

    // 3) leggi l'opzione accettata e normalizza (best-effort)
    let optionData = {
      index: option,
      carrier: "—", service: "—", incoterm: "—", payer: "—", price: undefined, currency: f.Valuta || "EUR"
    };
    try {
      const options = await fetchOptionsForQuote(rec.id);
      // match per Indice oppure Opzione/Index
      let match = options.find(r => Number(r.fields?.Indice) === option);
      if (!match) match = options.find(r => Number(r.fields?.Opzione) === option);
      if (!match) match = options.find(r => Number(r.fields?.Index) === option);
      if (match) optionData = normalizeOptionFields(match.fields);
    } catch (e) {
      console.warn("[accept] could not load options:", e?.payload?.error || e.message);
    }

    // 4) email (non blocca il 200 se fallisce)
    let emailResult = null;
    try {
      emailResult = await sendAcceptanceEmail({
        slug,
        fields: f,
        optionIdx: option,
        optionData,
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
