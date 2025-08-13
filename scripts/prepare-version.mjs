// scripts/prepare-version.mjs
// Uso: node scripts/prepare-version.mjs [--version=YYYYMMDD|d|e...] [--prefix=barrios-caba-map-v2025]
// - Calcula carpeta destino: <prefix>-<version> (sanitizada, sin NBSP ni raros)
// - Reescribe public/manifest.json apuntando a esa carpeta (HTTPS + GS)
// - Emite .manifest_gs_url (para pegar en Studio) y .bucket_path (para deploy)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ----- Utils -----
const args = process.argv.slice(2);
const getArg = (k, def) => {
  const hit = args.find(a => a.startsWith(`--${k}=`));
  if (hit) return hit.split('=')[1];
  return process.env[k.toUpperCase()] || def;
};

// Sanitizador: quita NBSP y normaliza a [a-z0-9-_]
const clean = (s='') => String(s)
  .normalize('NFKC')           // normaliza Unicode (evita look‑alikes)
  .replace(/\u00A0/g, ' ')     // NBSP → espacio
  .replace(/[ \t\r\n]+/g, '-') // espacios → guion
  .replace(/[^a-z0-9\-_]/gi, '-') // caracteres fuera de whitelist → guion
  .replace(/-+/g, '-')         // colapsar guiones
  .replace(/^-+|-+$/g, '')     // quitar guiones en bordes
  .toLowerCase();


const today = new Date();
const y = today.getFullYear();
const m = String(today.getMonth() + 1).padStart(2, '0');
const d = String(today.getDate()).padStart(2, '0');

// ----- Parámetros saneados -----
const RAW_VERSION = getArg('version', `${y}${m}${d}`);           // default YYYYMMDD
const RAW_PREFIX  = getArg('prefix',  'barrios-caba-map-v2025'); // default prefijo

const VERSION = clean(RAW_VERSION);
const PREFIX  = clean(RAW_PREFIX);
const FOLDER  = `${PREFIX}-${VERSION}`.replace(/--+/g,'-').replace(/^-+|-+$/g,'');

// Aviso visible si alguien coló NBSP (ya no debería tras clean)
if (/\u00A0/.test(`${RAW_PREFIX}${RAW_VERSION}`)) {
  console.warn('[prepare-version] ⚠️ Se detectó NBSP en los parámetros originales (ya saneado).');
}

// ----- Constantes de destino -----
const BUCKET    = 'gs://mapa-barrios-degcba';
const HTTP_BASE = 'https://storage.googleapis.com/mapa-barrios-degcba';

// ----- Rutas de trabajo -----
const manifestPath = path.resolve(process.cwd(), 'public/manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error(`[prepare-version] ❌ No se encontró public/manifest.json en ${manifestPath}`);
  process.exit(1);
}

// ----- Leer manifest -----
let manifest;
try {
  const raw = fs.readFileSync(manifestPath, 'utf8');
  manifest = JSON.parse(raw);
} catch (e) {
  console.error('[prepare-version] ❌ manifest.json inválido:', e.message);
  process.exit(1);
}

// ----- Reescritura de packageUrl y resources -----
manifest.packageUrl = `${HTTP_BASE}/${FOLDER}/`;
if (Array.isArray(manifest.components)) {
  const cssPath = path.resolve(process.cwd(), 'dist/Visualization.css');
  const hasCss = fs.existsSync(cssPath);

  for (const c of manifest.components) {
    if (!c.resource) c.resource = {};
    c.resource.js     = `${BUCKET}/${FOLDER}/Visualization.js`;
    c.resource.config = `${BUCKET}/${FOLDER}/Config.json`;
    if (hasCss) {
      c.resource.css  = `${BUCKET}/${FOLDER}/Visualization.css`;
    } else if (c.resource.css) {
      delete c.resource.css;
    }
  }
} else {
  console.warn('[prepare-version] ⚠️ manifest.components no es un array; se continuará igualmente.');
}


// ----- Sanear IDs de componentes (evita NBSP/raros) -----
if (Array.isArray(manifest.components)) {
  for (const c of manifest.components) {
    if (typeof c.id === 'string') {
      const newId = clean(c.id);
      if (newId !== c.id) {
        console.warn(`[prepare-version] 🔧 Limpio id '${c.id}' → '${newId}'`);
        c.id = newId;
      }
    }
  }
}
// HTTPS (opcional) para pegar donde prefieras
const manifestHttpFile = path.resolve(process.cwd(), '.manifest_http_url');
const MANIFEST_HTTP = `${HTTP_BASE}/${FOLDER}/manifest.json`;
fs.writeFileSync(manifestHttpFile, MANIFEST_HTTP, 'utf8');
// Log útil para pegar en flujos HTTPS
console.log(`[prepare-version] MANIFEST (HTTPS): ${MANIFEST_HTTP}`);

// ----- Guardar manifest actualizado -----
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

// ----- Salidas auxiliares -----
// GS para pegar en Studio (Agregar desde manifiesto)
const manifestGsFile = path.resolve(process.cwd(), '.manifest_gs_url');
const MANIFEST_GS = `${BUCKET}/${FOLDER}/manifest.json`;
fs.writeFileSync(manifestGsFile, MANIFEST_GS, 'utf8');

// Ruta base para deploy
const bucketFile = path.resolve(process.cwd(), '.bucket_path');
fs.writeFileSync(bucketFile, `${BUCKET}/${FOLDER}`, 'utf8');

// ----- Logs útiles -----
const charCodes = [...FOLDER].map(c => c.charCodeAt(0).toString(16)).join(' ');
console.log(`[prepare-version] ✅ OK -> ${FOLDER}`);
console.log(`[prepare-version] packageUrl: ${manifest.packageUrl}`);
console.log(`[prepare-version] BUCKET_PATH: ${BUCKET}/${FOLDER}`);
console.log(`[prepare-version] MANIFEST (GS): ${MANIFEST_GS}`);
console.log(`[prepare-version] Copiá y pegá en Studio (Agregar desde manifiesto):`);
console.log(`  ${MANIFEST_GS}`);
console.log(`[prepare-version] FOLDER char codes (hex): ${charCodes}`);
