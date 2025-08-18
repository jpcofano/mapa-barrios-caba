// Community Viz 2025 — Leaflet + dscc (bundle-first) + Normalizador de datos

import * as dsccImported from '@google/dscc';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './Visualization.css';
import geojsonText from './barrioscaba.geojson?raw';

/* ----------------------------------------------------------------------------
   Exponer el import a window si el host no lo pone (evita doble definición)
---------------------------------------------------------------------------- */
(function exposeImportToWindowIfNeeded() {
  if (typeof window !== 'undefined') {
    if (!window.dscc && dsccImported && typeof dsccImported.subscribeToData === 'function') {
      window.dscc = dsccImported;
    }
  }
})();

/* ----------------------------------------------------------------------------
   Espera a que dscc esté listo (importado o provisto por el host)
---------------------------------------------------------------------------- */
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

/* ----------------------------------------------------------------------------
   Inyección opcional de la lib oficial si el host no la expuso aún
---------------------------------------------------------------------------- */
const ensureDsccScript = (() => {
  let injected = false;
  return () => {
    if (typeof window === 'undefined') return false;
    if (typeof window.dscc?.subscribeToData === 'function') return true;
    if (injected) return false;
    const existing = document.getElementById('__dscc_script');
    if (existing) { injected = true; return false; }
    const s = document.createElement('script');
    s.id = '__dscc_script';
    s.src = 'https://www.gstatic.com/looker-studio/js/dscc.min.js';
    s.async = true;
    s.onload = () => console.log('[Viz] dscc.min.js cargado');
    document.head.appendChild(s);
    injected = true;
    return false;
  };
})();

/* ----------------------------------------------------------------------------
   Sanitizador “suave” de NBSP / espacios en vizId/js/css
---------------------------------------------------------------------------- */
(function () {
  try {
    const fix = (v) => {
      if (!v) return v;
      return String(v)
        .replace(/\u00A0/g, '')     // NBSP
        .replace(/\s+/g, '')        // espacios
        .replace(/(gs:\/\/[^/]+\/[^^/?#\s]+)[\u00A0 ]+/i, (_m, g1) => g1 + '/');
    };
    const q = window.location.search || '';
    const usp = new URLSearchParams(q);
    let changed = false;
    for (const k of ['vizId','js','css','path']) {
      if (!usp.has(k)) continue;
      const before = usp.get(k);
      const after  = fix(before);
      if (after !== before) { usp.set(k, after); changed = true; }
    }
    if (changed) {
      const qs = usp.toString();
      history.replaceState(null,'', qs ? ('?' + qs) : location.pathname);
      console.log('[Viz] Query saneada');
    }
  } catch (e) { console.warn('[Viz] Sanitizador URL error:', e); }
})();

/* ----------------------------------------------------------------------------
   GeoJSON embebido (Vite: ?raw devuelve string)
---------------------------------------------------------------------------- */
let GEOJSON;
try {
  GEOJSON = JSON.parse(geojsonText);
} catch (e) {
  console.error('[Viz] GeoJSON inválido:', e);
  GEOJSON = { type: 'FeatureCollection', features: [] };
}

/* ----------------------------------------------------------------------------
   Helpers de texto / color
---------------------------------------------------------------------------- */
function cleanString(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u00A0\u1680\u2000-\u200D\u202F\u205F\u2060\u3000\uFEFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
const normalizeKey = (s) => cleanString(s);
const normalizeKeyFuzzy = (s) => {
  const raw = cleanString(s);
  const compact = raw.replace(/\s+/g, '');
  const alnum = raw.replace(/[^\p{L}\p{N}]+/gu, '');
  return Array.from(new Set([raw, compact, alnum]));
};

const clamp01 = (t) => Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
const lerp = (a, b, t) => a + (b - a) * clamp01(t);
const toHex = (x) => Math.round(x).toString(16).padStart(2, '0');
const rgb = (r, g, b) => `#${toHex(r)}${toHex(g)}${toHex(b)}`;

function colorFromScale(scaleName, t, invert) {
  t = clamp01(t);
  if (invert) t = 1 - t;
  switch (scaleName) {
    case 'blueToYellow': {
      const r = lerp(0, 240, t), g = lerp(90, 200, t), b = lerp(170, 0, t);
      return rgb(r, g, b);
    }
    case 'grayscale': {
      const g = lerp(240, 40, t);
      return rgb(g, g, g);
    }
    case 'yellow': {
      const r = lerp(255, 130, t), g = lerp(255, 130, t), b = lerp(180, 20, t);
      return rgb(r, g, b);
    }
    case 'greenToRed':
    default: {
      const r = lerp(0, 204, t), g = lerp(170, 0, t);
      return rgb(r, g, 0);
    }
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

/* ----------------------------------------------------------------------------
   Lectura de estilo (alineado a config.json)
---------------------------------------------------------------------------- */
function readStyle(message = {}) {
  const s = (message && message.styleById) ? message.styleById : {};

  const getPalette = () => {
    const raw = (s.customPalette && s.customPalette.value ? String(s.customPalette.value) : '').trim();
    if (raw) {
      const colors = raw.split(',')
        .map(x => x.trim())
        .filter(x => /^#?[0-9a-f]{6}$/i.test(x))
        .map(x => x.startsWith('#') ? x : '#' + x);
      if (colors.length) return { mode: 'custom', colors };
    }
    const v = s.colorPalette && s.colorPalette.value;
    if (v) {
      if (typeof v === 'string') {
        if (PRESET_PALETTES[v]) return { mode: 'preset', colors: PRESET_PALETTES[v] };
        if (/^#?[0-9a-f]{6}$/i.test(v)) {
          return { mode: 'custom', colors: [ v.startsWith('#') ? v : ('#' + v) ] };
        }
        return { mode: 'custom', colors: [] };
      }
      const colors = (v.colors || v.palette || v.values || []);
      return { mode: (v.mode || 'custom'), colors: Array.isArray(colors) ? colors : [] };
    }
    return null;
  };

  const num = (x, d) => {
    const n = Number(x);
    return Number.isFinite(n) ? n : d;
  };

  return {
    nivelJerarquia: (s.nivelJerarquia && s.nivelJerarquia.value) || 'barrio',
    geojsonProperty: ((s.geojsonProperty && s.geojsonProperty.value) || '').toString().trim(),
    colorScale: (s.colorScale && s.colorScale.value) || 'greenToRed',
    invertScale: !!(s.invertScale && s.invertScale.value),
    showLabels: !!(s.showLabels && s.showLabels.value),
    showLegend: (s.showLegend && s.showLegend.value !== undefined) ? !!s.showLegend.value : true,
    legendPosition: (s.legendPosition && s.legendPosition.value) || 'bottomright',
    showBorders: (s.showBorders && s.showBorders.value !== undefined) ? !!s.showBorders.value : true,
    borderColor: (s.borderColor && s.borderColor.value && s.borderColor.value.color) || '#000000',
    borderWidth: num(s.borderWidth && s.borderWidth.value, 1),
    borderOpacity: num(s.borderOpacity && s.borderOpacity.value, 1),
    opacity: num(s.opacity && s.opacity.value, 0.45),
    colorMissing: (s.colorMissing && s.colorMissing.value && s.colorMissing.value.color) || '#cccccc',
    popupFormat: (s.popupFormat && s.popupFormat.value) || '<strong>{{nombre}}</strong><br/>Valor: {{valor}}',
    colorPalette: getPalette(),
  };
}

/* ----------------------------------------------------------------------------
   Propiedad de nombre por feature
---------------------------------------------------------------------------- */
function getFeatureNameProp(feature, nivelJerarquia = 'barrio', customProp = '') {
  const p = feature?.properties || {};
  if (customProp && (customProp in p)) return p[customProp];

  if (nivelJerarquia === 'comuna') {
    const raw = p.COMUNA ?? p.comuna ?? p.Comuna ?? p.cod_comuna ?? p.codigo_comuna ?? p.COD_COMUNA;
    if (raw == null) return raw;
    const s = String(raw).trim();
    return /^\d+$/.test(s) ? s.replace(/^0+/, '') : s;
  }

  const candidates = [
    p.nombre, p.NOMBRE, p.Nombre,
    p.barrio, p.BARRIO, p.Barrio,
    p.name, p.NOMBRE_BARRIO, p.barrio_nombre, p.barrio_desc
  ];
  for (const c of candidates) if (c != null && String(c).trim().length) return c;

  const anyStr = Object.values(p).find(v => typeof v === 'string' && v.trim().length);
  return anyStr ?? '—';
}

/* ----------------------------------------------------------------------------
   Números/tabla + Normalizador robusto de DEFAULT
---------------------------------------------------------------------------- */
function toNumberLoose(x) {
  if (typeof x === 'number') return x;
  const cand = x?.v ?? x?.value ?? x;
  if (typeof cand === 'number') return cand;
  let s = String(cand ?? '').replace(/\s|\u00A0/g, '').trim();
  if (!s) return NaN;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** Coercea celdas {v:...} o valores directos */
function coerceCell(c) {
  return (c && typeof c === 'object' && 'v' in c) ? c.v : c;
}

/**
 * Normaliza la tabla DEFAULT de objectTransform:
 * - Usa t.headers para obtener ids/names
 * - Soporta rows como array o como objeto indexado por id
 * Devuelve { ids[], names[], rows[] } donde rows[i] = { __vals:[], byName:{}, byId:{} }
 */
function normalizeDEFAULTTable(data) {
  const t = data?.tables?.DEFAULT;
  if (!t) return { ids: [], names: [], rows: [] };

  const hdrObjs = (t.headers || []).map(h => (typeof h === 'string' ? { id: h, name: h } : h));
  const ids   = hdrObjs.map(h => h.id ?? String(h.name ?? h.label));
  const names = hdrObjs.map(h => h.name ?? h.label ?? h.id);

  const rows = (t.rows || []).map(row => {
    let values;
    if (Array.isArray(row)) {
      values = row.map(coerceCell);
    } else {
      values = ids.map(id => coerceCell(row[id]));
    }
    const byName = Object.fromEntries(names.map((nm, i) => [nm, values[i]]));
    const byId   = Object.fromEntries(ids.map((id, i)   => [id, values[i]]));
    return { __vals: values, byName, byId };
  });

  return { ids, names, rows };
}

/** Convierte una tabla normalizada a {headers, rows} que consume el renderer */
function toHeadersRows(norm) {
  const headers = norm.ids.map((id, i) => ({ id, name: norm.names[i] || id }));
  const rows = norm.rows.map(r => r.__vals);
  return { headers, rows };
}

/* ----------------------------------------------------------------------------
   ValueMap: mapea dimensión → valor usando ids/labels de config
---------------------------------------------------------------------------- */
function buildValueMap(tableLike) {
  const fbc    = tableLike?.fieldsByConfigId || {};
  const fields = tableLike?.fields || {};
  const tableRaw = tableLike?.tables?.DEFAULT || {};
  const headers = tableRaw.headers || [];
  const rows    = tableRaw.rows || [];

  // indices por preferencia (config → fields → heurística)
  let idxDim = -1, idxMet = -1;

  const dimIdPref = fbc.geoDimension?.[0]?.id || fbc.geoDimension?.[0]?.name;
  const metIdPref = fbc.metricPrimary?.[0]?.id || fbc.metricPrimary?.[0]?.name;

  if (dimIdPref) idxDim = headers.findIndex(h => (h.id || h.name) === dimIdPref);
  if (metIdPref) idxMet = headers.findIndex(h => (h.id || h.name) === metIdPref);

  if (idxDim < 0 && Array.isArray(fields.dimensions) && fields.dimensions.length) {
    const wanted = (fields.dimensions[0].id || fields.dimensions[0].name || '').toString();
    idxDim = headers.findIndex(h => (h.id || h.name) === wanted);
  }
  if (idxMet < 0 && Array.isArray(fields.metrics) && fields.metrics.length) {
    const wanted = (fields.metrics[0].id || fields.metrics[0].name || '').toString();
    idxMet = headers.findIndex(h => (h.id || h.name) === wanted);
  }

  if (idxDim < 0)
    idxDim = headers.findIndex(h => /barrio|comuna|nombre|name|texto/i.test(h?.name || h?.id || ''));

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
    console.warn('[Viz] No se encontraron campos válidos para dimensión/métrica', { idxDim, idxMet });
    return { map: new Map(), min: NaN, max: NaN, count: 0 };
    }

  const map = new Map();
  const values = [];
  for (const row of rows) {
    const keyRaw = (row?.[idxDim]?.v ?? row?.[idxDim]?.value ?? row?.[idxDim] ?? '').toString();
    if (!keyRaw) continue;
    const keyNorm = (typeof normalizeKey === 'function')
      ? normalizeKey(keyRaw)
      : keyRaw.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

    const val = toNumberLoose(row?.[idxMet]);
    if (Number.isFinite(val)) {
      if (typeof normalizeKeyFuzzy === 'function') {
        for (const k of normalizeKeyFuzzy(keyNorm)) map.set(k, val);
      } else {
        map.set(keyNorm, val);
      }
      values.push(val);
    }
  }

  const min = values.length ? Math.min(...values) : NaN;
  const max = values.length ? Math.max(...values) : NaN;

  console.log('[Viz] headers:', headers.map(h => h.name || h.id));
  console.log('[Viz] rows:', rows.length, 'idxDim:', idxDim, 'idxMet:', idxMet);
  console.log('[Viz] min/max/count:', min, max, values.length);
  return { map, min, max, count: values.length };
}

/* ----------------------------------------------------------------------------
   Render principal (Leaflet)
---------------------------------------------------------------------------- */
const __leafletState = { map: null, layer: null, legend: null };

export default function drawVisualization(container, message = {}) {
  const UWS_RE = /[\u00A0\u1680\u2000-\u200D\u202F\u205F\u2060\u3000\uFEFF]/g;
  const cleanStringFallback = (s) =>
    String(s ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(UWS_RE, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  const fuzzy =
    (typeof normalizeKeyFuzzy === 'function')
      ? normalizeKeyFuzzy
      : (raw) => {
          const base = cleanStringFallback(raw);
          const noSpace = base.replace(/\s+/g, '');
          const alnum  = base.replace(/[^a-z0-9]/g, '');
          return Array.from(new Set([base, noSpace, alnum]));
        };

  container.style.width = '100%';
  container.style.height = '100%';

  const style  = readStyle(message);
  const nivel  = style.nivelJerarquia || 'barrio';

  const stats  = buildValueMap(message);
  const geojson = (typeof GEOJSON !== 'undefined') ? GEOJSON : { type: 'FeatureCollection', features: [] };

  // Mapa único reutilizable
  if (!__leafletState.map) {
    __leafletState.map = L.map(container, { zoomControl: true, attributionControl: true });
  } else {
    const current = __leafletState.map.getContainer();
    if (current && current !== container) {
      container.appendChild(current);
      setTimeout(() => { try { __leafletState.map.invalidateSize(); } catch {} }, 0);
    }
    if (__leafletState.layer) { try { __leafletState.map.removeLayer(__leafletState.layer); } catch {} }
    if (__leafletState.legend) { try { __leafletState.legend.remove(); } catch {} }
    __leafletState.layer = null;
    __leafletState.legend = null;
  }
  const map = __leafletState.map;

  // Estilo por feature
  const styleFn = (feature) => {
    const nombreRaw = getFeatureNameProp(feature, nivel, style.geojsonProperty);
    let v;
    if (stats?.map?.size) {
      for (const k of fuzzy(nombreRaw)) {
        if (stats.map.has(k)) { v = stats.map.get(k); break; }
      }
    }

    let fillColor;
    if (stats?.map?.size && Number.isFinite(v)) {
      const t = (v - stats.min) / ((stats.max - stats.min) || 1);
      if (style.colorPalette?.colors?.length) {
        const n = style.colorPalette.colors.length;
        const idx = Math.max(0, Math.min(n - 1, Math.round(clamp01(t) * (n - 1))));
        fillColor = style.colorPalette.colors[idx];
      } else {
        fillColor = colorFromScale(style.colorScale, t, style.invertScale);
      }
    } else {
      fillColor = style.colorMissing;
    }

    return {
      color:   style.showBorders ? style.borderColor  : 'transparent',
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

      if (style.showLabels) {
        lyr.bindTooltip(nombreLabel, { sticky: true, direction: 'center' });
      }

      let v;
      if (stats?.map?.size) {
        for (const k of fuzzy(nombreRaw)) {
          if (stats.map.has(k)) { v = stats.map.get(k); break; }
        }
      }

      const content = (style.popupFormat || '')
        .replace(/\{\{\s*nombre\s*\}\}/gi, nombreLabel)
        .replace(/\{\{\s*valor\s*\}\}/gi, (v != null && Number.isFinite(v)) ? String(v) : 's/d');

      lyr.bindPopup(content, { closeButton: false });
    }
  }).addTo(map);
  __leafletState.layer = layer;

  // Ajuste de vista
  try {
    const b = layer.getBounds();
    if (b?.isValid && b.isValid()) {
      map.fitBounds(b, { padding: [16, 16] });
      setTimeout(() => { try { map.invalidateSize(); } catch {} }, 0);
    } else {
      console.warn('[Viz] Bounds inválidos — GeoJSON vacío o sin features válidas.');
    }
  } catch (e) {
    console.warn('[Viz] No se pudo ajustar bounds:', e);
  }

  // Leyenda
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

      if (!stats || !Number.isFinite(stats.min) || !Number.isFinite(stats.max) || stats.count === 0) {
        div.textContent = 'Sin datos';
        return div;
      }

      const breaks = 5;
      for (let i = 0; i < breaks; i++) {
        const a = stats.min + (stats.max - stats.min) * (i / breaks);
        const b = stats.min + (stats.max - stats.min) * ((i + 1) / breaks);
        const mid = (a + b) / 2;
        const t = (mid - stats.min) / ((stats.max - stats.min) || 1);

        let col;
        if (style.colorPalette?.colors?.length) {
          const n = style.colorPalette.colors.length;
          const idx = Math.max(0, Math.min(n - 1, Math.round(clamp01(t) * (n - 1))));
          col = style.colorPalette.colors[idx];
        } else {
          col = colorFromScale(style.colorScale, t, style.invertScale);
        }

        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.gap = '8px';
        row.style.margin = '2px 0';

        const sw = document.createElement('span');
        sw.style.display = 'inline-block';
        sw.style.width = '14px';
        sw.style.height = '14px';
        sw.style.border = '1px solid rgba(0,0,0,.2)';
        sw.style.background = col;

        const label = document.createElement('span');
        label.textContent = `${fmt(a)} – ${fmt(b)}`;

        row.appendChild(sw);
        row.appendChild(label);
        div.appendChild(row);
      }
      return div;
    };
    legend.addTo(map);
    __leafletState.legend = legend;
  }
}

/* ----------------------------------------------------------------------------
   Utilidad de formateo
---------------------------------------------------------------------------- */
function fmt(n) {
  if (!Number.isFinite(n)) return 's/d';
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return (Math.round(n * 100) / 100).toString();
}

/* ----------------------------------------------------------------------------
   Wrapper dscc: subscribe con objectTransform + normalizador
---------------------------------------------------------------------------- */
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

  function handleData(data) {
    try {
      console.group('[Viz] Datos (objectTransform)');

      // Normalizar tabla DEFAULT (ids, labels y filas seguras)
      const norm = normalizeDEFAULTTable(data);
      if (norm.rows.length) {
        console.log('[Viz] headers (ids):', norm.ids);
        console.log('[Viz] headers (labels):', norm.names);
        console.log('[Viz] rows:', norm.rows.length);
        console.log('[Viz] fila 1 (byName):', norm.rows[0].byName);
      } else {
        console.warn('[Viz] Sin filas en DEFAULT');
      }

      // Convertir a headers/rows para el renderer
      const { headers, rows } = toHeadersRows(norm);

      // Armar tableLike con metadata original (para mapear config ids)
      const tableLike = {
        fields: data.fields || {},
        tables: { DEFAULT: { headers, rows } },
        fieldsByConfigId: data.fieldsByConfigId || {},
        styleById: data.styleById || {}
      };

      drawVisualization(ensureContainer(), tableLike);
      console.groupEnd();
    } catch (err) {
      console.error('[Viz] Error procesando datos:', err);
    }
  }

  async function initWrapper(attempt = 1) {
    try {
      const MAX_ATTEMPTS = 5;

      const d = await waitForDscc().catch(() => null);
      if (d && typeof d.subscribeToData === 'function') {
        console.log('[Viz] dscc listo (', d === dsccImported ? 'bundle' : 'window', ')');
        d.subscribeToData(handleData, { transform: d.objectTransform });
        return;
      }

      ensureDsccScript();
      if (attempt < MAX_ATTEMPTS) {
        console.warn(`[Viz] dscc no disponible (attempt ${attempt}), reintento en 1s…`);
        setTimeout(() => initWrapper(attempt + 1), 1000);
        return;
      }

      // Fallback (mock)
      console.error('[Viz] dscc no disponible tras reintentos. Fallback mock.');
      const container = ensureContainer();
      const mockData = {
        tables: {
          DEFAULT: {
            headers: [{id:'barrio',name:'Barrio'},{id:'poblacion',name:'Población'}],
            rows: [
              ['Palermo', 225000],
              ['Recoleta',188000]
            ]
          }
        },
        fieldsByConfigId: {
          geoDimension:  [{ id: 'barrio',    name: 'Barrio' }],
          metricPrimary: [{ id: 'poblacion', name: 'Población' }]
        }
      };
      drawVisualization(container, mockData);
    } catch (e) {
      console.error('[Viz] Error initWrapper:', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { initWrapper().catch(console.error); });
  } else {
    initWrapper().catch(console.error);
  }
})();
