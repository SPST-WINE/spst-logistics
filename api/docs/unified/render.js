// api/docs/unified/render.js
import crypto from 'node:crypto';

const SECRET = process.env.DOCS_SIGN_SECRET || '';

function canonical(params) {
  const keys = ['sid', 'type', 'exp', 'ship'];
  return keys
    .filter((k) => params[k] !== undefined && params[k] !== null)
    .map((k) => `${k}=${encodeURIComponent(String(params[k]))}`)
    .join('&');
}
function sign(params) {
  return crypto.createHmac('sha256', SECRET).update(canonical(params)).digest('hex');
}

function docLabels(type) {
  switch (type) {
    case 'fattura': return { title: 'Fattura commerciale', watermark: 'FATTURA', meta: 'Commercial Invoice' };
    case 'dle':     return { title: 'Dichiarazione libera esportazione', watermark: 'DLE', meta: 'Export Free Declaration' };
    default:        return { title: 'Fattura proforma', watermark: 'PROFORMA', meta: 'Proforma Invoice' };
  }
}

function htmlTemplate({ type, ship, nowISO }) {
  const { title, watermark, meta } = docLabels(type);
  const today = new Date(nowISO).toLocaleDateString('it-IT');
  const time  = new Date(nowISO).toLocaleTimeString('it-IT');

  return `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${meta} — Anteprima</title>
  <style>
    :root{
      --brand:#111827; --accent:#0ea5e9; --text:#0b0f13; --muted:#6b7280;
      --border:#e5e7eb; --border-strong:#d1d5db; --bg:#ffffff; --zebra:#fafafa; --chip:#f3f4f6;
    }
    *{box-sizing:border-box}
    html,body{margin:0;background:var(--bg);color:var(--text);font-family:Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;}
    .page{width:210mm; min-height:297mm; margin:0 auto; padding:18mm 16mm; position:relative;}

    .watermark{position:absolute; inset:0; display:flex; align-items:center; justify-content:center; pointer-events:none}
    .watermark span{opacity:0.05; font-size:120px; letter-spacing:0.22em; transform:rotate(-24deg); font-weight:800; color:#0f172a}

    header{display:grid; grid-template-columns:1fr auto; align-items:start; gap:16px}
    .brand{max-width:70%}
    .tag{display:inline-block; font-size:10px; text-transform:uppercase; letter-spacing:.08em; color:#374151; background:var(--chip); border:1px solid var(--border); padding:2px 6px; border-radius:6px; margin-bottom:6px}
    .logo{display:flex; align-items:center; gap:10px}
    .logo .word{font-size:26px; font-weight:800; letter-spacing:.01em; color:var(--brand)}
    .brand .meta{margin-top:6px; font-size:12px; color:var(--muted)}

    .doc-meta{ text-align:right; font-size:12px; border:1px solid var(--border); border-radius:10px; padding:10px; min-width:260px}
    .doc-meta .title{font-size:12px; letter-spacing:.08em; text-transform:uppercase; color:var(--accent); font-weight:800}
    .doc-meta .kv{margin-top:6px}
    .kv div{margin:2px 0}

    hr.sep{border:none;border-top:1px solid var(--border); margin:16px 0 18px}

    .grid{display:grid; grid-template-columns:1fr 1fr; gap:12px}
    .card{border:1px solid var(--border); border-radius:12px; padding:12px}
    .card h3{margin:0 0 8px; font-size:11px; color:#374151; text-transform:uppercase; letter-spacing:.08em}
    .small{font-size:12px; color:#374151}
    .muted{color:var(--muted)}

    table.items{width:100%; border-collapse:collapse; font-size:12px; margin-top:16px}
    table.items th, table.items td{border-bottom:1px solid var(--border); padding:9px 8px; vertical-align:top}
    table.items thead th{font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#374151; text-align:left; background:var(--chip)}
    table.items td.num, table.items th.num{text-align:right}
    table.items tbody tr:nth-child(odd){background:var(--zebra)}
    table.items tbody tr:last-child td{border-bottom:1px solid var(--border-strong)}

    .totals{margin-top:10px; display:flex; justify-content:flex-end}
    .totals table{font-size:12px; border-collapse:collapse; min-width:260px}
    .totals td{padding:8px 10px; border-bottom:1px solid var(--border)}
    .totals tr:last-child td{border-top:1px solid var(--border-strong); border-bottom:none; font-weight:700}

    footer{margin-top:22px; font-size:11px; color:#374151}
    .legal{margin-top:10px}
    .sign{margin-top:20px; display:flex; justify-content:space-between; align-items:flex-end; gap:16px}
    .sign .box{height:64px; border:1px dashed var(--border-strong); border-radius:10px; width:260px}
    .sign .sig{display:flex; flex-direction:column; align-items:flex-start}
    .sign .label{font-size:11px; color:#374151; margin-bottom:6px}

    @media print{ body{background:#fff} .page{box-shadow:none} .watermark span{opacity:0.08} }
  </style>
</head>
<body>
  <div class="page">
    <div class="watermark"><span>${watermark}</span></div>

    <header>
      <div class="brand">
        <div class="tag">Mittente</div>
        <div class="logo">
          <div class="word">SPST S.r.l.</div>
        </div>
        <div class="meta">
          Via Esempio 1, 20100 Milano (MI), Italy · VAT IT12345678901<br/>
          info@spst.it · +39 320 144 1789 · www.spst.it
        </div>
      </div>
      <div class="doc-meta">
        <div class="title">${meta}</div>
        <div class="kv">
          <div><strong>Data:</strong> ${today} ${time}</div>
          <div><strong>ID Spedizione:</strong> ${ship || '—'}</div>
        </div>
      </div>
    </header>

    <hr class="sep" />

    <section class="grid">
      <div class="card">
        <h3>Destinatario</h3>
        <div class="small"><strong>—</strong></div>
        <div class="small muted">Dati esempio (compilazione futura)</div>
      </div>
      <div class="card">
        <h3>Dettagli Spedizione</h3>
        <div class="small">Incoterm: DAP · Valuta: EUR</div>
        <div class="small muted">Placeholder layout</div>
      </div>
    </section>

    <table class="items" aria-label="Dettaglio colli/merce">
      <thead>
        <tr>
          <th style="width:32px">#</th>
          <th>Descrizione</th>
          <th style="width:90px" class="num">Qtà</th>
          <th style="width:120px" class="num">Prezzo</th>
          <th style="width:130px" class="num">Importo</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>1</td>
          <td><strong>Placeholder riga</strong><br/><span class="muted">HS: 0000.00 · Origine: IT</span></td>
          <td class="num">1</td>
          <td class="num">€ 0,00</td>
          <td class="num">€ 0,00</td>
        </tr>
      </tbody>
    </table>

    <div class="totals">
      <table>
        <tr>
          <td style="text-align:right">Totale</td>
          <td style="text-align:right; width:140px"><strong>€ 0,00</strong></td>
        </tr>
      </table>
    </div>

    <footer>
      <div class="legal">
        <strong>Dichiarazione:</strong> Questo documento è un’anteprima. I valori sono di esempio.
      </div>
      <div class="sign">
        <div>
          <div class="small"><strong>Luogo & data:</strong> Milano, ${today}</div>
          <div class="small">Email: info@spst.it · Tel: +39 320 144 1789</div>
        </div>
        <div class="sig">
          <div class="label">Firma</div>
          <div class="box"></div>
        </div>
      </div>
    </footer>
  </div>
</body>
</html>`;
}

export default async function handler(req, res) {
  const nowISO = new Date().toISOString();

  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).send('Method Not Allowed');
    }
    if (!SECRET) {
      return res.status(500).send('Missing DOCS_SIGN_SECRET');
    }

    const url = new URL(req.url, `https://${req.headers.host}`);
    const q = url.searchParams;

    const sid   = q.get('sid')  || '';
    const type  = q.get('type') || 'proforma';
    const exp   = parseInt(q.get('exp') || '0', 10);
    const sig   = q.get('sig')  || '';
    const ship  = q.get('ship') || '';
    const format = (q.get('format') || '').toLowerCase(); // '', 'html', 'print'

    // Scadenza
    const nowEpoch = Math.floor(Date.now() / 1000);
    if (!exp || exp < nowEpoch) {
      return res.status(410).send('Link scaduto');
    }

    // Verifica firma con STESSA CANONICALIZZAZIONE della generate.js
    const expected = sign({ sid, type, exp, ship });
    if (!sig || sig !== expected) {
      console.warn('[render] bad signature', {
        sid, type, exp, ship, sig,
        expected,
        canon: canonical({ sid, type, exp, ship }),
      });
      return res.status(401).send('Unauthorized');
    }

    // Output
    const html = htmlTemplate({ type, ship: ship || sid, nowISO });

    if (format === 'print') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res
        .status(200)
        .send(
          html.replace(
            '</body>',
            `<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),10));</script></body>`
          )
        );
    }

    // Anteprima HTML standard
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  } catch (err) {
    console.error('[render] 500', nowISO, err);
    return res.status(500).send('Server error');
  }
}
