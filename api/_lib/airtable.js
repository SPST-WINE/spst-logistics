// api/_lib/airtable.js
// ESM module (coerente con il tuo file attuale)

const BASE_ID = process.env.AIRTABLE_BASE_ID;         // es. appwnx59j8NJ1x5ts
const TOKEN   = process.env.AIRTABLE_TOKEN            // PAT Airtable (o AIRTABLE_PAT)
             || process.env.AIRTABLE_PAT;

export const TB_PREVENTIVI = process.env.TB_PREVENTIVI || "Preventivi";
export const TB_OPZIONI    = process.env.TB_OPZIONI    || "OpzioniPreventivo";

// 🚚 Nuove tabelle per spedizioni WebApp
// 👇 Alias di compatibilità: se il codice altrove usa ancora TB_SPEDIZIONI, lo reindirizziamo
export const TB_SPEDIZIONI_WEBAPP = process.env.TB_SPEDIZIONI_WEBAPP || "SpedizioniWebApp";
export const TB_SPEDIZIONI = process.env.USE_NEW_SHIPMENTS_TABLE ? TB_SPEDIZIONI_WEBAPP : "SPEDIZIONI";


export function apiUrl(table) {
  return `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}`;
}

export async function atFetch(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers || {})
    }
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Airtable ${res.status}: ${txt || res.statusText}`);
  }
  return res.json();
}

// ---------- CRUD generici ----------

export async function createRecord(table, fields) {
  const data = await atFetch(apiUrl(table), {
    method: "POST",
    body: JSON.stringify({ records: [{ fields }] })
  });
  return data.records[0];
}

export async function createRecords(table, records) {
  if (!records?.length) return [];
  const data = await atFetch(apiUrl(table), {
    method: "POST",
    body: JSON.stringify({ records })
  });
  return data.records;
}

export async function getRecord(table, id) {
  return atFetch(`${apiUrl(table)}/${id}`);
}

export async function updateRecord(table, id, fields) {
  const data = await atFetch(apiUrl(table), {
    method: "PATCH",
    body: JSON.stringify({ records: [{ id, fields }] })
  });
  return data.records?.[0];
}

export async function updateRecords(table, records /* [{id, fields}] */) {
  if (!records?.length) return [];
  const data = await atFetch(apiUrl(table), {
    method: "PATCH",
    body: JSON.stringify({ records })
  });
  return data.records;
}

/**
 * Lista con supporto a filterByFormula, sort, pageSize e pagination via offset
 */
export async function listRecords(table, {
  filterByFormula,
  sort = [],             // es. [{field:"Ritiro - Data", direction:"desc"}]
  pageSize = 50,
  maxRecords,            // opzionale
  fields,                // opzionale: ["Stato", "Creato da", ...]
  offset,                // opzionale: pagina successiva
} = {}) {
  const params = new URLSearchParams();
  if (filterByFormula) params.set("filterByFormula", filterByFormula);
  if (fields?.length) fields.forEach((f) => params.append("fields[]", f));
  if (sort?.length) sort.forEach((s, i) => {
    params.set(`sort[${i}][field]`, s.field);
    if (s.direction) params.set(`sort[${i}][direction]`, s.direction);
  });
  if (pageSize) params.set("pageSize", String(pageSize));
  if (maxRecords) params.set("maxRecords", String(maxRecords));
  if (offset) params.set("offset", offset);

  const url = `${apiUrl(table)}?${params.toString()}`;
  return atFetch(url);
}

// ---------- Helper utili ----------

/**
 * pick: ritorna il primo valore non vuoto tra più alias campo
 */
export function pick(fields, ...names) {
  for (const n of names) {
    if (n in fields && fields[n] != null && fields[n] !== "") return fields[n];
  }
  return undefined;
}

/**
 * Escape per stringhe dentro formula Airtable (singoli apici)
 */
export function escFormulaStr(v) {
  return String(v ?? "").replace(/'/g, "\\'");
}

// Back-compat: funzione già presente nel tuo file
export async function findFirstByEmail(table, fieldName, email) {
  const formula = `LOWER({${fieldName}})='${escFormulaStr(String(email).toLowerCase())}'`;
  const url = `${apiUrl(table)}?maxRecords=1&filterByFormula=${encodeURIComponent(formula)}`;
  const json = await atFetch(url);
  return json.records?.[0] || null;
}
