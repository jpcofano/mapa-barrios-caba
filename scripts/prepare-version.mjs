// scripts/prepare-version.mjs
import fs from 'fs';
import path from 'path';

// Args
const args = process.argv.slice(2);
const prefixArg = args.find(a => a.startsWith('--prefix='))?.split('=')[1];
const versionArg = args.find(a => a.startsWith('--version='))?.split('=')[1];

if (!prefixArg) throw new Error('❌ Falta --prefix');
if (!versionArg) throw new Error('❌ Falta --version');

const clean = (str) => {
  return str
    .trim()
    .replace(/\u00A0/g, '') // eliminar NBSP
    .replace(/\s+/g, '-')   // reemplazar espacios por guiones
    .replace(/-+/g, '-');   // evitar guiones dobles
};

const prefix = clean(prefixArg);
const version = clean(versionArg);

// Evitar duplicar si el prefix ya contiene la version
const folderName = prefix.includes(version) ? prefix : `${prefix}-${version}`;

// Paths
const publicDir = path.resolve('./public');
const manifestPath = path.join(publicDir, 'manifest.json');
const bucketPathFile = path.resolve('.bucket_path');

// Leer manifest.json
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// Limpiar ID de la primera componente
if (manifest.components?.length) {
  let compId = manifest.components[0].id || '';
  compId = clean(compId).replace(/-/g, ''); // ID sin guiones
  manifest.components[0].id = compId;
}

// Actualizar versión y URLs
manifest.version = version;
manifest.components[0].resource.js = `gs://mapa-barrios-degcba/${folderName}/Visualization.js`;
manifest.components[0].resource.css = `gs://mapa-barrios-degcba/${folderName}/Visualization.css`;
manifest.components[0].resource.config = `gs://mapa-barrios-degcba/${folderName}/Config.json`;

// Guardar manifest limpio
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`✅ manifest.json limpio y actualizado -> ${manifestPath}`);

// Guardar .bucket_path
fs.writeFileSync(bucketPathFile, `gs://mapa-barrios-degcba/${folderName}`);
console.log(`[prepare-version] BUCKET_PATH: gs://mapa-barrios-degcba/${folderName}`);
console.log(`[prepare-version] Copiá en Studio: gs://mapa-barrios-degcba/${folderName}/manifest.json`);

// Debug
console.log('[prepare-version] FOLDER char codes (hex):', folderName.split('').map(c => c.charCodeAt(0).toString(16)).join(' '));
