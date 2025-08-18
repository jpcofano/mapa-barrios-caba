// scripts/prepare-version.mjs
// Genera <prefix>-<version>/ y crea manifest.json
// - Sanea NBSP/espacios y caracteres raros en prefix/version
// - packageUrl usa scheme (por defecto gs)
// - resources: SIEMPRE ABSOLUTOS con gs://<bucket>/<folder>/...  (como solicitaste)

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';

// ------------------ args helpers ------------------
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
      if (nxt && !nxt.startsWith('--')) { out[k] = nxt; i++; }
      else { out[k] = 'true'; }
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

// --- Sanitizador NBSP/espacios/raros → solo [A-Za-z0-9._-] ---
const NBSP_RE = /\u00A0/g;
function sanitizeArg(x) {
  if (x == null) return "";
  let s = String(x).replace(NBSP_RE, "");
  s = s.replace(/\s+/g, "");
  s = s.replace(/[^A-Za-z0-9._-]/g, "");
  return s;
}

// ------------------ inputs ------------------
const bucket        = getArg("bucket");
const prefixRaw     = getArg("prefix");
const versionRaw    = getArg("version");
const devMode       = toBool(getArg("devMode","false"), false);
const scheme        = (getArg("scheme","gs") || "gs").toLowerCase(); // gs | https
const configName    = getArg("configName", "config.json");
const setIdToFolder = toBool(getArg("setIdToFolder"), true);
const manifestPath  = getArg("manifestPath", "public/manifest.json");

// Requeridos
if (!bucket)     { console.error("Falta --bucket"); process.exit(1); }
if (!prefixRaw)  { console.error("Falta --prefix"); process.exit(1); }
if (!versionRaw) { console.error("Falta --version"); process.exit(1); }

// Saneo
const prefix     = sanitizeArg(prefixRaw);
const version    = sanitizeArg(versionRaw);
const folderName = `${prefix}-${version}`;

// Bases
const HTTPS_BASE = `https://storage.googleapis.com/${bucket}/${folderName}`;
const GS_BASE    = `gs://${bucket}/${folderName}`;
const PACKAGE_BASE = scheme === "gs" ? GS_BASE : HTTPS_BASE;  // packageUrl según scheme

// ------------------ manifest ------------------
// IMPORTANTE: resources ABSOLUTOS con gs:// (siempre)
const manifest = {
  name: "Barrios CABA Map",
  version: version,
  organization: "Tu Org",
  description: "Mapa de barrios CABA con coropletas",
  logoUrl: `https://storage.googleapis.com/${bucket}/Logo.png`,
  packageUrl: ensureSlash(PACKAGE_BASE),
  components: [{
    id: setIdToFolder ? folderName : "viz",
    name: "Barrios / Comunas CABA",
    iconUrl: `https://storage.googleapis.com/${bucket}/Icon.png`,
    description: "Coropletas, etiquetas y leyenda configurables",
    resource: {
      js:    `${ensureSlash(GS_BASE)}Visualization.js`,
      css:   `${ensureSlash(GS_BASE)}Visualization.css`,
      config:`${ensureSlash(GS_BASE)}${configName}`
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
console.log("resource.js:    ", manifest.components[0].resource.js);
console.log("resource.css:   ", manifest.components[0].resource.css);
console.log("resource.config:", manifest.components[0].resource.config);
console.log("manifestPath:   ", outFile);
