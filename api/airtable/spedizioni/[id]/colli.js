// GET /api/airtable/spedizioni/:id/colli
// Ritorna { ok:true, rows:[{lunghezza_cm,larghezza_cm,altezza_cm,peso_kg,quantita}] }

export default async function handler(req, res){
  if (req.method === 'OPTIONS') return sendCORS(req, res);
  sendCORS(req, res);
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  try{
    const id = (req.query.id || '').toString();
    if(!id) return res.status(400).json({ error:'Missing record id' });

    const pat    = process.env.AIRTABLE_PAT;
    const baseId = process.env.AIRTABLE_BASE_ID;
    const table  = process.env.AIRTABLE_TABLE_COLLI
                || process.env.AIRTABLE_TABLE_SPED_COLLI
                || process.env.TB_COLLI
                || 'SPED_COLLI';
    assertEnv({ pat, baseId, table });

    const apiBase = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`;
    const headers = { Authorization: `Bearer ${pat}` };

    // 1) tentativi con vari nomi campo (case-sensitive)
    const candidateFieldNames = [
      process.env.AIRTABLE_COLLI_LINK_FIELD,  // <-- se lo imposti giusto, vince subito
      'Spedizione',
      'SPEDIZIONE',
      'Spedizioni',
      'Shipment',
      'Sped',
      'Spedizione (link)'
    ].filter(Boolean);

    for (const field of candidateFieldNames){
      const formula = `FIND("${id}", ARRAYJOIN({${field}} & ""))`;
      const url = `${apiBase}?${new URLSearchParams({ filterByFormula: formula, pageSize:'100' })}`;
      const r = await fetch(url, { headers });
      if (r.status === 422) continue; // campo inesistente, prova il prossimo
      if (!r.ok){
        const t = await r.text().catch(()=> '');
        // errori reali upstream → propaga
        return res.status(r.status).json({ error:'Airtable error', details:t });
      }
      const json = await r.json();
      const rows = normalizeRows(json.records || []);
      return res.status(200).json({ ok:true, rows });
    }

    // 2) fallback: scarica e filtra lato Node (indipendente dal nome campo)
    const rowsAll = await listAll(apiBase, headers);
    const mine = rowsAll.filter(rec => hasLinkedId(rec.fields || {}, id));
    const rows = normalizeRows(mine);
    return res.status(200).json({ ok:true, rows });

  }catch(e){
    console.error('[GET colli] error', e);
    return res.status(502).json({ error:'Upstream error', details:String(e?.message||e) });
  }
}

/* ───── helpers ───── */

function normalizeRows(recs){
  const toNum = (v)=> (v==null||v==='') ? null : Number(String(v).replace(',','.')) || null;
  return recs.map(r=>{
    const f = r.fields || {};
    return {
      lunghezza_cm: toNum(f['L_cm'] || f['Lunghezza'] || f['L'] || f['Lunghezza (cm)']),
      larghezza_cm: toNum(f['W_cm'] || f['Larghezza'] || f['W'] || f['Larghezza (cm)']),
      altezza_cm:   toNum(f['H_cm'] || f['Altezza']   || f['H'] || f['Altezza (cm)']),
      peso_kg:      toNum(f['Peso']  || f['Peso_Kg']   || f['Kg']|| f['Peso (kg)']) || 0,
      quantita:     Number(f['Quantita'] || f['Quantità'] || f['Qty'] || 1) || 1,
    };
  });
}

async function listAll(apiBase, headers){
  const out = [];
  let url = `${apiBase}?${new URLSearchParams({ pageSize:'100' })}`;
  for(let i=0;i<10;i++){ // limite sicurezza
    const r = await fetch(url, { headers });
    if (!r.ok) {
      const t = await r.text().catch(()=> '');
      throw new Error(`Airtable ${r.status}: ${t}`);
    }
    const json = await r.json();
    out.push(...(json.records || []));
    if (!json.offset) break;
    url = `${apiBase}?${new URLSearchParams({ pageSize:'100', offset: json.offset })}`;
  }
  return out;
}

function hasLinkedId(fields, id){
  // true se QUALSIASI campo è un array che contiene l'id (tipico dei linked records)
  for (const v of Object.values(fields)){
    if (Array.isArray(v) && v.some(x => typeof x === 'string' && x.startsWith('rec'))) {
      if (v.includes(id)) return true;
    }
  }
  return false;
}

function sendCORS(req,res){
  const origin = req.headers.origin || '';
  const list = (process.env.ORIGIN_ALLOWLIST || '*').split(',').map(s=>s.trim()).filter(Boolean);
  const allowed = list.includes('*') || (!origin) || list.some(p => safeWildcardMatch(origin, p));
  if (allowed && origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age','600');
  if (req.method === 'OPTIONS') return res.status(204).end();
}
function safeWildcardMatch(input, pattern){
  if (pattern === '*') return true;
  const rx = '^' + pattern.split('*').map(escapeRegex).join('.*') + '$';
  return new RegExp(rx).test(input);
}
function escapeRegex(str){ return str.replace(/[|\\{}()[\]^$+?.]/g, '\\$&'); }
function assertEnv({ pat, baseId, table }){ if(!pat) throw new Error('AIRTABLE_PAT missing'); if(!baseId) throw new Error('AIRTABLE_BASE_ID missing'); if(!table) throw new Error('AIRTABLE_TABLE missing'); }
