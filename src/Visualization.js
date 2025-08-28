// Community Viz — Leaflet + dscc (bundle-first) + Normalizador + DEBUG
// Param "Barrio/Comuna" → prioridad; fallback Estilo; fallback heurística.
// CSV robusto; ranking descendente (1 = máx); leyenda; logo con px/%; paletas modernas.

import * as dsccImported from '@google/dscc';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './Visualization.css';

// GeoJSON (Barrio + Comuna)
import geojsonBarriosText  from './barrioscaba.geojson?raw';
import geojsonComunasText  from './comunascaba.geojson?raw';  // ← asegurate de tener este archivo

/* ============================================================================
   DEBUG
============================================================================ */
const DEBUG_DEFAULT = true;
function detectDebug() {
  try {
    const usp = new URLSearchParams(window.location.search || '');
    if (usp.has('debug')) return usp.get('debug') !== '0';
  } catch {}
  if (typeof window !== 'undefined' && typeof window.__VIZ_DEBUG === 'boolean') {
    return window.__VIZ_DEBUG;
  }
  return DEBUG_DEFAULT;
}
let DEBUG = detectDebug();
const dbg  = (...a) => { if (DEBUG) console.log(...a); };
const warn = (...a) => console.warn(...a);
const err  = (...a) => console.error(...a);

/* ============================================================================
   Exponer dscc importado si el host no lo publica
============================================================================ */
(function exposeImportToWindowIfNeeded() {
  if (typeof window !== 'undefined') {
    if (!window.dscc && dsccImported && typeof dsccImported.subscribeToData === 'function') {
      window.dscc = dsccImported;
    }
  }
})();

/* ============================================================================
   Espera a dscc listo + inyección opcional
============================================================================ */
function waitForDscc(maxMs = 4000, interval = 40) {
  return new Promise((resolve, reject) => {
    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    (function loop() {
      const d =
        (dsccImported && typeof dsccImported.subscribeToData === 'function') ? dsccImported :
        (typeof window !== 'undefined' && window.dscc && typeof window.dscc.subscribeToData === 'function') ? window.dscc :
        null;
      if (d) return resolve(d);
      const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      if (now - t0 > maxMs) return reject(new Error('dscc no está listo'));
      setTimeout(loop, interval);
    })();
  });
}
const ensureDsccScript = (() => {
  let injected = false;
  return () => {
    if (typeof window === 'undefined') return false;
    if (typeof window.dscc?.subscribeToData === 'function') return true;
    if (injected) return false;
    if (document.getElementById('__dscc_script')) { injected = true; return false; }
    const s = document.createElement('script');
    s.id = '__dscc_script';
    s.src = 'https://www.gstatic.com/looker-studio/js/dscc.min.js';
    s.async = true;
    s.onload = () => dbg('[Viz] dscc.min.js cargado');
    document.head.appendChild(s);
    injected = true;
    return false;
  };
})();

/* ============================================================================
   Sanitizador query (NBSP, espacios colados en vizId/path)
============================================================================ */
(function () {
  try {
    const fix = (v) => !v ? v : String(v).replace(/\u00A0/g,'').replace(/\s+/g,'')
      .replace(/(gs:\/\/[^/]+\/[^^/?#\s]+)[\u00A0 ]+/i, (_m, g1) => g1 + '/');
    const usp = new URLSearchParams(window.location.search || '');
    let changed = false;
    for (const k of ['vizId','js','css','path','debug']) {
      if (!usp.has(k)) continue;
      const before = usp.get(k), after = fix(before);
      if (after !== before) { usp.set(k, after); changed = true; }
    }
    if (changed) {
      const qs = usp.toString();
      history.replaceState(null,'', qs ? ('?' + qs) : location.pathname);
      dbg('[Viz] Query saneada'); DEBUG = detectDebug();
    }
  } catch (e) { warn('[Viz] Sanitizador URL error:', e); }
})();

/* ============================================================================
   Nivel por parámetro → estilo → heurística
============================================================================ */
function pickNivel(msg) {
  // 1) Estilo (fallback)
  const style = (msg.styleById || {});
  const styleNivel = style.nivelJerarquia?.value || 'barrio';

  // 2) Intentar leer valor del parámetro desde las filas (si existen)
  const T = msg.tables?.DEFAULT || {};
  const H = T.headers || [];
  const R = T.rows || [];
  let paramVal = null;
  if (R?.length && H?.length) {
    const pIdx = H.findIndex(h => /(^(param.*)?nivel$|^nivel$|jerarquia|barrio.*comuna)/i
      .test((h?.id || h?.name || '')));
    if (pIdx >= 0) {
      const v = R[0][pIdx];
      paramVal = (v && typeof v === 'object' && 'v' in v) ? v.v : v;
    }
  }
  const byParam = (paramVal || '').toString().toLowerCase();
  if (byParam.includes('comuna')) return 'comuna';
  if (byParam.includes('barrio')) return 'barrio';

  // 3) Si no hay filas, inferir por el NOMBRE de la dimensión geográfica usada
  const dimName = (msg.fieldsByConfigId?.geoDimension?.[0]?.name ||
                   msg.fieldsByConfigId?.geoDimension?.[0]?.id || '').toLowerCase();
  if (dimName.includes('comuna')) return 'comuna';
  if (dimName.includes('barrio')) return 'barrio';

  // 4) Fallback final: estilo
  return styleNivel;
}

/* ============================================================================
   GeoJSON
============================================================================ */
let GEOJSON; // barrios
try { GEOJSON = JSON.parse(geojsonBarriosText); }
catch (e) { err('[Viz] GeoJSON barrios inválido:', e); GEOJSON = { type: 'FeatureCollection', features: [] }; }

let GEOJSON_COMUNAS = null; // comunas
try { GEOJSON_COMUNAS = JSON.parse(geojsonComunasText); }
catch (e) { warn('[Viz] GeoJSON comunas no disponible o inválido. (Cargá comunascaba.geojson)'); GEOJSON_COMUNAS = null; }

/* ============================================================================
   Helpers texto/color/num + CANON CLAVES (← importante para COMUNAS)
============================================================================ */
function cleanString(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[\u00A0\u1680\u2000-\u200D\u202F\u205F\u2060\u3000\uFEFF]/g,' ')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}
const normalizeKey = (s) => cleanString(s);

// Canon para que “Comuna 1”, “01”, “C1”, “1” → "1"
function canonComunaKey(s) {
  const t = cleanString(s).replace(/\s+/g,' ');
  const m = t.match(/\d+/);
  if (m) return String(parseInt(m[0],10)); // "01" → "1"
  return t.replace(/\bcomuna\b/g,'').trim() || t;
}
function canonBarrioKey(s) {
  return cleanString(s);
}
function canonKeyByNivel(nivel, s) {
  return (nivel === 'comuna') ? canonComunaKey(s) : canonBarrioKey(s);
}

const clamp01 = (t) => Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
const lerp = (a,b,t) => a + (b - a) * clamp01(t);
const toHex = (x) => Math.round(x).toString(16).padStart(2,'0');
const rgb = (r,g,b) => `#${toHex(r)}${toHex(g)}${toHex(b)}`;

function toNumberLoose(x) {
  if (typeof x === 'number') return x;
  const cand = x?.v ?? x?.value ?? x;
  if (typeof cand === 'number') return cand;
  let s = String(cand ?? '').replace(/\s|\u00A0/g,'').trim();
  if (!s) return NaN;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g,'').replace(',', '.');
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g,'');
  else s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
const coerceCell = (c) => (c && typeof c === 'object' && 'v' in c) ? c.v : c;

/* ============================================================================
   Paletas
============================================================================ */
function colorFromScale(scaleName, t, invert) {
  t = clamp01(t); if (invert) t = 1 - t;
  switch (scaleName) {
    case 'blueToYellow': { const r=lerp(0,240,t), g=lerp(90,200,t), b=lerp(170,0,t); return rgb(r,g,b); }
    case 'grayscale':   { const g=lerp(240,40,t); return rgb(g,g,g); }
    case 'yellow':      { const r=lerp(255,130,t), g=lerp(255,130,t), b=lerp(180,20,t); return rgb(r,g,b); }
    case 'greenToRed':
    default:            { const r=lerp(0,204,t),  g=lerp(170,0,t);   return rgb(r,g,0); }
  }
}
const PRESET_PALETTES = {
  viridis: ['#440154','#482777','#3e4989','#31688e','#26828e','#1f9e89','#35b779','#6ece58','#b5de2b','#fde725'],
  blues:   ['#f7fbff','#deebf7','#c6dbef','#9ecae1','#6baed6','#4292c6','#2171b5','#08519c'],
  greens:  ['#f7fcf5','#e5f5e0','#c7e9c0','#a1d99b','#74c476','#41ab5d','#238b45','#005a32'],
  reds:    ['#fff5f0','#fee0d2','#fcbba1','#fc9272','#fb6a4a','#ef3b2c','#cb181d','#99000d'],
  purples: ['#fcfbfd','#efedf5','#dadaeb','#bcbddc','#9e9ac8','#807dba','#6a51a3','#54278f'],
  oranges: ['#fff5eb','#fee6ce','#fdd0a2','#fdae6b','#fd8d3c','#f16913','#d94801','#8c2d04'],
  magma:   ['#000004','#1b0c41','#4f0a6d','#7c1d6f','#a52c60','#cf4446','#ed6925','#fb9b06','#f7d13d','#fcfdbf'],
  plasma:  ['#0d0887','#5b02a3','#9a179b','#cb4679','#ed7953','#fb9f3a','#fdca26','#f0f921'],
  cividis: ['#00224e','#233b67','#3f5a78','#5a7b89','#7a9c98','#9fbc9f','#c9dca0','#f2f4b3'],
  turbo:   ['#23171b','#3b0f70','#6a00a8','#9c179e','#bd3786','#d8576b','#ed7953','#fb9f3a','#fdca26','#f0f921'],
  Spectral:['#9e0142','#d53e4f','#f46d43','#fdae61','#fee08b','#e6f598','#abdda4','#66c2a5','#3288bd','#5e4fa2'],
  soloAmarillo: ['#FFFFF2','#FFFFE6','#FFFFCC','#FFFFB3','#FFFF99','#FFFF66','#FFFF33','#FFFF00'],
  coolToYellow: ['#08306B','#08519C','#2171B5','#41B6C4','#7FCDBB','#C7E9B4','#FFFFCC','#FFFF66','#FFFF00']
};
function hexToRgb(h){ const x=h.replace('#',''); return [parseInt(x.slice(0,2),16),parseInt(x.slice(2,4),16),parseInt(x.slice(4,6),16)]; }
function rgbToHex([r,g,b]){ const h=n=>Math.round(n).toString(16).padStart(2,'0'); return `#${h(r)}${h(g)}${h(b)}`; }
function lerpRgb(a,b,t){ const A=hexToRgb(a),B=hexToRgb(b); return rgbToHex([A[0]+(B[0]-A[0])*t,A[1]+(B[1]-A[1])*t,A[2]+(B[2]-A[2])*t]); }
function samplePaletteContinuous(colors,t){
  if (!colors || !colors.length) return '#cccccc';
  if (colors.length === 1) return colors[0];
  const pos = clamp01(t) * (colors.length - 1);
  const i = Math.floor(pos), f = pos - i;
  return lerpRgb(colors[i], colors[Math.min(i+1, colors.length-1)], f);
}
function getColorFromScaleOrPalette(t, style) {
  let u = clamp01(t);
  if (style?.invertScale) u = 1 - u;
  const pal = style?.colorPalette?.colors;
  if (Array.isArray(pal) && pal.length) return samplePaletteContinuous(pal, u);
  return colorFromScale(style?.colorScale || 'greenToRed', u, false);
}

/* ============================================================================
   Estilos desde config.json
============================================================================ */
function readStyle(message = {}) {
  const s = (message && (message.styleById || message.style)) ? (message.styleById || message.style) : {};
  const num = (x,d) => { const n = Number(x?.value ?? x); return Number.isFinite(n) ? n : d; };
  const readColor = (node, fb) => {
    const val = node?.value ?? node;
    if (typeof val === 'string') return val;
    if (val && typeof val === 'object' && typeof val.color === 'string') return val.color;
    return fb;
  };
  const getPalette = () => {
    const raw = (s.customPalette && s.customPalette.value ? String(s.customPalette.value) : '').trim();
    if (raw) {
      const colors = raw.split(',').map(x=>x.trim())
        .filter(x=>/^#?[0-9a-f]{6}$/i.test(x)).map(x=>x.startsWith('#')?x:'#'+x);
      if (colors.length) return { mode:'custom', colors };
    }
    const v = s.colorPalette && s.colorPalette.value;
    if (v) {
      if (typeof v === 'string') {
        if (PRESET_PALETTES[v]) return { mode:'preset', colors: PRESET_PALETTES[v] };
        if (/^#?[0-9a-f]{6}$/i.test(v)) return { mode:'custom', colors:[v.startsWith('#')?v:'#'+v] };
        return { mode:'custom', colors:[] };
      }
      const colors = (v.colors || v.palette || v.values || []);
      return { mode:(v.mode||'custom'), colors: Array.isArray(colors)? colors : [] };
    }
    return null;
  };

  return {
    // geografía
    nivelJerarquia: (s.nivelJerarquia && s.nivelJerarquia.value) || 'barrio',
    geojsonProperty: ((s.geojsonProperty && s.geojsonProperty.value) || '').toString().trim(),

    // color
    colorScale: (s.colorScale && s.colorScale.value) || 'greenToRed',
    invertScale: !!(s.invertScale && s.invertScale.value),
    colorPalette: getPalette(),

    // estilo shapes
    opacity: num(s.opacity, 0.45),
    colorMissing: readColor(s.colorMissing, '#cccccc'),
    showLegend: (s.showLegend && s.showLegend.value !== undefined) ? !!s.showLegend.value : true,
    legendPosition: (s.legendPosition && s.legendPosition.value) || 'bottomright',
    showLabels: !!(s.showLabels && s.showLabels.value),

    showBorders: (s.showBorders && s.showBorders.value !== undefined) ? !!s.showBorders.value : true,
    borderColor: readColor(s.borderColor, '#000000'),
    borderWidth: num(s.borderWidth, 1),
    borderOpacity: num(s.borderOpacity, 1),

    // tooltip/popup
    popupFormat: (s.popupFormat && s.popupFormat.value) || '<strong>{{nombre}}</strong><br/>Valor: {{valor}}',
    tooltipFormat: (s.tooltipFormat && s.tooltipFormat.value) || '',

    // categorías (opcional 1/2/3)
    categoryMode: !!(s.categoryMode && s.categoryMode.value),
    cat1Label: (s.category1Label && s.category1Label.value) || 'Categoría 1',
    cat1Value: num(s.category1Value, 1),
    cat1Color: readColor(s.category1Color, '#F4B400'),
    cat2Label: (s.category2Label && s.category2Label.value) || 'Categoría 2',
    cat2Value: num(s.category2Value, 2),
    cat2Color: readColor(s.category2Color, '#3F51B5'),
    cat3Label: (s.category3Label && s.category3Label.value) || 'Categoría 3',
    cat3Value: num(s.category3Value, 3),
    cat3Color: readColor(s.category3Color, '#00ACC1'),
    categoryOtherColor: readColor(s.categoryOtherColor, '#E0E0E0'),

    // branding
    showLogo: (s.showLogo && s.showLogo.value !== undefined) ? !!s.showLogo.value : true,
    logoDataUrl: ((s.logoDataUrl && s.logoDataUrl.value) || '').toString().trim(),
    logoUrl: (s.logoUrl && s.logoUrl.value) || '',
    logoPosition: (s.logoPosition && s.logoPosition.value) || 'bottomleft',
    logoWidthPx: num(s.logoWidthPx, 160),
    logoOpacity: num(s.logoOpacity, 0.9),
    logoWidthMode: (s.logoWidthMode && s.logoWidthMode.value) || 'px',
    logoWidthPercent: num(s.logoWidthPercent, 10)
  };
}

/* ============================================================================
   Propiedad de nombre por feature + clave canónica
============================================================================ */
function getFeatureNameProp(feature, nivelJerarquia = 'barrio', customProp = '') {
  const p = feature?.properties || {};
  if (customProp && (customProp in p)) return p[customProp];
  if (nivelJerarquia === 'comuna') {
    const raw = p.COMUNA ?? p.comuna ?? p.Comuna ?? p.cod_comuna ?? p.codigo_comuna ?? p.COD_COMUNA;
    if (raw == null) return raw;
    const s = String(raw).trim();
    return /^\d+$/.test(s) ? s.replace(/^0+/, '') : s;
  }
  const candidates = [ p.nombre, p.NOMBRE, p.Nombre, p.barrio, p.BARRIO, p.Barrio, p.name, p.NOMBRE_BARRIO, p.barrio_nombre, p.barrio_desc ];
  for (const c of candidates) if (c != null && String(c).trim().length) return c;
  const anyStr = Object.values(p).find(v => typeof v === 'string' && v.trim().length);
  return anyStr ?? '—';
}
function getFeatureKey(feature, nivel, customProp) {
  return canonKeyByNivel(nivel, getFeatureNameProp(feature, nivel, customProp));
}

/* ============================================================================
   Normalizar tabla DEFAULT
============================================================================ */
function normalizeDEFAULTTable(data) {
  const T = data?.tables?.DEFAULT;
  if (!T) return { ids: [], names: [], rows: [] };

  // Caso {headers, rows}
  if (Array.isArray(T?.headers) && Array.isArray(T?.rows)) {
    const hdrObjs = T.headers.map(h => (typeof h === 'string' ? { id: h, name: h } : h));
    let ids   = hdrObjs.map(h => h.id ?? null);
    const names = hdrObjs.map(h => h.name ?? h.label ?? h.id ?? '');

    const fieldsAll = [].concat(data?.fields?.dimensions || [], data?.fields?.metrics || []);
    if (ids.some(id => !id) && fieldsAll.length) {
      const byName = new Map(fieldsAll.map(f => [String(f.name||'').trim(), f.id]));
      ids = ids.map((id, i) => id || byName.get(String(names[i]||'').trim()) || names[i] || '');
    }

    const rows = (T.rows || []).map(row => {
      const vals = Array.isArray(row) ? row.map(coerceCell)
                 : (row && typeof row === 'object') ? ids.map(id => coerceCell(row[id]))
                 : [];
      return {
        __vals: vals,
        byName: Object.fromEntries(names.map((nm,i)=>[nm, vals[i]])),
        byId:   Object.fromEntries(ids.map((id ,i)=>[id , vals[i]])),
        __raw: row,
      };
    });
    return { ids, names, rows };
  }

  // Caso array/obj indexado
  let rawRows = null;
  if (Array.isArray(T)) rawRows = T;
  else if (T && typeof T === 'object') {
    const ks = Object.keys(T);
    if (ks.length && ks.every(k => /^\d+$/.test(k))) {
      ks.sort((a,b)=>(+a)-(+b)); rawRows = ks.map(k => T[k]);
    }
  }
  if (!rawRows) {
    console.warn('[Viz] DEFAULT con forma no reconocida:', typeof T, T && Object.keys(T));
    return { ids: [], names: [], rows: [] };
  }

  const rowsVals = rawRows.map(r => {
    if (Array.isArray(r)) return r.map(coerceCell);
    if (r && typeof r === 'object') {
      if (Array.isArray(r.c)) return r.c.map(coerceCell);
      const keys = Object.keys(r);
      if (keys.every(k => /^\d+$/.test(k))) return keys.sort((a,b)=>(+a)-(+b)).map(k => coerceCell(r[k]));
      return keys.map(k => coerceCell(r[k]));
    }
    return [coerceCell(r)];
  });

  const fieldsAll = [].concat(data?.fields?.dimensions || [], data?.fields?.metrics || []);
  let ids = [], names = [];
  if (fieldsAll.length) {
    ids   = fieldsAll.map((f,i)=> f.id || `col${i}`);
    names = fieldsAll.map((f,i)=> f.name || f.id || `col${i+1}`);
  } else {
    const ncols = rowsVals.reduce((m,r)=>Math.max(m, r.length), 0);
    ids   = Array.from({length:ncols}, (_,i)=>`col${i}`);
    names = Array.from({length:ncols}, (_,i)=>`col${i+1}`);
  }

  const rows = rowsVals.map(vals => ({
    __vals: vals,
    byName: Object.fromEntries(names.map((nm,i)=>[nm, vals[i]])),
    byId:   Object.fromEntries(ids.map((id ,i)=>[id , vals[i]])),
    __raw: vals
  }));
  return { ids, names, rows };
}
function toHeadersRows(norm) {
  const headers = norm.ids.map((id, i) => ({ id, name: norm.names[i] || id }));
  const rows = norm.rows.map(r => r.__vals);
  return { headers, rows };
}

/* ============================================================================
   Resolver índices (dimensión/métrica) — ignora param_nivel y evita extras
============================================================================ */
function resolveIndices(message) {
  const T = message?.tables?.DEFAULT;
  const H = T?.headers || [];
  const fieldsByCfg = message?.fieldsByConfigId || {};
  const fields = message?.fields || {};
  const R = T?.rows || [];

  const isParamLike = (h) => {
    const s = (h?.name || h?.id || '').toLowerCase();
    return /(^(param.*)?nivel$|^nivel$|jerar|barrio\s*\/\s*comuna|barrio.*comuna)/i.test(s);
  };

  const extrasIds   = (fieldsByCfg.metricExtras || []).map(f => f.id);
  const extraDimIds = (fieldsByCfg.extraFields   || []).map(f => f.id);

  // Dimensión: slot geoDimension, si existe
  let dimIdx = -1;
  const geoId = fieldsByCfg.geoDimension?.[0]?.id;
  if (geoId) dimIdx = H.findIndex(h => h.id === geoId);

  // Si no hay, buscar por nombre (evitando param-like)
  if (dimIdx < 0) {
    const candidates = H.map((h,i)=>({i,h})).filter(({h})=>{
      const s = (h?.name || h?.id || '').toLowerCase();
      if (isParamLike(h)) return false;
      return /\bdimubicacion\b|\bubicacion\b|\bbarrio\b|\bcomuna\b/.test(s);
    });
    if (candidates.length) dimIdx = candidates[0].i;
  }

  // Último recurso: primera no-métrica ni param-like
  if (dimIdx < 0) {
    for (let i = 0; i < H.length; i++) {
      const id = H[i]?.id;
      if (isParamLike(H[i])) continue;
      if (fields[id]?.concept === 'METRIC') continue;
      dimIdx = i; break;
    }
  }

  // Métrica: slot metricPrimary
  let metIdx = -1;
  const metId = fieldsByCfg.metricPrimary?.[0]?.id;
  if (metId) metIdx = H.findIndex(h => h.id === metId);

  // Si no hay, primera MÉTRIC que no sea extra/extraDim
  if (metIdx < 0) {
    for (let i = 0; i < H.length; i++) {
      const id = H[i]?.id;
      if (fields[id]?.concept === 'METRIC') {
        if (extrasIds.includes(id) || extraDimIds.includes(id)) continue;
        metIdx = i; break;
      }
    }
  }

  // Último recurso: primera numérica que no sea dim ni extras
  if (metIdx < 0 && H.length) {
    for (let i = 0; i < H.length; i++) {
      if (i === dimIdx) continue;
      const id = H[i]?.id;
      if (extrasIds.includes(id) || extraDimIds.includes(id)) continue;
      let v = R?.[0]?.[i];
      if (v && typeof v === 'object' && 'v' in v) v = v.v;
      const num = Number.parseFloat(v);
      if (Number.isFinite(num)) { metIdx = i; break; }
    }
  }

  return { dim: dimIdx, metric: metIdx, headers: H, fieldsByCfg, fields };
}



/* ============================================================================
   Agregado por clave (barrio/comuna) — usa clave CANÓNICA según nivel
============================================================================ */
function buildValueMap(message, dimIdx, metIdx, nivel) {
  const rows = message?.tables?.DEFAULT?.rows || [];
  if (dimIdx < 0 || metIdx < 0) {
    return { map: new Map(), min: NaN, max: NaN, count: 0 };
  }
  const map = new Map();
  for (const row of rows) {
    const keyRaw = (row?.[dimIdx]?.v ?? row?.[dimIdx]?.value ?? row?.[dimIdx] ?? '');
    if (!keyRaw) continue;
    const key = canonKeyByNivel(nivel, keyRaw);
    const val = toNumberLoose(row?.[metIdx]);
    if (!Number.isFinite(val)) continue;
    map.set(key, (map.get(key) ?? 0) + val);
  }
  const values = Array.from(map.values());
  const min = values.length ? Math.min(...values) : NaN;
  const max = values.length ? Math.max(...values) : NaN;
  return { map, min, max, count: values.length };
}

/* ============================================================================
   Row lookup agregado por barrio/comuna + estadísticas
============================================================================ */
function normColKey(s){
  return String(s ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[\u00A0\u1680\u2000-\u200D\u202F\u205F\u2060\u3000\uFEFF]/g,' ')
    .replace(/\s+/g,' ').trim().toLowerCase();
}
function buildRowLookup(message, dimIdx, nivel) {
  const hdrs = message?.tables?.DEFAULT?.headers || [];
  const rows = message?.tables?.DEFAULT?.rows || [];
  const names = hdrs.map(h => h.name || h.id || '');
  const ids   = hdrs.map(h => h.id || '');

  const aggByKey = new Map();

  for (const row of rows) {
    const keyRaw = (row?.[dimIdx]?.v ?? row?.[dimIdx]?.value ?? row?.[dimIdx] ?? '');
    if (!keyRaw) continue;
    const key = canonKeyByNivel(nivel, keyRaw);

    let b = aggByKey.get(key);
    if (!b) { b = { __rowCount: 0, __stats: Object.create(null), __statsById: Object.create(null), __byId: Object.create(null) }; aggByKey.set(key, b); }
    b.__rowCount++;

    for (let i = 0; i < names.length; i++) {
      if (i === dimIdx) continue;
      const nm  = names[i];
      const id  = ids[i];
      const val = (row?.[i]?.v ?? row?.[i]?.value ?? row?.[i]);
      const n   = toNumberLoose(val);

      if (Number.isFinite(n)) {
        b[nm] = (b[nm] ?? 0) + n;
        if (id) b.__byId[id] = (b.__byId[id] ?? 0) + n;

        const k = normColKey(nm);
        let st = b.__stats[k];
        if (!st) st = b.__stats[k] = { sum: 0, count: 0, min: Infinity, max: -Infinity };
        st.sum += n; st.count += 1; if (n < st.min) st.min = n; if (n > st.max) st.max = n;

        if (id) {
          let st2 = b.__statsById[id];
          if (!st2) st2 = b.__statsById[id] = { sum: 0, count: 0, min: Infinity, max: -Infinity };
          st2.sum += n; st2.count += 1; if (n < st2.min) st2.min = n; if (n > st2.max) st2.max = n;
        }
      } else {
        if (!(nm in b) && val != null) b[nm] = val;
        if (id && !(id in b.__byId) && val != null) b.__byId[id] = val;
      }
    }
  }

  return {
    get(nombreRaw) {
      if (nombreRaw == null) return null;
      return aggByKey.get(canonKeyByNivel(nivel, nombreRaw)) || null;
    }
  };
}
function getCol(rowAgg, key){
  if (!rowAgg) return undefined;
  const k = String(key || '');
  if (k in rowAgg) return rowAgg[k];
  if (rowAgg.__byId && k in rowAgg.__byId) return rowAgg.__byId[k];
  const want = normColKey(k);
  for (const nm of Object.keys(rowAgg)) {
    if (normColKey(nm) === want) return rowAgg[nm];
  }
  return undefined;
}
function getStat(rowAgg, key, which) {
  if (!rowAgg) return NaN;
  if (which === 'count' && (key == null || key === '')) return Number(rowAgg.__rowCount || 0);
  const k = String(key || '');
  let st = rowAgg.__stats?.[normColKey(k)];
  if (!st && rowAgg.__statsById && (k in rowAgg.__statsById)) st = rowAgg.__statsById[k];
  if (!st) return NaN;
  switch (which) {
    case 'sum':   return st.sum;
    case 'avg':   return st.count ? (st.sum / st.count) : NaN;
    case 'min':   return st.count ? st.min : NaN;
    case 'max':   return st.count ? st.max : NaN;
    case 'count': return st.count;
    default:      return NaN;
  }
}

/* ============================================================================
   Rank / percentil  (1 = máximo)
============================================================================ */
function makeRankCtx(mapValues, opts = { highIsOne: true }) {
  const v = Array.from(mapValues || []).filter(Number.isFinite).sort((a,b)=>a-b); // asc
  const idx = new Map();
  for (let i=0;i<v.length;i++) if (!idx.has(v[i])) idx.set(v[i], i);
  const N = v.length;

  const rankOf = (x) => {
    if (!Number.isFinite(x) || !N) return NaN;
    const i = (idx.get(x) ?? v.indexOf(x));
    return opts.highIsOne ? (N - i) : (i + 1);
  };
  const percentileOf = (x) => {
    if (!Number.isFinite(x) || !N) return NaN;
    const i = (idx.get(x) ?? v.indexOf(x));
    return Math.round(100 * (i / (N - 1 || 1))); // 0=min, 100=max
  };

  return { rankOf, percentileOf, N };
}

/* ============================================================================
   Template tooltip/popup (incluye CSV robusto)
============================================================================ */
function renderTemplate(tpl, nombreLabel, v, rowByName, rankCtx) {
  const fmt0 = (x) => Number.isFinite(x) ? Math.round(x).toLocaleString('es-AR') : 's/d';

  // CSV helpers
  const getColVal = (row, colKey) => getCol(row, String(colKey).trim());
  const getCsvTxt = (colKey, idx1) => {
    const raw = getColVal(rowByName, colKey);
    const parts = String(raw ?? '').split(/,(?!\d)/).map(s => s.trim()); // no corta comas decimales
    const i = Math.max(1, parseInt(idx1, 10) || 1) - 1;
    return parts[i] ?? '';
  };
  const extractNums = (raw) => {
    const s = String(raw ?? '');
    const rx = /-?(?:\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,]\d+)?/g;
    const m = s.match(rx) || [];
    return m.map(toNumberLoose).filter(Number.isFinite);
  };
  const getCsvNum = (colKey, idx1) => {
    const raw = getColVal(rowByName, colKey);
    const nums = extractNums(raw);
    const i = Math.max(1, parseInt(idx1, 10) || 1) - 1;
    return nums[i];
  };

  let out = String(tpl || '');

  // Básicos
  out = out.replace(/\{\{\s*nombre\s*\}\}/gi, nombreLabel);
  out = out.replace(/\{\{\s*valor\s*\}\}/gi, (v != null && Number.isFinite(v)) ? fmt0(v) : 's/d');

  // Rank / percentil
  out = out.replace(/\{\{\s*rank\s*\}\}/gi, () => {
    const r = rankCtx?.rankOf?.(v);
    return Number.isFinite(r) ? `${r}/${rankCtx.N}` : 's/d';
  });
  out = out.replace(/\{\{\s*percentil\s*\}\}/gi, () => {
    const p = rankCtx?.percentileOf?.(v);
    return Number.isFinite(p) ? `${p}º` : 's/d';
  });

  // CSV números / texto por índice (1-based)
  out = out.replace(/\{\{\s*csvn\s*:\s*([^,}]+)\s*,\s*([^}]+)\s*\}\}/gi,
    (_m, colKey, idxStr) => {
      const val = getCsvNum(colKey, idxStr);
      return Number.isFinite(val) ? fmt0(val) : 's/d';
    }
  );
  out = out.replace(/\{\{\s*csv\s*:\s*([^,}]+)\s*,\s*([^}]+)\s*\}\}/gi,
    (_m, colKey, idxStr) => getCsvTxt(colKey, idxStr)
  );

  // Tasa con posiciones del CSV (num/den*factor)
  out = out.replace(/\{\{\s*tasaCsv\s*:\s*([^,}]+)\s*,\s*([^,}]+)\s*,\s*([^,}]+)(?:\s*,\s*([^}]+))?\s*\}\}/gi,
    (_m, colKey, iNumStr, iDenStr, factorStr) => {
      const num = getCsvNum(colKey, iNumStr);
      const den = getCsvNum(colKey, iDenStr);
      const factor = Number(factorStr ?? 100);
      const t = (Number.isFinite(num) && Number.isFinite(den) && den > 0)
        ? (num / den) * (Number.isFinite(factor) ? factor : 100) : NaN;
      return Number.isFinite(t) ? fmt0(t) : 's/d';
    }
  );

  // Columna directa por nombre o id
  out = out.replace(/\{\{\s*col\s*:\s*([^}]+)\s*\}\}/gi, (_m, colName) => {
    const raw = getCol(rowByName, String(colName || '').trim());
    const n = Number(raw);
    return Number.isFinite(n) ? fmt0(n) : (raw ?? '');
  });

  // Tasa sum(num)/sum(den)*factor sobre columnas agregadas
  out = out.replace(/\{\{\s*tasa\s*:\s*([^,}]+)\s*,\s*([^,}]+)(?:\s*,\s*([^}]+))?\s*\}\}/gi,
    (_m, numCol, denCol, factorStr) => {
      const num = getStat(rowByName, String(numCol).trim(), 'sum');
      const den = getStat(rowByName, String(denCol).trim(), 'sum');
      const factor = Number(factorStr ?? 100);
      const t = (Number.isFinite(num) && Number.isFinite(den) && den > 0)
        ? (num / den) * (Number.isFinite(factor) ? factor : 100) : NaN;
      return Number.isFinite(t) ? fmt0(t) : 's/d';
    }
  );

  // sum/avg/min/max sobre columnas agregadas
  out = out.replace(/\{\{\s*(sum|avg|min|max)\s*:\s*([^}]+?)\s*\}\}/gi,
    (_m, op, col) => fmt0(getStat(rowByName, String(col).trim(), op.toLowerCase()))
  );

  // count: usa Record Count si existe; si no, cuenta filas agregadas
  out = out.replace(/\{\{\s*count(?:\s*:\s*([^}]+))?\s*\}\}/gi,
    (_m, colOpt) => {
      if (colOpt && colOpt.trim()) return fmt0(getStat(rowByName, colOpt.trim(), 'count'));
      const candidates = ['Record Count','RECORD_COUNT','record_count','Cant_Reuniones','Reuniones','Cantidad Reuniones'];
      for (const k of candidates) {
        const v = Number(getCol(rowByName, k));
        if (Number.isFinite(v)) return fmt0(v);
      }
      return fmt0(getStat(rowByName, '', 'count'));
    }
  );

  return out;
}

/* ============================================================================
   Borde auto-contraste + Logo
============================================================================ */
function hexLuma(hex){
  const [r,g,b] = hexToRgb(hex).map(x=>x/255);
  return 0.2126*r + 0.7152*g + 0.0722*b;
}
function autoBorderFor(fill){
  try { return (hexLuma(fill) > 0.7) ? '#666666' : '#F5F5F5'; }
  catch { return '#000'; }
}
function hostAllowedForImg(u) {
  try {
    const { hostname } = new URL(u);
    return /^datastudio\.google\.com$/.test(hostname)
      || /^lookerstudio\.google\.com$/.test(hostname)
      || /^drive\.google\.com$/.test(hostname)
      || /^lh[3-6]\.googleusercontent\.com$/.test(hostname)
      || /^lh[3-6]\.google\.com$/.test(hostname)
      || u.startsWith('data:');
  } catch { return false; }
}
function renderLogo(mapContainerEl, style, state) {
  if (state.logoEl) { try { state.logoEl.remove(); } catch {} state.logoEl = null; }
  if (state.logoResizeObs) { try { state.logoResizeObs.disconnect(); } catch {} state.logoResizeObs = null; }
  if (!style.showLogo) return;

  let src = (style.logoDataUrl || '').trim();
  if (!src) {
    const url = (style.logoUrl || '').trim();
    if (!url || !hostAllowedForImg(url)) {
      if (!url) return;
      console.warn('[Logo] Host no permitido por CSP. Usá data: o Drive thumbnail.');
      return;
    }
    src = url;
  }

  const img = document.createElement('img');
  img.alt = 'Logo';
  img.draggable = false;
  img.src = src;

  const computeWidthPx = () => {
    if ((style.logoWidthMode || 'px') === 'percent') {
      const cw = mapContainerEl?.clientWidth || mapContainerEl?.offsetWidth || 800;
      const pct = Math.max(1, Math.min(100, Number(style.logoWidthPercent || 10)));
      return Math.max(16, Math.round((cw * pct) / 100));
    }
    return Math.max(16, Number(style.logoWidthPx || 160));
  };

  img.removeAttribute('width'); img.removeAttribute('height');
  Object.assign(img.style, {
    position: 'absolute',
    width: computeWidthPx() + 'px',
    height: 'auto',
    aspectRatio: 'auto',
    objectFit: 'contain',
    opacity: String(Math.max(0, Math.min(1, Number(style.logoOpacity ?? 0.9)))),
    pointerEvents: 'none',
    userSelect: 'none',
    filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.25))',
    zIndex: '9999'
  });

  const pad = '10px';
  const pos = (style.logoPosition || 'bottomleft');
  img.style.top = (pos.startsWith('top') ? pad : '');
  img.style.bottom = (pos.startsWith('bottom') ? pad : '');
  img.style.left = (pos.endsWith('left') ? pad : '');
  img.style.right = (pos.endsWith('right') ? pad : '');

  const el = mapContainerEl;
  if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
  el.appendChild(img);
  state.logoEl = img;

  if ((style.logoWidthMode || 'px') === 'percent' && 'ResizeObserver' in window) {
    const ro = new ResizeObserver(() => {
      if (!state.logoEl) return;
      state.logoEl.style.width = computeWidthPx() + 'px';
    });
    ro.observe(mapContainerEl);
    state.logoResizeObs = ro;
  }
}

/* ============================================================================
   Param: leer 'param_nivel' o similares del mensaje
============================================================================ */
function readParamNivelFromMessage(message, dimIdx) {
  try {
    const T = message?.tables?.DEFAULT;
    const H = T?.headers || [];
    const R = T?.rows || [];
    if (!H.length || !R.length) return null;

    // 1) Buscar columna que suene a "param_nivel / nivel"
    let idx = H.findIndex(h => /param.*nivel|^nivel$|jerarquia|barrio.*comuna/i.test((h?.id || h?.name || '')));
    if (idx >= 0) {
      const raw = R[0]?.[idx];
      const s = String(raw?.v ?? raw?.value ?? raw ?? '').toLowerCase();
      if (s.includes('comuna')) return 'comuna';
      if (s.includes('barrio')) return 'barrio';
    }

    // 2) Heurística por nombre de la dimensión seleccionada
    const f = message?.fieldsByConfigId?.geoDimension?.[0];
    const n = (f?.name || f?.id || '').toLowerCase();
    if (n.includes('comuna')) return 'comuna';
    if (n.includes('barrio')) return 'barrio';
  } catch {}
  return null; // no se pudo determinar
}
// Busca en headers/rows una columna que luzca como "nivel"/"jerarquía"/"barrio-comuna"
// y devuelve 'barrio' | 'comuna' si la encuentra; si no, null.
function extractParamNivelFromRows(headers, rows) {
  if (!headers || !headers.length || !rows || !rows.length) return null;

  // Candidatos por id o nombre
  const matchNivel = (h) => {
    const s = (h?.name || h?.id || '').toLowerCase();
    return /(^(param.*)?nivel$|^nivel$|jerar|barrio\s*\/\s*comuna|barrio.*comuna)/i.test(s);
  };

  // Encontrar índice candidato (el primero que calce)
  let idx = headers.findIndex(matchNivel);
  if (idx < 0) return null;

  // Tomar el primer valor no vacío
  for (const row of rows) {
    let cell = row?.[idx];
    if (cell && typeof cell === 'object' && 'v' in cell) cell = cell.v;
    const val = ('' + (cell ?? '')).trim().toLowerCase();
    if (val === 'barrio' || val === 'comuna') return val;
  }

  return null;
}

/* ============================================================================
   Render principal
============================================================================ */
const __leafletState = { map: null, layer: null, legend: null, logoEl: null, logoResizeObs: null };

export default function drawVisualization(container, message = {}) {
  container.style.width = '100%';
  container.style.height = '100%';

  const style  = readStyle(message);

  // Resolvemos índices de dimensión/métrica (ignora param_nivel y evita extras)
  const idx = resolveIndices(message);

  // Nivel: parámetro → estilo → heurística por nombre de dimensión
  const paramNivel = readParamNivelFromMessage(message, idx.dim);
  let nivel = paramNivel || style.nivelJerarquia || 'barrio';

  // Elegir GeoJSON por nivel
  const geojson =
    (nivel === 'comuna' && GEOJSON_COMUNAS) ? GEOJSON_COMUNAS : GEOJSON;

  if (DEBUG) {
    const s = message?.styleById || message?.style || {};
    const readable = {};
    for (const [k,v] of Object.entries(s)) {
      const val = (v && typeof v === 'object' && 'value' in v) ? v.value : v;
      readable[k] = (val && typeof val === 'object' && 'color' in val) ? val.color : val;
    }
    console.group('[Style dump]'); console.table(readable);
    console.log('nivel (param>estilo):', nivel);
    console.log('dimIdx:', idx.dim, 'metIdx:', idx.metric);
    console.groupEnd();
  }

  // Valor por polígono (SUM met) + lookup por texto — ambas usando clave CANÓNICA según nivel
  const stats     = buildValueMap(message, idx.dim, idx.metric, nivel);
  const rowLookup = buildRowLookup(message, idx.dim, nivel);
  const rankCtx   = makeRankCtx(stats?.map?.values?.(), { highIsOne: true });

  // Categorías automáticas si valores ∈ {1,2,3}
  const uniqVals = new Set();
  for (const v of (stats?.map?.values?.() || [])) { if (Number.isFinite(v)) uniqVals.add(v); }
  const autoCategory = uniqVals.size > 0 && [...uniqVals].every(v => Number.isInteger(v) && v >= 1 && v <= 3);
  const categoryModeActive = !!style.categoryMode || autoCategory;

  // Leaflet map
  if (!__leafletState.map) {
    __leafletState.map = L.map(container, { zoomControl: true, attributionControl: false });
  } else {
    const current = __leafletState.map.getContainer();
    if (current && current !== container) {
      container.appendChild(current);
      setTimeout(() => { try { __leafletState.map.invalidateSize(); } catch {} }, 0);
    }
    if (__leafletState.layer)  { try { __leafletState.map.removeLayer(__leafletState.layer); } catch {} }
    if (__leafletState.legend) { try { __leafletState.legend.remove(); } catch {} }
    __leafletState.layer = null; __leafletState.legend = null;
  }
  const map = __leafletState.map;

  const styleFn = (feature) => {
    const key = getFeatureKey(feature, nivel, style.geojsonProperty);
    const v = stats.map.get(key);

    // color
    let fillColor;
    if (Number.isFinite(v) && categoryModeActive) {
      if (v === style.cat1Value)      fillColor = style.cat1Color;
      else if (v === style.cat2Value) fillColor = style.cat2Color;
      else if (v === style.cat3Value) fillColor = style.cat3Color;
      else                            fillColor = style.categoryOtherColor || style.colorMissing;
    } else if (stats.count && Number.isFinite(v)) {
      const t = (v - stats.min) / ((stats.max - stats.min) || 1);
      fillColor = getColorFromScaleOrPalette(t, style);
    } else {
      fillColor = style.colorMissing;
    }

    const borderCol = style.showBorders
      ? (String(style.borderColor).toLowerCase() === 'auto' ? autoBorderFor(fillColor) : style.borderColor)
      : 'transparent';

    return {
      color:   borderCol,
      weight:  style.showBorders ? style.borderWidth  : 0,
      opacity: style.showBorders ? style.borderOpacity: 0,
      fillColor,
      fillOpacity: style.opacity
    };
  };

  const layer = L.geoJSON(geojson, {
    style: styleFn,
    onEachFeature: (feature, lyr) => {
      const nombreLabel = getFeatureNameProp(feature, nivel, style.geojsonProperty) ?? '—';
      const key         = getFeatureKey(feature, nivel, style.geojsonProperty);
      const v           = stats.map.get(key);
      const rowByName   = rowLookup.get(nombreLabel);

      const popupTpl   = style.popupFormat || '<strong>{{nombre}}</strong><br/>Valor: {{valor}}';
      const tooltipTpl = (style.tooltipFormat && style.tooltipFormat.trim()) ? style.tooltipFormat : popupTpl;

      // Tooltip (hover)
      if (style.showLabels) {
        const tooltipHtml = renderTemplate(tooltipTpl, nombreLabel, v, rowByName, rankCtx);
        try { lyr.unbindTooltip(); } catch {}
        lyr.bindTooltip(tooltipHtml, { sticky: true, direction: 'auto', opacity: 0.95 });
      }
      // Popup (click)
      const popupHtml = renderTemplate(popupTpl, nombreLabel, v, rowByName, rankCtx);
      lyr.bindPopup(popupHtml, { closeButton: false });
    }
  }).addTo(map);
  __leafletState.layer = layer;

  // fit bounds
  try {
    const b = layer.getBounds();
    if (b?.isValid && b.isValid()) {
      map.fitBounds(b, { padding: [16, 16] });
      setTimeout(() => { try { map.invalidateSize(); } catch {} }, 0);
    } else { warn('[Viz] Bounds inválidos'); }
  } catch (e) { warn('[Viz] No se pudo ajustar bounds:', e); }

  // leyenda
  if (style.showLegend) {
    const legend = L.control({ position: style.legendPosition || 'bottomright' });
    legend.onAdd = () => {
      const div = L.DomUtil.create('div', 'legend');
      try { L.DomEvent.disableClickPropagation(div); L.DomEvent.disableScrollPropagation(div); } catch {}
      Object.assign(div.style, {
        background: 'rgba(255,255,255,.9)',
        padding: '8px 10px',
        borderRadius: '8px',
        boxShadow: '0 1px 4px rgba(0,0,0,.25)',
        font: '12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
      });

      if (categoryModeActive) {
        const entries = [
          { col: style.cat1Color, lbl: style.cat1Label, val: style.cat1Value },
          { col: style.cat2Color, lbl: style.cat2Label, val: style.cat2Value },
          { col: style.cat3Color, lbl: style.cat3Label, val: style.cat3Value },
          { col: style.categoryOtherColor, lbl: 'Otros' }
        ];
        for (const e of entries) {
          const row = document.createElement('div');
          row.style.display = 'flex'; row.style.alignItems = 'center'; row.style.gap = '8px'; row.style.margin = '2px 0';
          const sw = document.createElement('span');
          sw.style.display='inline-block'; sw.style.width='14px'; sw.style.height='14px';
          sw.style.border='1px solid rgba(0,0,0,.2)'; sw.style.background=e.col;
          const label = document.createElement('span');
          label.textContent = e.lbl + (typeof e.val === 'number' ? ` (=${e.val})` : '');
          row.appendChild(sw); row.appendChild(label); div.appendChild(row);
        }
        return div;
      }

      if (!stats || !Number.isFinite(stats.min) || !Number.isFinite(stats.max) || !stats.count) {
        div.textContent = 'Sin datos'; return div;
      }
      const breaks = 5;
      const fmt0 = (x) => Number.isFinite(x) ? Math.round(x).toLocaleString('es-AR') : 's/d';
      for (let i = 0; i < breaks; i++) {
        const a = stats.min + (stats.max - stats.min) * (i / breaks);
        const b = stats.min + (stats.max - stats.min) * ((i + 1) / breaks);
        const mid = (a + b) / 2;
        const t = (mid - stats.min) / ((stats.max - stats.min) || 1);
        const col = getColorFromScaleOrPalette(t, style);

        const row = document.createElement('div');
        row.style.display='flex'; row.style.alignItems='center'; row.style.gap='8px'; row.style.margin='2px 0';

        const sw = document.createElement('span');
        sw.style.display='inline-block'; sw.style.width='14px'; sw.style.height='14px';
        sw.style.border='1px solid rgba(0,0,0,.2)'; sw.style.background=col;

        const label = document.createElement('span');
        label.textContent = `${fmt0(a)} – ${fmt0(b)}`;

        row.appendChild(sw); row.appendChild(label); div.appendChild(row);
      }
      return div;
    };
    legend.addTo(map);
    __leafletState.legend = legend;
  }

  // logo
  renderLogo(map.getContainer(), style, __leafletState);

  if (DEBUG) dbg('[Viz] Render OK — features:', geojson?.features?.length || 0);
}

/* ============================================================================
   Wrapper dscc
============================================================================ */
(function () {
  'use strict';

  function ensureContainer() {
    let el = document.getElementById('container');
    if (!el) {
      el = document.createElement('div');
      el.id = 'container';
      el.style.width = '100%';
      el.style.height = '100%';
      document.body.appendChild(el);
    }
    return el;
  }

  function inspectAndRender(data) {
    try {
      if (DEBUG) {
        console.group('[Inspector] DSCC objectTransform');
        const t = data?.tables?.DEFAULT;
        console.log('DEFAULT keys:', t ? Object.keys(t) : '(no DEFAULT)');
        console.log('headers raw:', t?.headers);
        if (t?.rows?.length) {
          const r0 = t.rows[0];
          console.log('row[0] typeof/Array?', typeof r0, Array.isArray(r0));
          try { console.log('row[0] keys:', Object.keys(r0)); } catch {}
          if (r0 && typeof r0 === 'object' && 'c' in r0) console.log('row[0].c len:', Array.isArray(r0.c) ? r0.c.length : typeof r0.c);
        } else { console.warn('DEFAULT sin filas'); }
      }

      const norm = normalizeDEFAULTTable(data);
      const { headers, rows } = toHeadersRows(norm);

      // ← NUEVO: priorizar el nivel que venga en las filas (param) por sobre el estilo
      const incomingStyle  = data.styleById || data.style || {};
      const nivelFromRows  = extractParamNivelFromRows(headers, rows);
      const overrideStyle  = { ...incomingStyle };
      if (nivelFromRows) {
        // Forzamos el estilo para que drawVisualization elija el GeoJSON correcto
        overrideStyle.nivelJerarquia = { value: nivelFromRows };
        if (DEBUG) console.log('[nivel desde filas]', nivelFromRows);
      }

      const tableLike = {
        fields: data.fields || {},
        tables: { DEFAULT: { headers, rows } },
        fieldsByConfigId: data.fieldsByConfigId || {},
        // ← usar el estilo override (param > estilo)
        styleById: overrideStyle
      };


      drawVisualization(ensureContainer(), tableLike);
      if (DEBUG) { console.groupEnd(); }
      if (typeof window !== 'undefined') {
        window.__dsccLast = { raw: data, normalized: norm, headers, rows };
      }
    } catch (e) {
      err('[Viz] Error procesando datos:', e);
    }
  }

  async function initWrapper(attempt = 1) {
    try {
      const MAX_ATTEMPTS = 5;
      if (window.__VIZ_SUBSCRIBED) { dbg('[Viz] initWrapper: ya suscripto, salgo.'); return; }

      const d = await waitForDscc().catch(() => null);

      if (d && typeof d.subscribeToData === 'function') {
        dbg('[Viz] dscc listo (', d === dsccImported ? 'bundle' : 'window', ')');
        dbg('[Viz] transforms:', { object: !!d.objectTransform, table: !!d.tableTransform });

        if (d.objectTransform) {
          d.subscribeToData(inspectAndRender, { transform: d.objectTransform });
          window.__VIZ_SUBSCRIBED = true;
        } else {
          console.warn('[Viz] objectTransform no disponible; suscribo sin transform');
          d.subscribeToData(inspectAndRender);
          window.__VIZ_SUBSCRIBED = true;
        }

        if (DEBUG && d.tableTransform && !window.__TAP_TT_DONE) {
          window.__TAP_TT_DONE = true;
          const once = (fn) => { let done = false; return (x) => { if (!done) { done = true; fn(x); } }; };
          d.subscribeToData(
            once((t) => {
              console.group('[tap.tableTransform]');
              try {
                console.log('tables keys:', Object.keys(t?.tables || {}));
                console.log('DEFAULT sample row:', t?.tables?.DEFAULT?.[0]);
              } finally { console.groupEnd(); }
            }),
            { transform: d.tableTransform }
          );
        }
        return;
      }

      ensureDsccScript();
      if (attempt < MAX_ATTEMPTS) {
        warn(`[Viz] dscc no disponible (attempt ${attempt}), reintento en 1s…`);
        setTimeout(() => initWrapper(attempt + 1), 1000);
        return;
      }

      // Fallback (mock)
      err('[Viz] dscc no disponible tras reintentos. Fallback mock.');
      const container = ensureContainer();
      const mockData = {
        tables: {
          DEFAULT: {
            headers: [{ id: 'barrio', name: 'Barrio' }, { id: 'poblacion', name: 'Población' }],
            rows: [
              ['Palermo', 225000],
              ['Recoleta', 188000],
            ],
          },
        },
        fieldsByConfigId: {
          geoDimension: [{ id: 'barrio', name: 'Barrio' }],
          metricPrimary: [{ id: 'poblacion', name: 'Población' }],
        },
      };
      drawVisualization(container, mockData);
      window.__VIZ_SUBSCRIBED = 'mock';

    } catch (e) { err('[Viz] Error initWrapper:', e); }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { initWrapper().catch(err); });
  } else {
    initWrapper().catch(err);
  }  
})();

try {
  window.__viz = Object.assign(window.__viz || {}, {
    resolveIndices,
    geoState() {
      const raw   = window.__dsccLast?.raw;
      const style = raw?.styleById || {};
      const styleNivel = style.nivelJerarquia?.value || 'barrio';
      // Si querés, podés replicar aquí la misma lógica que en drawVisualization
      return {
        nivel: styleNivel, // (si usás readParamNivelFromMessage, podés evaluarlo también)
        hasComunas: !!(GEOJSON_COMUNAS && GEOJSON_COMUNAS.features),
        comunasCount: (GEOJSON_COMUNAS?.features?.length || 0),
        barriosCount: (GEOJSON?.features?.length || 0)
      };
    }
  });
} catch {}
