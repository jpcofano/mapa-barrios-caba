// scripts/prepare-version.mjs
// Uso:
//   node scripts/prepare-version.mjs --prefix="barrios-caba-map-v2025"         (sin version)
//   node scripts/prepare-version.mjs --prefix="barrios-caba-map" --version="V2025"

import fs from 'fs';
import path from 'path';
import process from 'process';

function getArg(name) {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=')[1] : null;
}

let prefix = getArg('prefix') || 'barrios-caba-map';
let version = getArg('version') || '';

// Limpieza de caracteres invisibles
prefix = prefix.replace(/\u00A0/g, '').trim();
version = version.replace(/\u00A0/g, '').trim();

// Evitar duplicación de version en el prefix
if (version && prefix.toLowerCase().includes(version.toLowerCase())) {
  version = ''; // Ya está incluido
}

const folderName = version ? `${prefix}-${version}` : prefix;

// Paths
const bucketPath = `gs://mapa-barrios-degcba/${folderName}`;
const manifestHttps = `https://storage.googleapis.com/mapa-barrios-degcba/${folderName}/manifest.json`;

// Leer manifest base
const manifestPath = path.resolve('public/manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// Actualizar campos
manifest.packageUrl = `https://storage.googleapis.com/mapa-barrios-degcba/${folderName}/`;
manifest.components.forEach(c => {
  // Limpiar id
  c.id = c.id.replace(/\u00A0/g, '').trim();
  // Rutas GS coherentes
  c.resource.js = `${bucketPath}/Visualization.js`;
  c.resource.css = `${bucketPath}/Visualization.css`;
  if (c.resource.config) {
    c.resource.config = `${bucketPath}/Config.json`;
  }
});

// Guardar manifest actualizado
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

// Guardar bucket path
fs.writeFileSync('.bucket_path', bucketPath);

// Logs
console.log(`[prepare-version] ✅ OK -> ${folderName}`);
console.log(`[prepare-version] packageUrl: ${manifest.packageUrl}`);
console.log(`[prepare-version] BUCKET_PATH: ${bucketPath}`);
console.log(`[prepare-version] MANIFEST (GS): ${bucketPath}/manifest.json`);
console.log(`[prepare-version] Copiá y pegá en Studio: ${bucketPath}/manifest.json`);
