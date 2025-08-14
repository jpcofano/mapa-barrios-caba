// scripts/prepare-version.mjs
import fs from 'fs';
import path from 'path';

// Args
const args = process.argv.slice(2);
const prefixArg = args.find(a => a.startsWith('--prefix='))?.split('=')[1];
const versionArg = args.find(a => a.startsWith('--version='))?.split('=')[1];

if (!prefixArg) throw new Error('❌ Falta --prefix');
if (!versionArg) throw new Error('❌ Falta --version');

const prefix = prefixArg.trim().replace(/\s+/g, '-'); // limpiar espacios
const version = versionArg.trim();

const folderName = `${prefix}-${version}`;

// Rutas
const publicDir = path.resolve('./public');
const manifestPath = path.join(publicDir, 'manifest.json');
const bucketPathFile = path.resolve('.bucket_path');

// Leer manifest.json
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// Limpiar id de la primera componente
if (manifest.components?.length) {
  let compId = manifest.components[0].id || '';
  compId = compId.replace(/\u00A0/g, ' '); // NBSP -> espacio normal
  compId = compId.replace(/\s+/g, '');     // eliminar TODOS los espacios
  manifest.components[0].id = compId;
}

// Actualizar versión y URLs a la carpeta nueva
manifest.version = version;
manifest.components[0].resource.js = `gs://mapa-barrios-degcba/${folderName}/Visualization.js`;
manifest.components[0].resource.css = `gs://mapa-barrios-degcba/${folderName}/Visualization.css`;
manifest.components[0].resource.config = `gs://mapa-barrios-degcba/${folderName}/Config.json`;

// Guardar manifest.json limpio
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`✅ manifest.json limpio y actualizado -> ${manifestPath}`);

// Guardar .bucket_path
fs.writeFileSync(bucketPathFile, `gs://mapa-barrios-degcba/${folderName}`);
console.log(`[prepare-version] BUCKET_PATH: gs://mapa-barrios-degcba/${folderName}`);
console.log(`[prepare-version] Copiá en Studio: gs://mapa-barrios-degcba/${folderName}/manifest.json`);

// Debug: mostrar ASCII
console.log('[prepare-version] FOLDER char codes (hex):', folderName.split('').map(c => c.charCodeAt(0).toString(16)).join(' '));
