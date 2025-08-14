// scripts/prepare-version.mjs
// Uso: node scripts/prepare-version.mjs --prefix="barrios-caba-map-v2025" --version="V2025"
// Ajusta manifest.json, normaliza ID, evita NBSP y duplicados de versión.

import fs from 'fs';
import path from 'path';
import url from 'url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

function sanitize(str) {
  return str
    .replace(/\u00A0/g, '')       // elimina NBSP
    .replace(/\s+/g, '')          // elimina espacios
    .replace(/-+/g, '-')          // normaliza guiones
    .trim();
}

function normalizeId(id) {
  return sanitize(id).toLowerCase();
}

// Leer args
const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, val] = arg.replace(/^--/, '').split('=');
  acc[key] = val;
  return acc;
}, {});

const prefix = sanitize(args.prefix || 'barrios-caba-map-v2025');
const version = sanitize(args.version || 'V2025');

// Evitar que se repita versión
const folderName = prefix.endsWith(version.toLowerCase()) ? prefix : `${prefix}-${version.toLowerCase()}`;

// Paths
const manifestPath = path.join(__dirname, '../public/manifest.json');

// Cargar manifest
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// Actualizar campos
manifest.version = version;
manifest.devMode = false; // para producción
if (manifest.packageUrl) {
  manifest.packageUrl = `https://storage.googleapis.com/mapa-barrios-degcba/${folderName}/`;
}

if (Array.isArray(manifest.components)) {
  manifest.components.forEach(c => {
    // normaliza id
    c.id = normalizeId(`${c.id.split(/barrios?/i)[0]}${prefix}${version}`); 
    // resources
    if (c.resource) {
      for (const key of Object.keys(c.resource)) {
        c.resource[key] = `gs://mapa-barrios-degcba/${folderName}/${path.basename(c.resource[key])}`;
      }
    }
  });
}

// Guardar manifest
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`[prepare-version] ✅ Manifest actualizado: ${manifestPath}`);
console.log(`[prepare-version] Carpeta destino: ${folderName}`);
console.log(`[prepare-version] Agregá en Studio desde: gs://mapa-barrios-degcba/${folderName}/manifest.json`);
