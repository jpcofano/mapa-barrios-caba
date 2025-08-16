#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function getArg(name, def = undefined) {
  const i = process.argv.findIndex(a => a === `--${name}`);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
  return def;
}
const ensureSlash = (u) => (u.endsWith("/") ? u : u + "/");
const toBool = (v, d=false) => {
  if (v === undefined) return d;
  return String(v).toLowerCase() === "true";
};

const bucket  = getArg("bucket");
const prefix  = getArg("prefix");
const version = getArg("version");
const devMode = toBool(getArg("devMode","false"));
const scheme  = (getArg("scheme","https") || "https").toLowerCase(); // https|gs
const cfgName = getArg("configName","config.json"); // permite Config.json o config.json
const setIdToFolder = toBool(getArg("setIdToFolder","true"));

if (!bucket || !prefix || !version) {
  console.error("Faltan args. Usá: --bucket --prefix --version [--devMode] [--scheme=https|gs] [--configName=config.json] [--setIdToFolder=true]");
  process.exit(1);
}

const folderName = `${prefix}-${version}`;
const HTTPS_BASE = `https://storage.googleapis.com/${bucket}/${folderName}`;
const GS_BASE    = `gs://${bucket}/${folderName}`;
const baseAbs    = scheme === "gs" ? GS_BASE : HTTPS_BASE;

const manifestPath = path.join("public","manifest.json");
if (!fs.existsSync(manifestPath)) {
  console.error("No existe public/manifest.json");
  process.exit(2);
}

const raw = fs.readFileSync(manifestPath, "utf8");
// Quitar BOM si existiera
const text = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;

let manifest;
try {
  manifest = JSON.parse(text);
} catch (e) {
  console.error("manifest.json inválido:", e.message);
  process.exit(3);
}

// packageUrl (dejamos https para preview), devMode
manifest.packageUrl = ensureSlash(HTTPS_BASE);
manifest.devMode = devMode;

// Alinear components / resource
if (Array.isArray(manifest.components)) {
  manifest.components = manifest.components.map((c, idx) => {
    const copy = { ...c };
    if (setIdToFolder || !copy.id) copy.id = folderName;
    if (!copy.resource || typeof copy.resource !== "object") copy.resource = {};
    copy.resource.js     = `${baseAbs}/Visualization.js`;
    copy.resource.css    = `${baseAbs}/Visualization.css`;
    copy.resource.config = `${baseAbs}/${cfgName}`;
    return copy;
  });
}

// Guardar con salto de línea final
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

console.log("=== prepare-version.mjs ===");
console.log("bucket:      ", bucket);
console.log("folder:      ", folderName);
console.log("scheme:      ", scheme);
console.log("configName:  ", cfgName);
console.log("devMode:     ", devMode);
console.log("setIdToFolder:", setIdToFolder);
console.log("Manifest actualizado OK.");
