// scripts/prepare-version.mjs
// Uso:
//   node scripts/prepare-version.mjs --prefix="barrios-caba-map-v2025"
//   node scripts/prepare-version.mjs --prefix="barrios-caba-map" --version="v2025"

import fs from 'fs';
import path from 'path';

// --- Leer argumentos ---
const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const [key, val] = arg.replace(/^--/, '').split('=');
  return [key, val];
}));

let prefix = args.prefix || 'barrios-caba-map-v2025';
let version = args.version || '';

// --- Normalizar prefix y version ---
prefix = prefix.trim();
version = version.trim();

// Eliminar duplicados de versión en prefix
if (version && prefix.toLowerCase().endsWith(`-${version.toLowerCase()}`)) {
  prefix = prefix.slice(0, -(version.length + 1));
}

// Determinar nombre final de carpeta
const folderName = version
  ? `${prefix}-${version}`
  : prefix;

// --- Generar BUCKET_PATH ---
const BUCKET_PATH = `gs://mapa-barrios-degcba/${folderName}`;

// --- Actualizar manifest.json ---
const manifestPath = path.resolve('public/manifest.json');
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  manifest.packageUrl = `https://storage.googleapis.com/mapa-barrios-degcba/${folderName}/`;
  if (manifest.components && manifest.components.length > 0) {
    manifest.components[0].resource.js = `${BUCKET_PATH}/Visualization.js`;
    manifest.components[0].resource.config = `${BUCKET_PATH}/Config.json`;
    manifest.components[0].resource.css = `${BUCKET_PATH}/Visualization.css`;
  }

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`[prepare-version] Manifest actualizado para carpeta: ${folderName}`);
}

// --- Guardar BUCKET_PATH en .bucket_path ---
fs.writeFileSync('.bucket_path', BUCKET_PATH);
console.log(`[prepare-version] BUCKET_PATH: ${BUCKET_PATH}`);
console.log(`[prepare-version] Copiá en Studio: ${BUCKET_PATH}/manifest.json`);
