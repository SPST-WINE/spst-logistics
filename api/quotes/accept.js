// api/quotes/accept.js

// ===== CORS (stessa logica di create.js) =====
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

// ===== Airtable =====
// api/quotes/accept.js
// Registra l'accettazione di un preventivo aggiornando SOLO i campi:
// Opzione_Accettata (number), Accettato_Il (date), Accettato_IP (text),
// Accettato_UA (text), Stato (single select -> "Accettato")

const AT_BASE  = process.env.AIRTABLE_BASE_ID;
const AT_PAT   = process.env.AIRTABLE_PAT;
const TB_QUOTE = process.env.TB_PREVENTIVI;   // es. "Preventivi"
const TB_OPT   = process.env.TB_OPZIONI;      // es. "OpzioniPreventivo"

async function atFetch(path, init = {}) {
  const url = `https://api.airtable.com/v0/${AT_BASE}/${path}`;
  const resp = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${AT_PAT}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok) {
    const err = new Error(json?.error?.message || `Airtable HTTP ${resp.status}`);
    err.status = resp.status;
    err.payload = json;
    throw err;
  }
  return json;
}

const toNum = (x) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : undefined;
};

async function getQuoteBySlug(slug) {
  const filter = encodeURIComponent(`{Slug_Pubblico}="${String(slug).replace(/"/g, '\\"')}"`);
  const data = await atFetch(`${encodeURIComponent(TB_QUOTE)}?filterByFormula=${filter}&maxRecords=1`);
  const rec = data.records?.[0];
  if (!rec) return null;
  return { id: rec.id, fields: rec.fields };
}

async function listOptionsForQuote(quoteId) {
  const filter = encodeURIComponent(`FIND("${quoteId}", ARRAYJOIN({Preventivo},""))`);
  const sort = encodeURIComponent('[{"field":"Indice","direction":"asc"}]');
  const data = await atFetch(`${encodeURIComponent(TB_OPT)}?filterByFormula=${filter}&sort=${sort}`);
  return data.records?.map((r) => ({ id: r.id, fields: r.fields })) || [];
}

function chooseOptionIndex({ requestedIndex, options }) {
  // 1) Se l'utente ha selezionato un indice esistente, usalo
  if (requestedIndex != null) {
    const idx = Number(requestedIndex);
    if (options.some((o) => Number(o.fields?.Indice) === idx)) return idx;
  }
  // 2) fallback: prezzo minore tra le opzioni con prezzo numerico
  const priced = options
    .map((o) => ({ idx: Number(o.fields?.Indice), price: toNum(o.fields?.Prezzo) }))
    .filter((x) => Number.isFinite(x.idx) && typeof x.price === "number");
  if (priced.length) {
    priced.sort((a, b) => a.price - b.price);
    return priced[0].idx;
  }
  return undefined;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method Not Allowed" });
    }
    if (!AT_BASE || !AT_PAT || !TB_QUOTE || !TB_OPT) {
      throw new Error("Missing env vars: AIRTABLE_BASE_ID / AIRTABLE_PAT / TB_PREVENTIVI / TB_OPZIONI");
    }

    const body = (req.body && typeof req.body === "object") ? req.body : JSON.parse(req.body || "{}");
    const { slug, optionIndex, tosAccepted } = body || {};

    if (!slug) return res.status(400).json({ ok: false, error: "Missing slug" });
    if (!tosAccepted) return res.status(400).json({ ok: false, error: "Devi accettare i termini" });

    // 1) Carica preventivo
    const quote = await getQuoteBySlug(slug);
    if (!quote) return res.status(404).json({ ok: false, error: "Preventivo non trovato" });

    const stato = String(quote.fields?.Stato || "").toLowerCase();
    if (stato === "accettato") {
      return res.status(409).json({ ok: false, error: "Preventivo già accettato" });
    }

    // 2) Carica opzioni e determina indice scelto
    const options = await listOptionsForQuote(quote.id);
    const chosenIdx = chooseOptionIndex({ requestedIndex: optionIndex, options });

    // 3) Aggiornamento su Airtable (SOLO i campi richiesti)
    const nowIso = new Date().toISOString();
    const ip =
      req.headers["x-forwarded-for"]?.split(",")?.[0]?.trim() ||
      req.headers["x-real-ip"] ||
      req.socket?.remoteAddress ||
      "";
    const ua = req.headers["user-agent"] || "";

    const fields = {
      Stato: "Accettato",
      Accettato_Il: nowIso,
      Accettato_IP: ip,
      Accettato_UA: ua,
      Opzione_Accettata: (chosenIdx != null ? Number(chosenIdx) : undefined),
    };
    Object.keys(fields).forEach((k) => fields[k] === undefined && delete fields[k]);

    await atFetch(encodeURIComponent(TB_QUOTE), {
      method: "PATCH",
      body: JSON.stringify({ records: [{ id: quote.id, fields }] }),
    });

    return res.status(200).json({ ok: true, optionIndex: chosenIdx, acceptedAt: nowIso });
  } catch (err) {
    const status = err.status || 500;
    console.error("[api/quotes/accept] error:", err.payload || err.stack || err);
    return res.status(status).json({ ok: false, error: err.payload || err.message || "Server error" });
  }
}
