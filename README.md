README GPT

---

# PROMPT / HANDOVER — SPST Back Office & Quote System

Sei il mio assistente tecnico. Devi aiutarmi a manutenere il sistema preventivi SPST (Next.js + Vercel + Airtable + Resend). Qui sotto trovi **architettura, file, env**, mappature dei campi Airtable, e **flussi** (render pubblico, accettazione, email). Mantieni questa struttura mentale, proponi fix/snippets coerenti e NON introdurre dipendenze superflue.

## Architettura (alto livello)

* **Hosting**: Vercel (Serverless Functions).
* **DB**: Airtable (3 tabelle: Preventivi, OpzioniPreventivo, Colli).
* **Rendering pubblico**: API route che genera HTML statico server-side (niente React).
* **Accettazione preventivo**: API route che aggiorna Airtable e invia email con Resend.
* **Back office**: interfaccia admin (file `quotes-admin.js` lato Webflow/BO) che crea/aggiorna record in Airtable (non incluso qui, ma il sistema lo supporta).

## Repository / Struttura file (GitHub)

```
/api
  /quotes
    /view
      [slug].js         # Render HTML del preventivo pubblico + pulsanti "Accetta" per ogni opzione
    accept.js           # POST: accettazione; aggiorna Airtable + invia email via Resend
/lib
  airtable.js           # (opzionale) estrarre qui fetch/update comuni se vogliamo DRY
/README.md               # copia di questo handover
```

> Nota: in passato c’era confusione tra “public” e “admin”. Ora: **view** = pubblico; **accept** = azione; **admin** rimane lato back office.

## Variabili d’ambiente richieste (Vercel → Project Settings → Environment Variables)

* `AIRTABLE_BASE_ID`
* `AIRTABLE_PAT` *(scoped PAT con accesso alle 3 tabelle)*
* `TB_PREVENTIVI` *(es. “Preventivi”)*
* `TB_OPZIONI` *(es. “OpzioniPreventivo”)*
* `TB_COLLI` *(es. “Colli”)*
* `ORIGIN_ALLOWLIST` *(CSV di origini abilitate al CORS — default include spst.it, vercel.app e localhost)*
* `RESEND_API_KEY`
* `MAIL_FROM` *(default: `SPST Notifications <notification@spst.it>` )*
* `PUBLIC_QUOTE_BASE_URL` *(default: `https://spst-logistics.vercel.app/quote`)*

## Mappatura campi Airtable (alias robusti)

Per tollerare varianti/typo nei nomi campo, il codice usa un helper `pick()` che prova più chiavi.

### Preventivi (`TB_PREVENTIVI`)

* Identificazione: `Slug_Pubblico`
* Client: `Email_Cliente`
* Valuta: `Valuta` / `Currency`
* Validità: `Valido_Fino_Al` / `Valid_Until` / `Validita`
* Note globali: `Note_Globali` / `Note`
* **Note generiche spedizione**: `Note generiche sulla spedizione` / `Note_Spedizione` / `Shipment_Notes` / `Note spedizione`
* Stato: `Stato` *(Bozza | Pubblicato | Accettato | Scaduto | Annullato)*
* Accettazione: `Opzione_Accettata` (number), `Accettato_Il` (date), `Accettato_IP` (text), `Accettato_UA` (text)
* Mittente:

  * `Mittente_Nome`, `Mittente_Indirizzo`, `Mittente_CAP`, `Mittente_Citta`, `Mittente_Paese`, `Mittente_Telefono`
  * **P.IVA/EORI**: `Mittente_Tax` / `PIVA` / `P.IVA` / `Mittente_PIVA` / `Mittente_EORI`
* Destinatario:

  * `Destinatario_Nome`, `Destinatario_Indirizzo`, `Destinatario_CAP`, `Destinatario_Citta`, `Destinatario_Paese`, `Destinatario_Telefono`
  * **Tax/EORI/EIN**: `Destinatario_Tax` / `TaxID` / `EORI` / `Destinatario_EIN`

### OpzioniPreventivo (`TB_OPZIONI`)

* Collegamento al preventivo: **o** linked field `Preventivo` **o** campo testo `Preventivo_Id`
* Indice: `Indice` / `Index` / `Opzione` / `Option`
* Dati: `Corriere`, `Servizio`, `Tempo_Resa` (alias “Tempo di resa previsto”), `Incoterm`, `Oneri_A_Carico`
* Prezzo/Valuta: `Prezzo` (number), `Valuta`
* Note operative: `Note_Operative` / `Note operative`
* Flag: `Consigliata` (boolean), *(opzionale)* `Accettata` (boolean)

### Colli (`TB_COLLI`)

* Collegamento: `Preventivo` (link) **o** `Preventivo_Id` (testo)
* Dimensioni & peso (accettate diverse varianti):

  * Quantità: `Quantita` / `Quantità` / `Qty`
  * L/W/H: `L_cm`/`Lunghezza`/`L` — `W_cm`/`Larghezza`/`W` — `H_cm`/`Altezza`/`H`
  * Peso: `Peso_Kg` / `Peso` / `Kg` / `Weight`

## File & responsabilità

### `/api/quotes/view/[slug].js`

* Query su Airtable (Preventivi + Opzioni + Colli) usando filtro su `Slug_Pubblico`.
* **Rendering HTML** (dark theme) con:

  * intestazione (status “Accettato” o “Valido fino al …”)
  * cliente/valuta, mittente/destinatario (con P.IVA / Tax ID)
  * **Note generiche sulla spedizione**
  * **Tabella colli** (quantità, dimensioni, peso)
  * **Card Opzioni** (badge “Consigliata”, evidenza bordi; se accettato, badge “Accettata”)
  * **Bottone “Accetta” dentro ogni card** (niente checkbox termini)
* JS inline: `fetch('/api/quotes/accept', {method:'POST', body:{slug, optionIndex}})`
  Aggiorna UI (disabilita bottoni, badge status) senza reload.
* **Sanitizzazione**: output HTML via `esc()`.

### `/api/quotes/accept.js`

* CORS con allowlist da env.
* Input `POST` JSON: `{ slug: string, optionIndex: number }` (accetta anche `option`).
* Recupera preventivo da `TB_PREVENTIVI` via `Slug_Pubblico`.
* **Idempotenza**:

  * Se `Opzione_Accettata` già impostata con indice diverso → `409 Conflict`.
  * Se uguale o vuota → aggiorna `Opzione_Accettata`, `Accettato_Il`, `Accettato_IP`, `Accettato_UA`, `Stato = "Accettato"`.
* Carica opzioni collegate (prova con `Preventivo_Id`, poi `Preventivo`, poi scan locale) e **seleziona**:

  1. match per `Indice` (num o string), poi
  2. `Consigliata`, poi
  3. prezzo minore, poi
  4. prima disponibile.
* **Email (Resend)** a: cliente + `info@spst.it` + `commerciale@spst.it`
  Oggetto: “Conferma accettazione preventivo • Opzione X”
  HTML pulito con: cliente, corriere, servizio, incoterm, oneri a carico, **prezzo** formattato, link preventivo.
* **Log estesi** su Vercel per debug (conteggio opzioni, campi opzione normalizzati).
* Ritorna `{ ok: true, email: "sent"|"skipped" }`.

## Scelte UX implementate

* **Evidenza card “Consigliata”** (bordo chiaro) e **card “Accettata”** (bordo verde).
* Bottone **“Accetta” dentro la card** (niente checkbox condizioni).
* Mostra chiaramente **Note generiche sulla spedizione**.
* Mostra **P. IVA/EORI** mittente e **Tax ID/EORI/EIN** destinatario.

## Endpoint utili / test rapidi

```bash
# Apri preventivo pubblico
GET https://<deploy>/quote/<slug>   # es. q-250827-xxxx

# Accetta un’opzione (curl)
curl -X POST https://<deploy>/api/quotes/accept \
  -H "Content-Type: application/json" \
  -d '{"slug":"q-250827-xxxx","optionIndex":1}'
```

## Troubleshooting (rapido)

* **Email vuota**: verifica che l’opzione abbia `Indice` e `Prezzo` (number). Il codice fa fallback sui nomi campo; se cambi schema, aggiorna gli alias in `normalizeOption()`/`pick()`.
* **“Missing slug/option”**: il client deve inviare `optionIndex` **o** `option`.
* **Nessuna opzione in pagina**: assicurati che `OpzioniPreventivo` siano collegate con `Preventivo` **o** `Preventivo_Id` (testo).
* **CORS**: aggiungi il dominio all’`ORIGIN_ALLOWLIST`.
* **Errore Airtable `INVALID_VALUE_FOR_COLUMN`**: non inviare a campi calcolati/computed (es. *Tot\_Colli*). È già stato rimosso `UM_Dimensioni`.

## Sicurezza & qualità

* CORS su `accept`.
* Sanitizzazione XSS lato `view` con `esc()`.
* PAT Airtable **solo server-side**.
* Idempotenza con `409` su cambio opzione.
* Logging moderato (senza dati sensibili del cliente oltre l’email).

## TODO / Estensioni future (se servono)

* Generazione **PDF** del preventivo.
* **Webhook** verso strumenti interni dopo l’accettazione.
* **Rate-limiting** su `/accept`.
* Refactor in `/lib` (estrarre `atFetch/atUpdate/pick/normalizeOption`).

---

### Cosa mi aspetto da te in questa chat

* Quando propongo modifiche, **mantieni questa struttura**.
* Se toccano campi Airtable, **aggiorna gli alias** in `pick()`/`normalizeOption()`.
* Se tocchiamo email, **rispetta** l’HTML in `buildEmailHtml()` e il testo plain fallback.
* Suggerisci **verifiche sui log Vercel** quando qualcosa non torna (già presenti `console.log` mirati).

Grazie! Questo è tutto il contesto necessario per supportare e far evolvere il sistema preventivi SPST.
