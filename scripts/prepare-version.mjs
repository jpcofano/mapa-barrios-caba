// scripts/prepare-version.mjs
// Prepara carpeta <prefix>-<version>/ y genera manifest.json con esquema gs:// u https://
// - Sanea NBSP/espacios y caracteres raros en prefix/version
// - Alinea packageUrl con el esquema elegido (--scheme gs|https)
// - Respeta devMode, configName, setIdToFolder, manifestPath

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';

// ------------------ util args ------------------
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (!t.startsWith('--')) continue;
    const eq = t.indexOf('=');
    if (eq > -1) {
      const k = t.slice(2, eq);
      const v = t.slice(eq + 1);
      out[k] = v;
    } else {
      const k = t.slice(2);
      const nxt = argv[i + 1];
      if (nxt && !nxt.startsWith('--')) {
        out[k] = nxt; i++;
      } else {
        out[k] = 'true';
      }
    }
  }
  return out;
}
const ARGS = parseArgs(process.argv.slice(2));
const getArg = (k, d = undefined) => (ARGS[k] !== undefined ? ARGS[k] : d);

const toBool = (v, d=false) => {
  if (v === undefined) return d;
  const s = String(v).toLowerCase();
  if (["true","1","yes","y"].includes(s)) return true;
  if (["false","0","no","n"].includes(s)) return false;
  return d;
};
const ensureSlash = (u) => (u.endsWith("/") ? u : u + "/");

// --- Saneador duro: quita NBSP/espacios y filtra a [A-Za-z0-9._-] ---
const NBSP_RE = /\u00A0/g;
function sanitizeArg(x) {
  if (x == null) return "";
  let s = String(x).replace(NBSP_RE, ""); // NBSP
  s = s.replace(/\s+/g, "");              // espacios
  s = s.replace(/[^A-Za-z0-9._-]/g, "");  // solo seguros
  return s;
}

// ------------------ inputs ------------------
const bucket        = getArg("bucket");
const prefixRaw     = getArg("prefix");
const versionRaw    = getArg("version");
const devMode       = toBool(getArg("devMode"), false);
const scheme        = (getArg("scheme", "gs") || "gs").toLowerCase(); // gs | https
const configName    = getArg("configName", "config.json");
const setIdToFolder = toBool(getArg("setIdToFolder"), true);
const manifestPath  = getArg("manifestPath", "public/manifest.json");

// requeridos
if (!bucket) {
  console.error("Falta --bucket");
  process.exit(1);
}
if (!prefixRaw) {
  console.error("Falta --prefix");
  process.exit(1);
}
if (!versionRaw) {
  console.error("Falta --version");
  process.exit(1);
}

// saneo
const prefix        = sanitizeArg(prefixRaw);
const version       = sanitizeArg(versionRaw);
const folderName    = `${prefix}-${version}`;

// bases
const HTTPS_BASE = `https://storage.googleapis.com/${bucket}/${folderName}`;
const GS_BASE    = `gs://${bucket}/${folderName}`;
const baseAbs    = scheme === "gs" ? GS_BASE : HTTPS_BASE;      // para js/css/config
const PACKAGE_BASE = scheme === "gs" ? GS_BASE : HTTPS_BASE;    // para packageUrl

// ------------------ manifest ------------------
const manifest = {
  name: "Barrios CABA Map",
  version: version,
  organization: "Tu Org",
  description: "Mapa de barrios CABA con coropletas",
  logoUrl: `https://storage.googleapis.com/${bucket}/Logo.png`, // imágenes por HTTPS
  packageUrl: ensureSlash(PACKAGE_BASE),
  components: [{
    id: setIdToFolder ? folderName : "viz",
    name: "Barrios / Comunas CABA",
    iconUrl: `https://storage.googleapis.com/${bucket}/Icon.png`,
    description: "Coropletas, etiquetas y leyenda configurables",
    resource: {
      // En manifest van rutas relativas respecto de packageUrl
      js: "Visualization.js",
      css: "Visualization.css",
      config: configName
    }
  }],
  devMode: devMode
};

// ------------------ write ------------------
const outFile = resolve(manifestPath);
const outDir  = dirname(outFile);
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, JSON.stringify(manifest, null, 2), { encoding: "utf-8" });

// ------------------ report ------------------
console.log("=== prepare-version.mjs ===");
console.log("bucket:         ", bucket);
console.log("prefix:         ", prefix, "(raw:", prefixRaw, ")");
console.log("version:        ", version, "(raw:", versionRaw, ")");
console.log("folderName:     ", folderName);
console.log("scheme:         ", scheme);
console.log("configName:     ", configName);
console.log("setIdToFolder:  ", setIdToFolder);
console.log("devMode:        ", devMode);
console.log("packageUrl:     ", manifest.packageUrl);
console.log("js/css/config:  ", `${baseAbs}/Visualization.js`, `${baseAbs}/Visualization.css`, `${baseAbs}/${configName}`);
console.log("manifestPath:   ", outFile);
