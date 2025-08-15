// scripts/prepare-version.mjs
// Uso:
//   node scripts/prepare-version.mjs --prefix="barrios-caba-map-v2025" --version="h" --bucket="mapa-barrios-degcba"
// Notas:
// - Corré este script ANTES del build para que el manifest de public pase a dist.
// - Si lo corrés DESPUÉS, también actualiza dist/manifest.json si existe.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ------------------------- Utilitarios -------------------------
function getArg(name, def = "") {
  const re = new RegExp(`^--${name}=(.*)$`, "i");
  const hit = process.argv.slice(2).find((a) => re.test(a));
  return hit ? hit.replace(re, "$1") : def;
}

function sanitizeSlug(s, { toLower = true } = {}) {
  if (typeof s !== "string") return "";
  // Reemplaza NBSP por espacio, trimea, colapsa espacios -> '-', quita chars raros
  let out = s.replace(/\u00A0/g, " ").trim();
  if (toLower) out = out.toLowerCase();
  out = out.replace(/\s+/g, "-");
  out = out.replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-");
  return out;
}

function ensureTrailingSlash(u) {
  return u.endsWith("/") ? u : u + "/";
}

function updateManifestAtPath(atPath, httpsBase) {
  if (!fs.existsSync(atPath)) return false;

  const raw = fs.readFileSync(atPath, "utf8");
  /** @type {any} */
  const manifest = JSON.parse(raw);

  // 1) packageUrl versionado en HTTPS
  manifest.packageUrl = ensureTrailingSlash(httpsBase);

  // 2) Actualizar resources (Community Viz schema)
  const setResourceRelatives = (target) => {
    if (!target) return;
    // Solo si hay algun recurso de estos, forzamos relativos
    if (target.js || target.css || target.config) {
      target.js = "Visualization.js";
      target.css = "Visualization.css";
      target.config = "Config.json";
    }
  };

  if (Array.isArray(manifest.components)) {
    manifest.components = manifest.components.map((c) => {
      const copy = { ...c };
      if (typeof copy.id === "string") copy.id = copy.id.trim();
      copy.resource = copy.resource ? { ...copy.resource } : {};
      setResourceRelatives(copy.resource);
      return copy;
    });
  }

  // 3) Soporte para manifests antiguos con resource en root
  if (manifest.resource && typeof manifest.resource === "object") {
    setResourceRelatives(manifest.resource);
  }

  fs.writeFileSync(atPath, JSON.stringify(manifest, null, 2));
  return true;
}

// ------------------------- Parámetros -------------------------
const DEFAULT_BUCKET = "mapa-barrios-degcba";

const argPrefix = getArg("prefix", "barrios-caba-map-v2025");
const argVersion = getArg("version", "dev");
const argBucket = getArg("bucket", DEFAULT_BUCKET);

const prefix = sanitizeSlug(argPrefix);
const version = sanitizeSlug(argVersion);
const bucket = sanitizeSlug(argBucket, { toLower: false }); // bucket puede tener puntos

if (!prefix) {
  console.error("[prepare-version] ERROR: --prefix vacío o inválido");
  process.exit(1);
}
if (!version) {
  console.error("[prepare-version] ERROR: --version vacío o inválido");
  process.exit(1);
}
if (!bucket) {
  console.error("[prepare-version] ERROR: --bucket vacío o inválido");
  process.exit(1);
}

const folderName = `${prefix}-${version}`;
const BUCKET_PATH = `gs://${bucket}/${folderName}`;
const HTTPS_BASE = `https://storage.googleapis.com/${bucket}/${folderName}`;

const manifestPathPub = path.resolve(__dirname, "..", "public", "manifest.json");
const manifestPathDist = path.resolve(__dirname, "..", "dist", "manifest.json");

// ------------------------- Trabajo -------------------------
let changedPub = false;
let changedDist = false;

try {
  changedPub = updateManifestAtPath(manifestPathPub, HTTPS_BASE);
} catch (e) {
  console.warn(`[prepare-version] WARN al actualizar ${manifestPathPub}:`, e?.message || e);
}
try {
  changedDist = updateManifestAtPath(manifestPathDist, HTTPS_BASE);
} catch (e) {
  console.warn(`[prepare-version] WARN al actualizar ${manifestPathDist}:`, e?.message || e);
}

// Escribir .bucket_path para el deploy
const bucketPathFile = path.resolve(__dirname, "..", ".bucket_path");
fs.writeFileSync(bucketPathFile, BUCKET_PATH + "/");

// Logs útiles
console.log(`[prepare-version] carpeta:        ${folderName}`);
console.log(`[prepare-version] gs path:        ${BUCKET_PATH}/`);
console.log(`[prepare-version] packageUrl:     ${ensureTrailingSlash(HTTPS_BASE)}`);
console.log(`[prepare-version] public manifest: ${changedPub ? "actualizado" : "no existe"}`);
console.log(`[prepare-version] dist manifest:   ${changedDist ? "actualizado" : "no existe"}`);
