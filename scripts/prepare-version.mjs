// scripts/prepare-version.mjs
// Uso:
//  node scripts/prepare-version.mjs --prefix="barrios-caba-map-v2025e"
//  node scripts/prepare-version.mjs --prefix="barrios-caba-map-v2025" --version="e"
//  node scripts/prepare-version.mjs --prefix="barrios-caba-map-v2025e" --devMode=false

import fs from 'fs';
import path from 'path';

// ---- helpers ----
const UWS_RE = /[\u00A0\u1680\u2000-\u200D\u202F\u205F\u2060\u3000\uFEFF]/g; // NBSP + zero-width & friends
const clean = (s) => String(s ?? '')
  .replace(UWS_RE, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const [k, ...rest] = arg.replace(/^--/, '').split('=');
  return [k, rest.join('=')];
}));

let prefix  = clean(args.prefix || 'barrios-caba-map-v2025');
let version = clean(args.version || '');
let devMode = (args.devMode ?? '').toString().toLowerCase();

// Evitar duplicar: barrios-caba-map-v2025e + version=e => barrios-caba-map-v2025e (no agrega -e)
if (version && prefix.toLowerCase().endsWith(`-${version.toLowerCase()}`)) {
  prefix = prefix.slice(0, -(version.length + 1));
}

const folderName = version ? `${prefix}-${version}` : `${prefix}`;
const BUCKET_PATH = `gs://mapa-barrios-degcba/${folderName}`;
const manifestPath = path.resolve('public/manifest.json');

if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  // packageUrl https://.../<folder>/
  manifest.packageUrl = `https://storage.googleapis.com/mapa-barrios-degcba/${folderName}/`;

  // (opcional) setear devMode si lo pasan como arg
  if (devMode === 'true' || devMode === 'false') {
    manifest.devMode = (devMode === 'true');
  }

  // limpiar ids/rutas y setear a carpeta final
  if (Array.isArray(manifest.components)) {
    manifest.components = manifest.components.map(c => {
      const id = clean(c.id || '');
      const res = c.resource || {};
      return {
        ...c,
        id,
        resource: {
          ...res,
          js:     `${BUCKET_PATH}/Visualization.js`,
          config: `${BUCKET_PATH}/Config.json`,
          css:    `${BUCKET_PATH}/Visualization.css`,
        }
      };
    });
  }

  // sanity-extra: quitar invisibles del JSON entero
  const out = JSON.stringify(manifest, null, 2).replace(UWS_RE, ' ');
  fs.writeFileSync(manifestPath, out);
  console.log(`[prepare-version] Manifest actualizado → carpeta: ${folderName}`);
} else {
  console.warn('[prepare-version] No se encontró public/manifest.json');
}

// BUCKET_PATH para steps de deploy
fs.writeFileSync('.bucket_path', BUCKET_PATH);
console.log(`[prepare-version] BUCKET_PATH: ${BUCKET_PATH}`);
console.log(`[prepare-version] Agregar desde manifest en Studio: ${BUCKET_PATH}/manifest.json`);
