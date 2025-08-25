// Community Viz 2025 — Leaflet + dscc (bundle-first) + Normalizador + DEBUG
// Agregado por barrio + plantillas avanzadas (sum/avg/min/max/count/tasa/rank/percentil)
// Paletas + categórico + tooltip=popup + logo (gs://) + borde auto-contraste opcional

import * as dsccImported from '@google/dscc';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './Visualization.css';
import geojsonText from './barrioscaba.geojson?raw';

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
   Sanitizador de query (NBSP, espacios colados)
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
   GeoJSON
============================================================================ */
let GEOJSON;
try { GEOJSON = JSON.parse(geojsonText); }
catch (e) { err('[Viz] GeoJSON inválido:', e); GEOJSON = { type: 'FeatureCollection', features: [] }; }

/* ============================================================================
   Helpers texto/color
============================================================================ */
function cleanString(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[\u00A0\u1680\u2000-\u200D\u202F\u205F\u2060\u3000\uFEFF]/g,' ')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}
const normalizeKey = (s) => cleanString(s);
const normalizeKeyFuzzy = (s) => {
  const raw = cleanString(s);
  const compact = raw.replace(/\s+/g,'');
  const alnum   = raw.replace(/[^\p{L}\p{N}]+/gu,'');
  return Array.from(new Set([raw, compact, alnum]));
};

const clamp01 = (t) => Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
const lerp = (a,b,t) => a + (b - a) * clamp01(t);
const toHex = (x) => Math.round(x).toString(16).padStart(2,'0');
const rgb = (r,g,b) => `#${toHex(r)}${toHex(g)}${toHex(b)}`;

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
  oranges: ['#fff5eb','#fee6ce','#fdd0a2','#fdae6b','#fd8d3c','#f16913','#d94801','#8c2d04']
};
Object.assign(PRESET_PALETTES, {
  magma:   ['#000004','#1b0c41','#4f0a6d','#7c1d6f','#a52c60','#cf4446','#ed6925','#fb9b06','#f7d13d','#fcfdbf'],
  plasma:  ['#0d0887','#5b02a3','#9a179b','#cb4679','#ed7953','#fb9f3a','#fdca26','#f0f921'],
  cividis: ['#00224e','#233b67','#3f5a78','#5a7b89','#7a9c98','#9fbc9f','#c9dca0','#f2f4b3'],
  turbo:   ['#23171b','#3b0f70','#6a00a8','#9c179e','#bd3786','#d8576b','#ed7953','#fb9f3a','#fdca26','#f0f921'],
  Spectral:['#9e0142','#d53e4f','#f46d43','#fdae61','#fee08b','#e6f598','#abdda4','#66c2a5','#3288bd','#5e4fa2'],
  soloAmarillo: ['#FFFFF2','#FFFFE6','#FFFFCC','#FFFFB3','#FFFF99','#FFFF66','#FFFF33','#FFFF00'],
  coolToYellow: ['#08306B','#08519C','#2171B5','#41B6C4','#7FCDBB','#C7E9B4','#FFFFCC','#FFFF66','#FFFF00']
});
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
      const colors = raw.split(',').map(x=>x.trim()).filter(x=>/^#?[0-9a-f]{6}$/i.test(x)).map(x=>x.startsWith('#')?x:'#'+x);
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
    nivelJerarquia: (s.nivelJerarquia && s.nivelJerarquia.value) || 'barrio',
    geojsonProperty: ((s.geojsonProperty && s.geojsonProperty.value) || '').toString().trim(),

    colorScale: (s.colorScale && s.colorScale.value) || 'greenToRed',
    invertScale: !!(s.invertScale && s.invertScale.value),
    colorPalette: getPalette(),

    opacity: num(s.opacity, 0.45),
    colorMissing: readColor(s.colorMissing, '#cccccc'),

    showLegend: (s.showLegend && s.showLegend.value !== undefined) ? !!s.showLegend.value : true,
    legendPosition: (s.legendPosition && s.legendPosition.value) || 'bottomright',
    showLabels: !!(s.showLabels && s.showLabels.value),

    showBorders: (s.showBorders && s.showBorders.value !== undefined) ? !!s.showBorders.value : true,
    borderColor: readColor(s.borderColor, '#000000'),
    borderWidth: num(s.borderWidth, 1),
    borderOpacity: num(s.borderOpacity, 1),

    // Popup / Tooltip
    popupFormat: (s.popupFormat && s.popupFormat.value) || '<strong>{{nombre}}</strong><br/>Valor: {{valor}}',
    tooltipFormat: (s.tooltipFormat && s.tooltipFormat.value) || '',

    // Categorías (opcional)
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

    // Branding (logo)
    logoUrl: (s.logoUrl && s.logoUrl.value) || '',
    logoPosition: (s.logoPosition && s.logoPosition.value) || 'bottomleft',
    logoWidthPx: num(s.logoWidthPx, 56),
    logoOpacity: num(s.logoOpacity, 0.9)
  };
}

/* ============================================================================
   Nombres de feature
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

/* ============================================================================
   Números / Normalizadores
============================================================================ */
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
   Normalizar tabla DEFAULT
============================================================================ */
function normalizeDEFAULTTable(data) {
  const T = data?.tables?.DEFAULT;
  if (!T) return { ids: [], names: [], rows: [] };

  // Caso 1: {headers, rows}
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

  // Caso 2: array/obj indexado
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
   Agregado por barrio: valor para colorear
============================================================================ */
function buildValueMap(tableLike) {
  const tableRaw = tableLike?.tables?.DEFAULT || {};
  const headers = tableRaw.headers || [];
  const rows    = tableRaw.rows || [];

  let idxDim = -1, idxMet = -1;

  const fbc = tableLike?.fieldsByConfigId || {};
  const dimIdPref = fbc.geoDimension?.[0]?.id || fbc.geoDimension?.[0]?.name;
  const metIdPref = fbc.metricPrimary?.[0]?.id || fbc.metricPrimary?.[0]?.name;
  if (dimIdPref) idxDim = headers.findIndex(h => (h.id || h.name) === dimIdPref);
  if (metIdPref) idxMet = headers.findIndex(h => (h.id || h.name) === metIdPref);

  const fields = tableLike?.fields || {};
  if (idxDim < 0 && Array.isArray(fields.dimensions) && fields.dimensions.length) {
    const wanted = (fields.dimensions[0].id || fields.dimensions[0].name || '').toString();
    idxDim = headers.findIndex(h => (h.id || h.name) === wanted);
  }
  if (idxMet < 0 && Array.isArray(fields.metrics) && fields.metrics.length) {
    const wanted = (fields.metrics[0].id || fields.metrics[0].name || '').toString();
    idxMet = headers.findIndex(h => (h.id || h.name) === wanted);
  }
  if (idxDim < 0) idxDim = headers.findIndex(h => /barrio|comuna|nombre|name|texto/i.test(h?.name || h?.id || ''));
  if (idxDim < 0 && headers.length) idxDim = 0;

  // heurística si no hay métrica marcada
  if (idxMet < 0 && rows.length) {
    const sampleN = Math.min(rows.length, 25);
    outer:
    for (let j = 0; j < headers.length; j++) {
      if (j === idxDim) continue;
      let hits = 0, seen = 0;
      for (let r = 0; r < sampleN; r++) {
        const n = toNumberLoose(rows[r][j]);
        if (Number.isFinite(n)) hits++;
        seen++;
      }
      if (seen && hits / seen >= 0.6) { idxMet = j; break outer; }
    }
  }

  if (idxDim < 0 || idxMet < 0) {
    warn('[Viz] No se encontraron campos válidos para dimensión/métrica', { idxDim, idxMet });
    return { map: new Map(), min: NaN, max: NaN, count: 0 };
  }

  const canon = (s) => normalizeKey(String(s ?? ''));
  const map = new Map(); // barrio → SUM(métrica)
  for (const row of rows) {
    const keyRaw = (row?.[idxDim]?.v ?? row?.[idxDim]?.value ?? row?.[idxDim] ?? '');
    if (!keyRaw) continue;
    const key = canon(keyRaw);
    const val = toNumberLoose(row?.[idxMet]);
    if (!Number.isFinite(val)) continue;
    map.set(key, (map.get(key) ?? 0) + val);
  }

  const values = Array.from(map.values());
  const min = values.length ? Math.min(...values) : NaN;
  const max = values.length ? Math.max(...values) : NaN;

  dbg('[Viz] agregación por barrio:', map.size, 'min/max:', min, max);
  return { map, min, max, count: values.length };
}

/* ============================================================================
   Row lookup agregado por barrio + estadísticas por columna
============================================================================ */
function normColKey(s){
  return String(s ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[\u00A0\u1680\u2000-\u200D\u202F\u205F\u2060\u3000\uFEFF]/g,' ')
    .replace(/\s+/g,' ').trim().toLowerCase();
}
function buildRowLookup(message) {
  const hdrs = message?.tables?.DEFAULT?.headers || [];
  const rows = message?.tables?.DEFAULT?.rows || [];
  const names = hdrs.map(h => h.name || h.id || '');

  // localizar dimensión
  let idxDim = -1;
  const fbc = message?.fieldsByConfigId || {};
  const dimIdPref = fbc.geoDimension?.[0]?.id || fbc.geoDimension?.[0]?.name;
  if (dimIdPref) idxDim = hdrs.findIndex(h => (h.id || h.name) === dimIdPref);
  if (idxDim < 0 && Array.isArray(message?.fields?.dimensions) && message.fields.dimensions.length) {
    const wanted = (message.fields.dimensions[0].id || message.fields.dimensions[0].name || '').toString();
    idxDim = hdrs.findIndex(h => (h.id || h.name) === wanted);
  }
  if (idxDim < 0) idxDim = hdrs.findIndex(h => /barrio|comuna|nombre|name|texto/i.test(h?.name || h?.id || ''));
  if (idxDim < 0 && hdrs.length) idxDim = 0;

  const canon = (s) => normalizeKey(String(s ?? ''));
  const aggByKey = new Map(); // key → { __stats, __rowCount, columnas… }

  for (const row of rows) {
    const keyRaw = (row?.[idxDim]?.v ?? row?.[idxDim]?.value ?? row?.[idxDim] ?? '');
    if (!keyRaw) continue;
    const key = canon(keyRaw);

    let b = aggByKey.get(key);
    if (!b) { b = { __stats: Object.create(null), __rowCount: 0 }; aggByKey.set(key, b); }
    b.__rowCount++;

    for (let i = 0; i < names.length; i++) {
      if (i === idxDim) continue;
      const nm  = names[i];
      const val = (row?.[i]?.v ?? row?.[i]?.value ?? row?.[i]);
      const n   = toNumberLoose(val);

      if (Number.isFinite(n)) {
        b[nm] = (b[nm] ?? 0) + n; // SUM por compatibilidad {{col:...}}
        const k = normColKey(nm);
        let st = b.__stats[k];
        if (!st) st = b.__stats[k] = { sum: 0, count: 0, min: Infinity, max: -Infinity };
        st.sum += n; st.count += 1; if (n < st.min) st.min = n; if (n > st.max) st.max = n;
      } else if (!(nm in b) && val != null) {
        b[nm] = val; // primer texto no-nulo
      }
    }
  }

  return {
    get(nombreRaw) {
      if (nombreRaw == null) return null;
      return aggByKey.get(canon(nombreRaw)) || null;
    }
  };
}
function getCol(rowAgg, key){
  if (!rowAgg) return undefined;
  if (key in rowAgg) return rowAgg[key]; // exacto
  const want = normColKey(key);
  for (const k of Object.keys(rowAgg)) if (normColKey(k) === want) return rowAgg[k];
  return undefined;
}
function getStat(rowAgg, key, which) {
  if (!rowAgg) return NaN;
  if (which === 'count' && (key == null || key === '')) return Number(rowAgg.__rowCount || 0);
  const st = rowAgg.__stats?.[normColKey(key)];
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
   Rank / percentil
============================================================================ */
function makeRankCtx(mapValues) {
  const v = Array.from(mapValues || []).filter(Number.isFinite).sort((a,b)=>a-b);
  const idx = new Map();
  for (let i=0;i<v.length;i++) if (!idx.has(v[i])) idx.set(v[i], i);
  const N = v.length;
  return {
    rankOf(x){ if (!Number.isFinite(x) || !N) return NaN; return (idx.get(x) ?? v.indexOf(x)) + 1; },
    percentileOf(x){ if (!Number.isFinite(x) || !N) return NaN; const i=(idx.get(x) ?? v.indexOf(x)); return Math.round(100 * (i / (N - 1 || 1))); },
    N
  };
}

/* ============================================================================
   Templating tooltip/popup
============================================================================ */
function renderTemplate(tpl, nombreLabel, v, rowByName, rankCtx) {
  const fmt0 = (x) => Number.isFinite(x) ? Math.round(x).toLocaleString('es-AR') : 's/d';
  let out = String(tpl || '')
    .replace(/\{\{\s*nombre\s*\}\}/gi, nombreLabel)
    .replace(/\{\{\s*valor\s*\}\}/gi, (v != null && Number.isFinite(v)) ? fmt0(v) : 's/d')
    .replace(/\{\{\s*rank\s*\}\}/gi, () => {
      const r = rankCtx?.rankOf?.(v);
      return Number.isFinite(r) ? `${r}/${rankCtx.N}` : 's/d';
    })
    .replace(/\{\{\s*percentil\s*\}\}/gi, () => {
      const p = rankCtx?.percentileOf?.(v);
      return Number.isFinite(p) ? `${p}º` : 's/d';
    })
    // {{col:NombreExacto}}
    .replace(/\{\{\s*col\s*:\s*([^}]+)\s*\}\}/gi, (_m, colName) => {
      const raw = getCol(rowByName, String(colName || '').trim());
      const n = Number(raw);
      return Number.isFinite(n) ? fmt0(n) : (raw ?? '');
    });

  // {{tasa:Num, Den[, factor]}}
  out = out.replace(/\{\{\s*tasa\s*:\s*([^,}]+)\s*,\s*([^,}]+)(?:\s*,\s*([^}]+))?\s*\}\}/gi,
    (_m, numCol, denCol, factorStr) => {
      const num = Number(getCol(rowByName, String(numCol).trim()));
      const den = Number(getCol(rowByName, String(denCol).trim()));
      const factor = Number(factorStr ?? 1000);
      const tasa = (Number.isFinite(num) && Number.isFinite(den) && den > 0)
        ? (num / den) * (Number.isFinite(factor) ? factor : 1000)
        : NaN;
      return Number.isFinite(tasa) ? fmt0(tasa) : 's/d';
    });

  // {{sum/avg/min/max:Col}}
  out = out.replace(/\{\{\s*(sum|avg|min|max)\s*:\s*([^}]+?)\s*\}\}/gi,
    (_m, op, col) => fmt0(getStat(rowByName, String(col).trim(), op.toLowerCase()))
  );

  // {{count}}  ó  {{count:Col}}
  out = out.replace(/\{\{\s*count(?:\s*:\s*([^}]+))?\s*\}\}/gi,
    (_m, colOpt) => {
      const v = (colOpt && colOpt.trim())
        ? getStat(rowByName, colOpt.trim(), 'count')
        : getStat(rowByName, '', 'count');
      return fmt0(v);
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
function normalizeGcsUrl(u) {
  if (!u) return u;
  if (typeof u === 'string' && u.startsWith('gs://')) {
    const rest = u.slice(5);
    const slash = rest.indexOf('/');
    if (slash > 0) {
      const bucket = rest.slice(0, slash);
      const key = rest.slice(slash + 1);
      return `https://storage.googleapis.com/${bucket}/${key}`;
    }
  }
  return u;
}
function renderLogo(mapContainerEl, style, state) {
  if (state.logoEl) { try { state.logoEl.remove(); } catch {} state.logoEl = null; }
  const srcRaw = (style && style.logoUrl) ? String(style.logoUrl).trim() : '';
  if (!srcRaw) return;
  const src = normalizeGcsUrl(srcRaw);
  const img = document.createElement('img');
  img.src = src; img.alt = 'Logo'; img.draggable = false;
  Object.assign(img.style, {
    position: 'absolute',
    width: ((style.logoWidthPx || 56) | 0) + 'px',
    opacity: String(Math.max(0, Math.min(1, Number(style.logoOpacity ?? 0.9)))),
    pointerEvents: 'none',
    userSelect: 'none',
    filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.25))',
    zIndex: '9999'
  });
  const pad = '10px'; const pos = (style.logoPosition || 'bottomleft');
  img.style.top = (pos.startsWith('top') ? pad : '');
  img.style.bottom = (pos.startsWith('bottom') ? pad : '');
  img.style.left = (pos.endsWith('left') ? pad : '');
  img.style.right = (pos.endsWith('right') ? pad : '');
  const el = mapContainerEl;
  if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
  el.appendChild(img);
  state.logoEl = img;
}

/* ============================================================================
   Render principal
============================================================================ */
const __leafletState = { map: null, layer: null, legend: null, logoEl: null };

export default function drawVisualization(container, message = {}) {
  container.style.width = '100%';
  container.style.height = '100%';

  const style  = readStyle(message);
  const nivel  = style.nivelJerarquia || 'barrio';

  if (DEBUG) {
    const s = message?.styleById || message?.style || {};
    const readable = {};
    for (const [k,v] of Object.entries(s)) {
      const val = (v && typeof v === 'object' && 'value' in v) ? v.value : v;
      readable[k] = (val && typeof val === 'object' && 'color' in val) ? val.color : val;
    }
    console.group('[Style dump]'); console.table(readable); console.log('readStyle():', style); console.groupEnd();
  }

  const stats  = buildValueMap(message);
  const rowLookup = buildRowLookup(message);
  const rankCtx = makeRankCtx(stats?.map?.values?.());
  const geojson = (typeof GEOJSON !== 'undefined') ? GEOJSON : { type: 'FeatureCollection', features: [] };

  // categórico auto si valores ∈ {1,2,3}
  const uniqVals = new Set();
  for (const v of (stats?.map?.values?.() || [])) { if (Number.isFinite(v)) uniqVals.add(v); }
  const autoCategory = uniqVals.size > 0 && [...uniqVals].every(v => Number.isInteger(v) && v >= 1 && v <= 3);
  const categoryModeActive = !!style.categoryMode || autoCategory;

  // mapa
  if (!__leafletState.map) {
    __leafletState.map = L.map(container, { zoomControl: true, attributionControl: true });
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
    const nombreRaw = getFeatureNameProp(feature, nivel, style.geojsonProperty);
    const key = normalizeKey(nombreRaw);
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
      const nombreRaw   = getFeatureNameProp(feature, nivel, style.geojsonProperty) ?? '—';
      const nombreLabel = String(nombreRaw);
      const key         = normalizeKey(nombreRaw);
      const v           = stats.map.get(key);
      const rowByName   = rowLookup.get(nombreRaw);

      const popupTpl   = style.popupFormat || '<strong>{{nombre}}</strong><br/>Valor: {{valor}}';
      const tooltipTpl = (style.tooltipFormat && style.tooltipFormat.trim()) ? style.tooltipFormat : popupTpl;

      // Tooltip (hover) — para evitar duplicados unbind antes
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

  // fit
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
   Utilidad de formateo breve
============================================================================ */
function fmt(n) {
  if (!Number.isFinite(n)) return 's/d';
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return (Math.round(n * 100) / 100).toString();
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
      if (DEBUG) {
        console.log('ids:', norm.ids);
        console.log('names:', norm.names);
        console.log('rows count:', norm.rows.length);
      }

      const { headers, rows } = toHeadersRows(norm);
      const incomingStyle = data.styleById || data.style || {};
      const tableLike = {
        fields: data.fields || {},
        tables: { DEFAULT: { headers, rows } },
        fieldsByConfigId: data.fieldsByConfigId || {},
        styleById: incomingStyle || {}
      };
      if (DEBUG) console.log('style incoming:', incomingStyle);

      drawVisualization(ensureContainer(), tableLike);
      if (DEBUG) console.groupEnd();
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
