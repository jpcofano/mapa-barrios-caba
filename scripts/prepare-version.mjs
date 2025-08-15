// scripts/prepare-version.mjs
// Uso:
//   node scripts/prepare-version.mjs --prefix="barrios-caba-map-v2025" --version="h" --bucket="mapa-barrios-degcba"
// Efectos:
//   - Calcula carpeta <prefix>-<version>
//   - Escribe .bucket_path con gs://<bucket>/<prefix>-<version>/
//   - Ajusta public/manifest.json y dist/manifest.json (si existe) para que:
//       * packageUrl = https://storage.googleapis.com/<bucket>/<prefix>-<version>/
//       * resource.{js,css,config} = rutas ABSOLUTAS (HTTPS) a esa carpeta

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------- util ----------------
function getArg(name, def = "") {
  const re = new RegExp(`^--${name}=(.*)$`, "i");
  const hit = process.argv.slice(2).find((a) => re.test(a));
  return hit ? hit.replace(re, "$1") : def;
}
function sanitizeSlug(s, { toLower = true } = {}) {
  if (typeof s !== "string") return "";
  let out = s.replace(/\u00A0/g, " ").trim();
  if (toLower) out = out.toLowerCase();
  out = out.replace(/\s+/g, "-");
  out = out.replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-");
  return out;
}
function ensureSlash(u) {
  return u.endsWith("/") ? u : u + "/";
}

function updateManifestAtPath(atPath, httpsBaseAbs) {
  if (!fs.existsSync(atPath)) return false;
  const manifest = JSON.parse(fs.readFileSync(atPath, "utf8"));

  // packageUrl también queda en absoluto (no estorba, y ayuda al preview local)
  manifest.packageUrl = ensureSlash(httpsBaseAbs);

  const applyAbsoluteResources = (resObj) => {
    if (!resObj || typeof resObj !== "object") return;
    resObj.js     = `${httpsBaseAbs}/Visualization.js`;
    resObj.css    = `${httpsBaseAbs}/Visualization.css`;
    resObj.config = `${httpsBaseAbs}/Config.json`;
  };

  // resources por component
  if (Array.isArray(manifest.components)) {
    manifest.components = manifest.components.map((c) => {
      const copy = { ...c };
      if (!copy.resource) copy.resource = {};
      applyAbsoluteResources(copy.resource);
      return copy;
    });
  }

  // manifests antiguos que tienen resource en la raíz
  if (manifest.resource && typeof manifest.resource === "object") {
    applyAbsoluteResources(manifest.resource);
  }

  fs.writeFileSync(atPath, JSON.stringify(manifest, null, 2));
  return true;
}

// ---------------- args ----------------
const DEFAULT_BUCKET = "mapa-barrios-degcba";
const argPrefix  = getArg("prefix", "barrios-caba-map-v2025");
const argVersion = getArg("version", "dev");
const argBucket  = getArg("bucket", DEFAULT_BUCKET);

const prefix  = sanitizeSlug(argPrefix);
const version = sanitizeSlug(argVersion);
const bucket  = sanitizeSlug(argBucket, { toLower: false });

if (!prefix)  { console.error("[prepare-version] ERROR: --prefix inválido");  process.exit(1); }
if (!version) { console.error("[prepare-version] ERROR: --version inválido"); process.exit(1); }
if (!bucket)  { console.error("[prepare-version] ERROR: --bucket inválido");  process.exit(1); }

const folderName  = `${prefix}-${version}`;
const GS_BASE     = `gs://${bucket}/${folderName}`;
const HTTPS_BASE  = `https://storage.googleapis.com/${bucket}/${folderName}`;

const manifestPublic = path.resolve(__dirname, "..", "public", "manifest.json");
const manifestDist   = path.resolve(__dirname, "..", "dist",   "manifest.json");

// ---------------- run ----------------
let changedPub = false, changedDist = false;
try { changedPub  = updateManifestAtPath(manifestPublic, HTTPS_BASE); }
catch (e) { console.warn(`[prepare-version] WARN public: ${e?.message || e}`); }

try { changedDist = updateManifestAtPath(manifestDist, HTTPS_BASE); }
catch (e) { console.warn(`[prepare-version] WARN dist: ${e?.message || e}`); }

// .bucket_path para el deploy
fs.writeFileSync(path.resolve(__dirname, "..", ".bucket_path"), ensureSlash(GS_BASE));

// logs útiles
console.log(`[prepare-version] carpeta           : ${folderName}`);
console.log(`[prepare-version] gs path           : ${ensureSlash(GS_BASE)}`);
console.log(`[prepare-version] https base (abs)  : ${ensureSlash(HTTPS_BASE)}`);
console.log(`[prepare-version] public manifest   : ${changedPub ? "OK" : "no existe"}`);
console.log(`[prepare-version] dist manifest     : ${changedDist ? "OK" : "no existe"}`);
