// /api/airtable/spedizioni/[id]/colli.js

export default async function handler(req, res){
  if (req.method === 'OPTIONS') return sendCORS(req, res);
  sendCORS(req, res);
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  try{
    const id = (req.query.id || '').toString();
    if(!id) return res.status(400).json({ error:'Missing record id' });

    // ✅ env compatibili col tuo setup
    const pat    = process.env.AIRTABLE_PAT || process.env.AIRTABLE_TOKEN;
    const baseId = process.env.AIRTABLE_BASE_ID;

    const TB_SPED =
      process.env.TB_SPEDIZIONI_WEBAPP ||
      process.env.AIRTABLE_TABLE_SPEDIZIONI_WEBAPP ||
      process.env.AIRTABLE_TABLE ||
      'SpedizioniWebApp';

    const TB_COLLI =
      process.env.TB_SPED_COLLI ||
      process.env.AIRTABLE_TABLE_SPED_COLLI ||
      process.env.AIRTABLE_TABLE_COLLI ||
      process.env.TB_COLLI ||
      'SPED_COLLI';

    assertEnv({ pat, baseId, table: TB_COLLI });

    const api = (t)=>`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(t)}`;
    const headers = { Authorization: `Bearer ${pat}` };

    /* A) prova a leggere gli ID dei colli direttamente dal record spedizione */
    let linkedIds = [];
    try{
      const r = await fetch(`${api(TB_SPED)}/${encodeURIComponent(id)}`, { headers });
      if (r.ok){
        const rec = await r.json();
        const f = rec?.fields || {};
        // se esiste un campo link "COLLI" usalo subito, altrimenti prendi il primo array di recId che sembri legato ai colli
        const preferred = f['COLLI'];
        if (Array.isArray(preferred) && preferred.every(x=>typeof x==='string' && x.startsWith('rec'))){
          linkedIds = preferred;
        } else {
          const candidates = Object.entries(f)
            .filter(([k,v]) => Array.isArray(v) && v.every(x=>typeof x==='string' && x.startsWith('rec')))
            .sort((a,b) => (/(coll|coli|collo)/i.test(b[0])?1:0) - (/(coll|coli|collo)/i.test(a[0])?1:0));
          if (candidates.length) linkedIds = candidates[0][1];
        }
      }
    }catch{/* ignore */}

    if (linkedIds.length){
      const rows = await fetchColliByIds(api(TB_COLLI), headers, linkedIds);
      return res.status(200).json({ ok:true, rows: normalizeRows(rows) });
    }

    /* B) fallback: cerca in TB_COLLI filtrando per link testo/array */
    const candidateFieldNames = [
      process.env.AIRTABLE_COLLI_LINK_FIELD, // se specificato a env, è prioritario
      'Spedizione','SPEDIZIONE','Spedizioni','Shipment','Sped'
    ].filter(Boolean);

    for (const field of candidateFieldNames){
      const formula = `FIND("${id}", ARRAYJOIN({${field}} & ""))`;
      const url = `${api(TB_COLLI)}?${new URLSearchParams({ filterByFormula: formula, pageSize:'100' })}`;
      const r = await fetch(url, { headers });
      if (r.status === 422) continue; // il campo non esiste in questa base
      if (!r.ok){
        const t = await r.text().catch(()=> '');
        return res.status(r.status).json({ error:'Airtable error', details:t });
      }
      const json = await r.json();
      return res.status(200).json({ ok:true, rows: normalizeRows(json.records || []) });
    }

    // C) ultimo fallback: lista tutto e filtra lato Node sugli array di recId
    const all = await listAll(`${api(TB_COLLI)}?pageSize=100`, headers);
    const mine = all.filter(r => hasLinkedId(r.fields||{}, id));
    return res.status(200).json({ ok:true, rows: normalizeRows(mine) });

  }catch(e){
    console.error('[GET colli] error', e);
    return res.status(502).json({ error:'Upstream error', details:String(e?.message||e) });
  }
}

/* ───── helpers ───── */

async function fetchColliByIds(apiBase, headers, ids){
  const out = [];
  const chunk = (arr,n)=>arr.length<=n?[arr]:arr.reduce((a,_,i)=>i%n? a : [...a, arr.slice(i,i+n)],[]);
  for (const group of chunk(ids, 15)){
    const or = `OR(${group.map(x=>`RECORD_ID()="${x}"`).join(',')})`;
    const url = `${apiBase}?${new URLSearchParams({ filterByFormula: or, pageSize:'50' })}`;
    const r = await fetch(url, { headers });
    if (!r.ok){
      const t = await r.text().catch(()=> '');
      throw new Error(`Airtable ${r.status}: ${t}`);
    }
    const j = await r.json();
    out.push(...(j.records||[]));
  }
  return out;
}

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

async function listAll(url, headers){
  const out = [];
  for(let i=0;i<20;i++){
    const r = await fetch(url, { headers });
    if (!r.ok){
      const t = await r.text().catch(()=> '');
      throw new Error(`Airtable ${r.status}: ${t}`);
    }
    const j = await r.json();
    out.push(...(j.records||[]));
    if (!j.offset) break;
    const u = new URL(url); u.searchParams.set('offset', j.offset); url = u.toString();
  }
  return out;
}

function hasLinkedId(fields, id){
  for (const v of Object.values(fields)){
    if (Array.isArray(v) && v.length && v.every(x=>typeof x==='string' && x.startsWith('rec')) && v.includes(id)) return true;
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
