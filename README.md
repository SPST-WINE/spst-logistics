Ecco il **README finale** aggiornato con l’“Utility Documenti” (Proforma, Commercial Invoice e DLE).

---

# SPST — Quotes + Back Office (Tracking) — Handover

Sei il mio assistente tecnico. Mantieni e fai evolvere il sistema **Preventivi** e il **Back-Office Spedizioni** (Next.js/Vercel + Airtable + Resend + frontend statico). Qui trovi architettura, file, env, mappature Airtable e flussi. Quando proponi fix/snippets, **rispetta questa struttura** e non introdurre dipendenze inutili.

## Architettura (alto livello)

* **Hosting**: Vercel (Serverless/Edge a seconda della route).
* **DB**: Airtable.
* **Email**: Resend.
* **Rendering pubblico (quotes & documenti)**: HTML server-side (no React).
* **Back-Office Spedizioni**: interfaccia statica (ESM) che parla con proxy API su Vercel.
* **CORS**: allowlist via env.

---

## Struttura repo (cartelle principali)

```
/api
  /quotes
    /view/[slug].js
    accept.js
  /notify/transit.js
  /docs/unified/render.js         # ⬅️ Utility Documenti: proforma / commerciale / DLE (HTML)
  
/app
  /api/spedizioni/[id]/notify/route.ts

/assets/esm
  main.js
  /ui/render.js
  /airtable/api.js
  /rules/docs.js
  /rules/labels.js
  /utils/*
  config.js
```

> NB: il Back-Office gira come pagina statica (es. `spst.it/back-office`) e chiama le API Vercel via **proxy**.

---

## Variabili d’ambiente (Vercel → Project Settings → Environment Variables)

### Comuni

* `AIRTABLE_BASE_ID`
* `AIRTABLE_PAT` *(scoped PAT per le tabelle sotto)*
* `ORIGIN_ALLOWLIST` *(CSV origini per CORS — es. `https://spst.it,https://*.vercel.app,http://localhost:*`)*

### Preventivi

* `TB_PREVENTIVI`
* `TB_OPZIONI`
* `TB_COLLI`
* `MAIL_FROM` *(default `SPST Notifications <notification@spst.it>`)*
* `PUBLIC_QUOTE_BASE_URL` *(default `https://<deploy>/quote`)*

### Spedizioni / Notifiche

* `RESEND_API_KEY`
* `EMAIL_FROM` *(default `notification@spst.it`)*
* `EMAIL_LOGO_URL`
* `AREA_RISERVATA_URL`
* `WHATSAPP_URL`

### Web-app “conferma spedizione”

* `APP_DASHBOARD_URL`

### **Utility Documenti (nuovo)**

* `DOCS_SIGN_SECRET` *(HMAC per firma link)*
* `BYPASS_SIGNATURE` *(metti `1` in ambienti di test per saltare la verifica firma)*

> Le tabelle usate dall’Utility Documenti sono **fisse** nel codice:
>
> * Spedizioni: `SpedizioniWebApp`
> * Packing list righe: `SPED_PL`
>   Se vuoi rinominarle, modifica le costanti in `/api/docs/unified/render.js`.

---

## Airtable — mappature campi (alias robusti)

Usiamo alias tolleranti (ma tieni i nomi coerenti dove possibile). Se rinomini un campo, **aggiorna gli alias**.

### Preventivi (`TB_PREVENTIVI`), Opzioni, Colli

*(come già descritto nel README esistente — invariato)*

### **Spedizioni** (Back-Office)

* **ID spedizione**: `ID Spedizione` *(fallback a `rec.id`)*

  > La ricerca shipment prova più alias (`ID Spedizione`, `Id Spedizione`, ecc.) per gestire varianti.
* **Mittente (sender)**

  * `Mittente - Ragione Sociale`
  * `Mittente - Paese`
  * `Mittente - Città`
  * `Mittente - CAP`
  * `Mittente - Indirizzo`
  * `Mittente - Telefono`
  * `Mittente - P.IVA/CF`
* **Destinatario (receiver)**

  * `Destinatario - Ragione Sociale`
  * `Destinatario - Indirizzo`
  * `Destinatario - Città`
  * `Destinatario - CAP`
  * `Destinatario - Paese`
  * `Destinatario - Telefono`
  * `Destinatario - P.IVA/CF`
* **Meta spedizione**

  * `Corriere` *(Carrier)*
  * `Incoterm`
  * `Valuta`/`Currency` *(EUR → simbolo `€`)*
  * `Ritiro - Data`
* **Documenti (allegati)** *(se/quando abiliteremo upload automatico)*

  * **Fattura (unico campo per proforma/commerciale)**: `Allegato Fattura`
  * **DLE**: `Allegato DLE` *(opzionale)*

### **Packing List** (`SPED_PL`)

* **Join** con spedizione tramite `ID Spedizione` (stesso valore dello shipment) — alias robusti gestiti dal codice.
* **Campi riga** (alias accettati):

  * Descrizione: `Descrizione` / `Description` / `Prodotto` / `Articolo` / `SKU` / `Titolo`
  * Quantità: `Quantità` / `Quantita` / `Qtà` / `Qta` / `Qty` / `Pezzi`
  * Prezzo unitario: `Prezzo` / `Price` / `Valore Unitario` / `Unit Price`
  * HS code: `HS` / `HS code` / `HS Code`
  * Origine: `Origine` / `Country of origin` / `Origin`

---

## Flussi & comportamenti

### Preventivi (pubblico) — *(invariato)*

*(vedi sezione già presente; nessuna modifica funzionale)*

### Back-Office Spedizioni — *(aggiornamenti minori UI)*

* “Genera e allega” modernizzato (card più pulita, pulsanti secondari per aprire/copiare URL più coerenti).
* Messaggistica di esito (“Documento generato e allegato”) rientra nella card.

---

## **Utility Documenti** (nuovo)

**File**: `/api/docs/unified/render.js` (Serverless, ESM)

Genera **HTML** per:

* **Proforma Invoice** (`type=proforma`)
* **Commercial Invoice** (`type=commercial` | `fattura` | `commerciale` | `invoice`)
* **DLE — Export Free Declaration** (`type=dle`)

> Il rendering è **HTML**; per il salvataggio PDF si usa **Stampa/Salva PDF** del browser.
> *(Opzionale: integrazione con headless Chrome è possibile, ma non necessaria.)*

### Endpoint

```
GET /api/docs/unified/render
```

**Query params**

* `sid` **o** `ship` → ID Spedizione (business) **oppure** `recXXXXXXXX` di Airtable
* `type` → `proforma` | `commercial`/`fattura`/`commerciale`/`invoice` | `dle`
* `exp` → epoch seconds di scadenza firma
* `sig` → HMAC-SHA256 di `${sid}.${type}.${exp}` con `DOCS_SIGN_SECRET`
* `format=html` *(opzionale; output è comunque HTML)*

**Sicurezza**

* In produzione, **firma obbligatoria** (`sig` + `exp`).
* In test, imposta `BYPASS_SIGNATURE=1` per saltare il controllo.

**Come generare `sig` (esempio Node)**

```js
import crypto from 'node:crypto';
const makeSig = (sid, type, exp) =>
  crypto.createHmac('sha256', process.env.DOCS_SIGN_SECRET)
        .update(`${sid}.${type}.${exp}`)
        .digest('hex');
```

> Il server accetta sia il `type` “raw” passato nella query, sia la forma normalizzata (`proforma` | `commercial` | `dle`) per evitare mismatch.

### Regole di template

**Comune**

* Labels in **inglese**: *Sender*, *Receiver*, *Carrier*, *Currency*, *Description*, *Qty*, *Price*, *Total*, *Signature*.
* `Receiver` mostra anche **Telefono** e **VAT/CF** se disponibili.
* `Total` = somma di **Qty × Price** (non c’è più colonna “Amount”).
* **Place & date**: `Mittente - Città` + `Ritiro - Data`.
* Toolbar sticky con bottone “Print / Save PDF”.

**Proforma**

* Titolo: **Proforma Invoice**
* **Watermark** diagonale “PROFORMA”
* Nota in footer: **“Goods are not for resale. Declared values are for customs purposes only.”**

**Commerciale**

* Titolo: **Commercial Invoice**
* **Nessun watermark**
* **Nessuna** nota “not for resale…”

**DLE (Export Free Declaration)**

* Dichiara conformità alle liste/regolamenti UE fornite.
* Placeholder compilati da Airtable:

  * To: **Corriere**
  * Shipper: **Mittente – Ragione Sociale**
  * Place: **Mittente – Città**
  * Date: **Ritiro – Data**

### Esempi URL

```
# Proforma (HTML)
https://<deploy>/api/docs/unified/render?sid=SP-2025-09-10-9736&type=proforma&exp=<epoch>&sig=<hmac>&format=html

# Commercial Invoice (HTML)
https://<deploy>/api/docs/unified/render?sid=SP-2025-09-10-9736&type=fattura&exp=<epoch>&sig=<hmac>&format=html

# DLE (HTML)
https://<deploy>/api/docs/unified/render?sid=SP-2025-09-10-9736&type=dle&exp=<epoch>&sig=<hmac>&format=html
```

---

## API proxy & CORS

*(invariato)*

---

## File & responsabilità (Back-Office)

*(invariato per main.js / ui/render.js, con la sola aggiunta cosmetica ai bottoni)*

---

## Troubleshooting

* **401 Unauthorized — Invalid signature**

  * Verifica `exp` non scaduto (epoch seconds lato client).
  * Calcola `sig` esattamente su `${sid}.${type}.${exp}` (occhio a `type` coerente con la query).
  * In test, `BYPASS_SIGNATURE=1`.

* **404 Not found — No shipment found**

  * `sid` non corrisponde a nessun record in `SpedizioniWebApp`.
  * Ricontrolla “ID Spedizione” (case, spazi, trattini) o passa direttamente il `recXXXX`.

* **422 INVALID\_FILTER\_BY\_FORMULA — Unknown field names**

  * La PL (`SPED_PL`) filtra per “ID Spedizione”: assicurati che il **nome campo** sia esattamente `ID Spedizione`.
  * Il codice prova più alias, ma se non esiste nessuno dei candidati fallisce il filtro.
  * Quote `'` nel valore sono gestite (escape), ma evita caratteri non stampabili.

* **Campi mancanti o placeholder**

  * Se un campo non è valorizzato, il template mostra `—` o lo omette (telefono/VAT).
  * Popola i campi mittente/destinatario in Airtable per una stampa completa.

* **Salvataggio PDF non parte**

  * Il bottone chiama `window.print()`: su alcuni browser mobile è limitato. Su desktop funziona e consente “Salva come PDF”.

* **ESM/CommonJS**

  * `/api/docs/unified/render.js` è **ESM**. Se aggiungi file di supporto, usa `import` e non `require`.
  * Se proprio serve CJS, rinomina in `.cjs` e importalo dinamicamente.

---

## Estensioni future

* Upload automatico su Airtable:

  * **Proforma/Commerciale** → `Allegato Fattura`
  * **DLE** → `Allegato DLE`
  * (eventuale **PL** → `Allegato PL`)
* Conversione HTML→PDF server-side (headless Chrome) solo se strettamente necessario.
* i18n per labels (IT/EN switch by query).

---

### Cosa mi aspetto in chat

* Se tocchiamo Airtable, **aggiorna alias** in `render.js`/normalizzatori.
* Se tocchiamo le email, rispetta gli HTML in `/api/notify/transit.js` e in `app/api/spedizioni/.../route.ts`.
* Suggerisci verifiche su log Vercel quando qualcosa non torna (log già presenti).
* Per l’Utility Documenti, mantieni **coerenza visuale** e **zero dipendenze extra**.
