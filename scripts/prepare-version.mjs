#!/usr/bin/env node
/**
 * prepare-version.mjs
 *
 * Uso típico (HTTPS + config.json):
 *   node scripts/prepare-version.mjs \
 *     --bucket mapa-barrios-degcba \
 *     --prefix barrios-caba-map-v2025 \
 *     --version m \
 *     --devMode false \
 *     --scheme https \
 *     --configName config.json \
 *     --setIdToFolder true
 *
 * Alternativa (resources por gs:// y Config.json):
 *   node scripts/prepare-version.mjs \
 *     --bucket mapa-barrios-degcba \
 *     --prefix barrios-caba-map-v2025 \
 *     --version n \
 *     --devMode true \
 *     --scheme gs \
 *     --configName Config.json \
 *     --setIdToFolder true
 *
 * manifestPath opcional (por defecto public/manifest.json):
 *   --manifestPath ./public/manifest.json
 */

import fs from "node:fs";
import path from "node:path";

// ------------------ helpers ------------------
function getArg(name, def = undefined) {
  const i = process.argv.findIndex(a => a === `--${name}`);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
  return def;
}
const toBool = (v, d=false) => {
  if (v === undefined) return d;
  const s = String(v).toLowerCase();
  if (["true","1","yes","y"].includes(s)) return true;
  if (["false","0","no","n"].includes(s)) return false;
  return d;
};
const ensureSlash = (u) => (u.endsWith("/") ? u : u + "/");

// ------------------ args ------------------
const bucket        = getArg("bucket");
const prefix        = getArg("prefix");
const version       = getArg("version");
const devMode       = toBool(getArg("devMode","false"), false);
const scheme        = (getArg("scheme","https") || "https").toLowerCase(); // https | gs
const configName    = getArg("configName","config.json"); // permite config.json o Config.json
const setIdToFolder = toBool(getArg("setIdToFolder","true"), true);
const manifestPath  = getArg("manifestPath", path.join("public","manifest.json"));

if (!bucket || !prefix || !version) {
  console.error("Faltan args. Usá: --bucket --prefix --version [--devMode] [--scheme=https|gs] [--configName=config.json] [--setIdToFolder=true] [--manifestPath=public/manifest.json]");
  process.exit(1);
}

if (!fs.existsSync(manifestPath)) {
  console.error(`No existe manifest en: ${manifestPath}`);
  process.exit(2);
}

const folderName = `${prefix}-${version}`;
const HTTPS_BASE = `https://storage.googleapis.com/${bucket}/${folderName}`;
const GS_BASE    = `gs://${bucket}/${folderName}`;
const baseAbs    = scheme === "gs" ? GS_BASE : HTTPS_BASE;

// ------------------ load manifest ------------------
const raw = fs.readFileSync(manifestPath, "utf8");
// Quitar BOM si hubiera
const text = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;

let manifest;
try {
  manifest = JSON.parse(text);
} catch (e) {
  console.error("manifest.json inválido:", e.message);
  process.exit(3);
}

// ------------------ mutate manifest ------------------
// packageUrl: dejamos HTTPS (mejor para Preview/UX). resources usan scheme elegido.
manifest.packageUrl = ensureSlash(HTTPS_BASE);
manifest.devMode = devMode;

// A) Si tiene "components": actualizamos TODOS los componentes
if (Array.isArray(manifest.components)) {
  manifest.components = manifest.components.map((comp, idx) => {
    const copy = { ...comp };

    if (setIdToFolder || !copy.id) {
      copy.id = folderName;
    }

    // asegurar resource
    if (!copy.resource || typeof copy.resource !== "object") copy.resource = {};
    copy.resource.js     = `${baseAbs}/Visualization.js`;
    copy.resource.css    = `${baseAbs}/Visualization.css`;
    copy.resource.config = `${baseAbs}/${configName}`;

    return copy;
  });
}

// B) Compatibility: si existe "resources" top-level (fuera de spec de LS, pero útil en tests), lo actualizamos también.
if (manifest.resources && typeof manifest.resources === "object") {
  const r = manifest.resources;
  // Permitir array o string
  r.js     = Array.isArray(r.js) ? r.js.map(() => `${baseAbs}/Visualization.js`) : `${baseAbs}/Visualization.js`;
  r.css    = Array.isArray(r.css) ? r.css.map(() => `${baseAbs}/Visualization.css`) : `${baseAbs}/Visualization.css`;
  r.config = `${baseAbs}/${configName}`;
}

// ------------------ save ------------------
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

// ------------------ report ------------------
console.log("=== prepare-version.mjs ===");
console.log("bucket:         ", bucket);
console.log("prefix:         ", prefix);
console.log("version:        ", version);
console.log("folderName:     ", folderName);
console.log("scheme:         ", scheme);
console.log("configName:     ", configName);
