// api/tools/docs.js — Pages Router (Node runtime)
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).send('Method Not Allowed');
  }

  const html = String.raw/*html*/`<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Utility Documenti</title>
  <link rel="icon" href="https://cdn.prod.website-files.com/6800cc3b5f399f3e2b7f2ffa/6859a72cac2c0604fbd192e3_favicon.ico" />
  <style>
    :root{
      --bg:#0b1220; --card:#0f172a; --muted:#8ea0bd; --text:#e7ecf5;
      --accent:#ff9a1f; --accent2:#ffb54f; --line:rgba(255,255,255,.10);
      --shadow:0 12px 36px rgba(0,0,0,.35);
      --r:18px; --rsm:12px; --gap:14px; --w:760px;
      --ok:#29b37e; --err:#e57373;
    }
    *{box-sizing:border-box} html,body{height:100%}
    body{
      margin:0; color:var(--text);
      background:radial-gradient(1200px 600px at 20% -10%, #11213f 0%, rgba(17,33,63,0) 60%), var(--bg);
      font:16px/1.45 system-ui, Segoe UI, Inter, Roboto, sans-serif;
      display:flex; align-items:flex-start; justify-content:center; padding:32px 16px 60px;
    }
    .wrap{width:min(var(--w),100%)}
    .page-title{font-size:clamp(26px,3.2vw,34px);font-weight:800;letter-spacing:.2px;margin:6px 0 6px}
    .page-sub{color:var(--muted);margin:0 0 18px;max-width:70ch}
    .card{
      background:linear-gradient(180deg,rgba(255,255,255,.02),rgba(255,255,255,.01)),var(--card);
      border:1px solid var(--line); border-radius:var(--r); box-shadow:var(--shadow); padding:18px; width:100%;
      overflow:hidden;
    }
    .row{display:grid;grid-template-columns:1fr;gap:var(--gap)}
    @media (min-width:760px){ .row.cols-2{grid-template-columns:1.2fr .8fr} }
    .field{display:flex;flex-direction:column;gap:8px}
    label{color:var(--muted);font-weight:600;letter-spacing:.2px}
    input,select{
      width:100%; border:1px solid var(--line); background:#0b1328; color:var(--text);
      border-radius:var(--rsm); padding:12px 14px; outline:none;
      transition:border-color .15s, box-shadow .15s;
    }
    input:focus,select:focus{border-color:rgba(255,154,31,.6);box-shadow:0 0 0 4px rgba(255,154,31,.15)}
    .actions{margin-top:8px;display:flex;gap:10px}
    .btn{
      -webkit-tap-highlight-color: transparent;
      border:0; cursor:pointer; width:100%; padding:14px 18px; border-radius:14px;
      color:#131313; font-weight:800; letter-spacing:.3px; font-size:15px;
      background:linear-gradient(180deg,var(--accent),var(--accent2));
      box-shadow:0 10px 22px rgba(255,154,31,.28), inset 0 1px 0 rgba(255,255,255,.35);
      transition:transform .06s, filter .15s, box-shadow .15s;
    }
    .btn:hover{filter:brightness(1.03)} .btn:active{transform:translateY(1px)}
    .btn[disabled]{opacity:.55;cursor:not-allowed;filter:grayscale(.2)}
    .note{margin-top:10px;font-size:13.5px;color:var(--muted);padding:10px 12px;border:1px dashed var(--line);border-radius:12px}

    .result{
      margin-top:14px; border:1px solid rgba(41,179,126,.35); background:rgba(41,179,126,.08);
      color:#cfe0ff; border-radius:12px; padding:10px 12px;
    }
    .result.err{border-color: rgba(229,115,115,.45); background: rgba(229,115,115,.06);}
    .result pre{margin:8px 0 0;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;font-size:13.5px;color:#e7eefc}
    .result-actions{display:flex; gap:10px; margin-top:10px}
    .chip{
      display:inline-flex; align-items:center; gap:8px; padding:10px 12px; border-radius:12px; cursor:pointer; text-decoration:none;
      background:#121b33; border:1px solid var(--line); color:#e7ecf5; font-weight:700; font-size:13.5px;
      transition:transform .06s, filter .15s, border-color .15s;
    }
    .chip:hover{filter:brightness(1.05); border-color:rgba(255,255,255,.16)}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="page-title">Utility Documenti</div>
    <div class="page-sub">Utilizza questo tool per creare <strong>Fattura proforma</strong>, <strong>Fattura commerciale</strong> e <strong>Dichiarazione libera esportazione</strong>.</div>

    <div class="card">
      <div class="row cols-2">
        <div class="field">
          <label for="idsped">ID Spedizione</label>
          <input id="idsped" placeholder="es. SP-2025-09-04-2000" />
        </div>
        <div class="field">
          <label for="tipo">Tipo documento</label>
          <select id="tipo">
            <option value="proforma">Proforma</option>
            <option value="fattura">Fattura commerciale</option>
            <option value="dle">Dichiarazione libera esportazione</option>
            <option value="pl">Packing list</option>
          </select>
        </div>
      </div>

      <div class="actions"><button id="go" class="btn">Genera e allega</button></div>
      <div class="note">Nota: l’URL firmato scade in ~10 minuti; l’allegato viene salvato su Airtable.</div>

      <div id="out" class="result" style="display:none"></div>
      <div id="outActions" class="result-actions" style="display:none">
        <a id="openBtn" class="chip" target="_blank" rel="noopener">Apri PDF generato</a>
        <button id="copyBtn" class="chip" type="button">Copia URL</button>
      </div>
    </div>
  </div>

<script>
  (function(){
    const $ = (s, r=document)=>r.querySelector(s);
    const idEl = $('#idsped'), typeEl = $('#tipo'), go = $('#go');
    const out = $('#out'), actions = $('#outActions'), openBtn = $('#openBtn'), copyBtn = $('#copyBtn');

    function show(msg, ok=true, data){
      out.style.display = 'block';
      out.classList.toggle('err', !ok);
      out.innerHTML = (ok ? 'Documento generato e allegato ✓' : 'Errore') + 
        (msg ? '<pre>'+msg+'</pre>' : '');
      if (ok && data?.viewUrl){
        actions.style.display = 'flex';
        openBtn.href = data.viewUrl;
        copyBtn.onclick = () => {
          navigator.clipboard.writeText(data.viewUrl).then(()=> {
            copyBtn.textContent = 'Copiato!';
            setTimeout(()=>copyBtn.textContent='Copia URL', 1000);
          });
        };
      } else {
        actions.style.display = 'none';
      }
    }
    function pretty(obj){ try { return JSON.stringify(obj,null,2) } catch { return String(obj) } }
    function valid(){ const v=(idEl.value||'').trim(); go.disabled=!v; return !!v; }
    idEl.addEventListener('input', valid); valid();

    go.addEventListener('click', async ()=>{
      if (!valid()) return;
      go.disabled = true;
      actions.style.display='none'; out.style.display='none';

      const idSpedizione = idEl.value.trim();
      const type = typeEl.value;

      try{
        const r = await fetch('/api/docs/unified/generate', {
          method:'POST',
          headers:{ 'Content-Type':'application/json' },
          body: JSON.stringify({ idSpedizione, type })
        });
        const text = await r.text();
        let json = null; try{ json = JSON.parse(text) }catch{}
        console.log('[UI] /generate =>', r.status, r.statusText, text);

        if (!r.ok || (json && json.ok===false)) {
          show((json?.error || ('HTTP '+r.status+' '+r.statusText)) + "\\n\\nDettagli:\\n" + text, false);
          return;
        }
        show('\\nDettagli:\\n' + pretty(json), true, json);
      }catch(e){
        console.error(e);
        show(String(e?.message||e), false);
      }finally{
        go.disabled = false;
      }
    });
  })();
</script>
</body>
</html>`;
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  return res.status(200).send(html);
}
