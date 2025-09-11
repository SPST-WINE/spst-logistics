// scripts/sync-bo.js
// Copia assets ESM e CSS del Back Office in public/back-office per l'embed esterno (Webflow)

import { cp, mkdir, stat } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const SRC_ESM = join(ROOT, "assets", "esm");
const SRC_CSS_DIR = join(ROOT, "back-office"); // dove hai base.css e quotes-admin.css
const OUT = join(ROOT, "public", "back-office");

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

(async () => {
  await mkdir(OUT, { recursive: true });

  // 1) Copia tutto l'ESM (cartelle e file)
  if (!(await exists(SRC_ESM))) {
    console.warn("[sync-bo] WARN: assets/esm non trovato, salto copia ESM");
  } else {
    await cp(SRC_ESM, OUT, { recursive: true });
    console.log("[sync-bo] Copiato assets/esm → public/back-office");
  }

  // 2) Copia i CSS (se presenti)
  for (const css of ["base.css", "quotes-admin.css"]) {
    const from = join(SRC_CSS_DIR, css);
    const to = join(OUT, css);
    if (await exists(from)) {
      await cp(from, to, { recursive: false });
      console.log(`[sync-bo] Copiato ${css} → public/back-office/${css}`);
    } else {
      console.warn(`[sync-bo] WARN: ${css} non trovato in /back-office`);
    }
  }

  console.log("[sync-bo] OK");
})().catch((e) => {
  console.error("[sync-bo] ERROR", e);
  process.exit(1);
});
