// scripts/prepare-version.mjs
// Uso: node scripts/prepare-version.mjs [--version=YYYYMMDD] [--prefix=barrios-caba-map-v2025]
// - Calcula carpeta destino: <prefix>-<version>
// - Reescribe public/manifest.json apuntando a esa carpeta
// - Emite .bucket_path con la ruta gs:// para deploy

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const args = process.argv.slice(2);
const getArg = (k, def) => {
  const hit = args.find(a => a.startsWith(`--${k}=`));
  if (hit) return hit.split('=')[1];
  return process.env[k.toUpperCase()] || def;
};

const today = new Date();
const y = today.getFullYear();
const m = String(today.getMonth() + 1).padStart(2, '0');
const d = String(today.getDate()).padStart(2, '0');

const VERSION = getArg('version', `${y}${m}${d}`); // YYYYMMDD
const PREFIX  = getArg('prefix', 'barrios-caba-map-v2025');
const FOLDER  = `${PREFIX}-${VERSION}`;

const BUCKET = 'gs://mapa-barrios-degcba';
const HTTP_BASE = 'https://storage.googleapis.com/mapa-barrios-degcba';

const manifestPath = path.resolve(process.cwd(), 'public/manifest.json');

if (!fs.existsSync(manifestPath)) {
  console.error(`[prepare-version] No se encontró public/manifest.json en ${manifestPath}`);
  process.exit(1);
}

const raw = fs.readFileSync(manifestPath, 'utf8');
let manifest;
try {
  manifest = JSON.parse(raw);
} catch (e) {
  console.error('[prepare-version] manifest.json inválido:', e.message);
  process.exit(1);
}

// Reescribir packageUrl y resources → nueva carpeta versionada
manifest.packageUrl = `${HTTP_BASE}/${FOLDER}/`;
if (Array.isArray(manifest.components)) {
  for (const c of manifest.components) {
    if (!c.resource) c.resource = {};
    c.resource.js    = `${BUCKET}/${FOLDER}/Visualization.js`;
    c.resource.config= `${BUCKET}/${FOLDER}/Config.json`;
    c.resource.css   = `${BUCKET}/${FOLDER}/Visualization.css`;
  }
}

// Guardar manifest
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

// Extra: exportar GS URL del manifest para Studio
const manifestGsFile = path.resolve(process.cwd(), '.manifest_gs_url');
const MANIFEST_GS = `${BUCKET}/${FOLDER}/manifest.json`;
fs.writeFileSync(manifestGsFile, MANIFEST_GS, 'utf8');

console.log(`[prepare-version] MANIFEST (GS): ${MANIFEST_GS}`);
console.log(`[prepare-version] Copiá y pegá en Studio (Agregar desde manifiesto):`);
console.log(`  ${MANIFEST_GS}`);

// Exportar BUCKET_PATH para scripts de deploy
const bucketFile = path.resolve(process.cwd(), '.bucket_path');
fs.writeFileSync(bucketFile, `${BUCKET}/${FOLDER}`, 'utf8');

console.log(`[prepare-version] OK -> ${FOLDER}`);
console.log(`[prepare-version] packageUrl: ${manifest.packageUrl}`);
console.log(`[prepare-version] BUCKET_PATH: ${BUCKET}/${FOLDER}`);
