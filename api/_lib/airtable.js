const BASE_ID = process.env.AIRTABLE_BASE_ID;        // es. appwnx59j8NJ1x5ts
const TOKEN   = process.env.AIRTABLE_TOKEN;           // PAT Airtable
export const TB_PREVENTIVI = process.env.TB_PREVENTIVI || "Preventivi";
export const TB_OPZIONI    = process.env.TB_OPZIONI    || "OpzioniPreventivo";

function apiUrl(table) {
  return `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}`;
}

async function atFetch(url, init={}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers || {})
    }
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Airtable ${res.status}: ${txt}`);
  }
  return res.json();
}

export async function createRecord(table, fields) {
  const data = await atFetch(apiUrl(table), {
    method: "POST",
    body: JSON.stringify({ records: [{ fields }] })
  });
  return data.records[0];
}

export async function createRecords(table, records) {
  if (!records.length) return [];
  const data = await atFetch(apiUrl(table), {
    method: "POST",
    body: JSON.stringify({ records })
  });
  return data.records;
}

export async function findFirstByEmail(table, fieldName, email) {
  const formula = `LOWER({${fieldName}})='${String(email).toLowerCase().replace(/'/g,"\\'")}'`;
  const url = `${apiUrl(table)}?maxRecords=1&filterByFormula=${encodeURIComponent(formula)}`;
  const json = await atFetch(url);
  return json.records?.[0] || null;
}
