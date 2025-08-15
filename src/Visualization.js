// NUEVO: trae la API desde el paquete
// Bundlea la lib de DSCC en tu Visualization.js
import * as dscc from '@google/dscc';

// Alias estable: garantiza que el símbolo exista en el bundle y podamos referenciarlo con seguridad
const dsccModule = dscc;

const ensureDsccScript = (() => {
  let injected = false;
  return () => {
    if (typeof window === 'undefined') return false;
    if (typeof window.dscc?.subscribeToData === 'function') return true;
    if (injected) return false;
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

// Convierte objectTransform -> forma tipo tableTransform (headers/rows)
function objectToTableShape(data) {
  const byId = data?.fieldsByConfigId || data?.fields || {};
  const dims = byId.geoDimension || byId.dimensions || [];
  const mets = byId.metricPrimary || byId.metrics || [];

  // headers: mismo orden dim -> met
  const headers = [...dims, ...mets].map(f => ({
    id: f.id || f.name,
    name: f.name || f.id
  }));

  const rowsObj = Array.isArray(data?.tables?.DEFAULT) ? data.tables.DEFAULT : [];
  const rows = rowsObj.map(rowObj => {
    // cada celda es el primer valor del arreglo que viene en objectTransform
    return headers.map(h => {
      const v = rowObj?.[h.id];
      return Array.isArray(v) ? v[0] : v;
    });
  });

  return { dims, mets, headers, rows };
}

(function(){
  // --- Sanitizador de NBSP / espacios en vizId, js, css ---
  try {
    const fixOne = (val) => {
      if (!val) return val;
      // Corrige NBSP/espacio después de "/{carpeta}" en URLs como gs://.../c barrios
      return String(val).replace(
        /(gs:\/\/[^/]+\/[^^/?#\s]+)[\u00A0 ]+/i,  // gs://bucket/<carpeta> + NBSP/espacio
        (_m, g1) => g1 + '/'
      );
    };

    const rawQ = window.location.search || '';
    const usp = new URLSearchParams(rawQ);
    const keys = ['vizId', 'js', 'css'];
    let changed = false;

    for (const k of keys) {
      if (!usp.has(k)) continue;
      const before = usp.get(k);
      const after = fixOne(before);
      if (after !== before) { usp.set(k, after); changed = true; }
    }

    if (changed) {
      const q = usp.toString();
      history.replaceState(null, '', (q ? '?' + q : location.pathname));
      console.log('[Viz] Query saneada: antes=' + rawQ + ', después=' + usp.toString());
    }

    // --- Caja de diagnóstico ---
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;bottom:8px;left:8px;z-index:999999;background:#000c;color:#fff;padding:8px 10px;border-radius:8px;font:12px system-ui;max-width:70vw;cursor:pointer';
    box.title = 'clic para cerrar';
    box.onclick = () => box.remove();
    const decQ = decodeURIComponent(rawQ);
    const hasNBSP = /%C2%A0/i.test(rawQ) || /\u00A0/.test(decQ);
    box.innerHTML = [
      '<b>Diag URL</b>',
      'hasNBSP: ' + hasNBSP,
      'search(raw): ' + rawQ.slice(0, 200),
      'search(dec): ' + decQ.slice(0, 200)
    ].join('<br/>');
    document.body.appendChild(box);
  } catch (e) {
    console.warn('[Viz] No se pudo sanear query:', e);
  }
})();

// src/Visualization.js
// Community Viz 2025 — Leaflet (sin fetch) + Vite + dscc.objectTransform

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './styles.css';

// GeoJSON embebido (Vite: ?raw devuelve string)
import geojsonText from './barrioscaba.geojson?raw';
let GEOJSON;
try {
  GEOJSON = JSON.parse(geojsonText);
} catch (e) {
  console.error('[Viz] GeoJSON inválido:', e);
  GEOJSON = { type: 'FeatureCollection', features: [] };
}

// ---------------------- Limpieza robusta ----------------------
// Quita tildes, NBSP, espacios invisibles, colapsa espacios y normaliza a minúsculas
function cleanString(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // diacríticos
    .replace(/[\u00A0\u1680\u2000-\u200D\u202F\u205F\u2060\u3000\uFEFF]/g, ' ') // NBSP + zero-width + separadores
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Normalizaciones de clave para matching (sobre cleanString)
const normalizeKey = (s) => cleanString(s);
const normalizeKeyFuzzy = (s) => {
  const raw = cleanString(s);
  const compact = raw.replace(/\s+/g, '');
  const alnum = raw.replace(/[^\p{L}\p{N}]+/gu, '');
  return Array.from(new Set([raw, compact, alnum]));
};

// Utilidades numéricas y color
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

// ---------------------- Lectura de estilo (moderno) ----------------------
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
      if (typeof v === 'string') return { mode: 'custom', colors: [v] };
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

// ---------------------- Propiedad de nombre por feature ----------------------
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

// ---------------------- Datos: mapear dimensión → métrica ----------------------
function buildValueMap(message) {
  // --- Fallbacks de normalización (si no existen globales) ---
  const UWS_RE = /[\u00A0\u1680\u2000-\u200D\u202F\u205F\u2060\u3000\uFEFF]/g;
  const normalizeKeyLocal = (s) =>
    String(s ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')   // quita tildes
      .replace(UWS_RE, ' ')              // NBSP/zero-width → espacio
      .replace(/\s+/g, ' ')              // colapsa
      .trim()
      .toLowerCase();

  const normalizeKey =
    (typeof window !== 'undefined' && typeof window.normalizeKey === 'function')
      ? window.normalizeKey
      : normalizeKeyLocal;

  const normalizeKeyFuzzy =
    (typeof window !== 'undefined' && typeof window.normalizeKeyFuzzy === 'function')
      ? window.normalizeKeyFuzzy
      : (raw) => {
          const base = normalizeKey(raw);
          const noSpace = base.replace(/\s+/g, '');
          const alnum  = base.replace(/[^a-z0-9]/g, '');
          return Array.from(new Set([base, noSpace, alnum]));
        };

  // --- Soporte objectTransform → forma "tabla" si hace falta ---
  const toTableLike = (msg) => {
    const isObject = Array.isArray(msg?.tables?.DEFAULT);
    if (!isObject) return msg; // ya es tableTransform o "tabla-like"

    const byId = msg?.fieldsByConfigId || msg?.fields || {};
    const dims = byId.geoDimension || byId.dimensions || [];
    const mets = byId.metricPrimary || byId.metrics || [];

    const headers = [...dims, ...mets].map(f => ({
      id: f.id || f.name,
      name: f.name || f.id
    }));

    const rowsObj = Array.isArray(msg?.tables?.DEFAULT) ? msg.tables.DEFAULT : [];
    const rows = rowsObj.map(rowObj =>
      headers.map(h => {
        const v = rowObj?.[h.id];
        return Array.isArray(v) ? v[0] : v;
      })
    );

    return {
      ...msg,
      fields: { dimensions: dims, metrics: mets },
      tables: { DEFAULT: { headers, rows } }
    };
  };

  const data = toTableLike(message);

  const fbc = data?.fieldsByConfigId || {};
  const modernDim = Array.isArray(fbc?.geoDimension) ? fbc.geoDimension[0] : null;
  const modernMet = Array.isArray(fbc?.metricPrimary) ? fbc.metricPrimary[0] : null;

  const table = data?.tables?.DEFAULT || {};
  const fieldIds = Array.isArray(table.fields)
    ? table.fields
    : (Array.isArray(table.headers) ? table.headers : []);
  const rows = Array.isArray(table.rows)
    ? table.rows
    : (Array.isArray(table.data) ? table.data : []);

  // Debug
  console.log('[Viz] table keys:', Object.keys(table));
  console.log('[Viz] fields/headers:', fieldIds.map(f => f?.id || f?.name));
  console.log('[Viz] rows.length:', rows.length);
  console.log('[Viz] fieldsByConfigId:', Object.keys(fbc));

  let idxDim = -1, idxMet = -1;
  let keyFieldId, valFieldId;

  // Intento 1: usar mapeo moderno geoDimension/metricPrimary
  if (modernDim && modernMet) {
    keyFieldId = modernDim.id || modernDim.name;
    valFieldId = modernMet.id || modernMet.name;
    fieldIds.forEach((f, i) => {
      const nm = (f?.id || f?.name || '').toString().toLowerCase();
      if ((keyFieldId || '').toLowerCase() === nm) idxDim = i;
      if ((valFieldId || '').toLowerCase() === nm) idxMet = i;
    });
  }

  // Intento 2: heurística por nombre
  if (idxDim < 0 || idxMet < 0) {
    const pick = (x) => (x?.name || x?.id || '');
    if (idxDim < 0) idxDim = fieldIds.findIndex(f => /barrio|comuna|nombre|texto|name/i.test(pick(f)));
    if (idxMet < 0) idxMet = fieldIds.findIndex(f => /valor|m(é|e)trica|metric|value|cantidad|total/i.test(pick(f)));
  }

  // Intento 3: primera col numérica (distinta de la dimensión)
  if (idxMet < 0 && rows.length) {
    const sampleN = Math.min(rows.length, 25);
    const isNumericCol = (colIdx) => {
      let hits = 0, seen = 0;
      for (let r = 0; r < sampleN; r++) {
        const row = rows[r];
        const keyId = fieldIds[colIdx]?.id || fieldIds[colIdx]?.name;
        const cell = Array.isArray(row) ? row[colIdx] : row[keyId];
        const n = Number(cell?.v ?? cell?.value ?? cell);
        if (!Number.isNaN(n)) hits++;
        seen++;
      }
      return seen > 0 && hits / seen >= 0.6;
    };
    for (let i = 0; i < fieldIds.length; i++) {
      if (i !== idxDim && isNumericCol(i)) { idxMet = i; break; }
    }
  }

  if (idxDim < 0 || idxMet < 0) {
    console.warn('[Viz] No se encontraron campos válidos para dimensión/métrica');
    return { map: new Map(), min: NaN, max: NaN, count: 0 };
  }

  keyFieldId = keyFieldId || fieldIds[idxDim]?.id || fieldIds[idxDim]?.name;
  valFieldId = valFieldId || fieldIds[idxMet]?.id || fieldIds[idxMet]?.name;

  const map = new Map();
  const values = [];

  // AGGREGATE_MODE: 'last' (por defecto) o 'sum'
  const AGGREGATE_MODE = 'last';

  for (const row of rows) {
    const d = Array.isArray(row) ? row[idxDim] : row[keyFieldId];
    const m = Array.isArray(row) ? row[idxMet] : row[valFieldId];

    const keyRaw = (d?.v ?? d?.value ?? d ?? '').toString();
    const keyClean = normalizeKey(keyRaw);         // limpieza fuerte base
    const val = Number(m?.v ?? m?.value ?? m);

    if (keyClean && Number.isFinite(val)) {
      // Setear para variantes (base / sin espacios / alfanum)
      for (const k of normalizeKeyFuzzy(keyClean)) {
        if (AGGREGATE_MODE === 'sum' && map.has(k)) {
          map.set(k, map.get(k) + val);
        } else {
          map.set(k, val);
        }
      }
      values.push(val);
    }
  }

  const min = values.length ? Math.min(...values) : NaN;
  const max = values.length ? Math.max(...values) : NaN;

  console.log('[Viz] sample map entries:', Array.from(map.entries()).slice(0, 5));
  console.log('[Viz] min/max/count:', min, max, values.length);
  return { map, min, max, count: values.length };
}

// ---------------------- Render principal ----------------------
// Estado único por módulo para evitar recrear el mapa y provocar
// "Map container is already initialized."
const __leafletState = { map: null, layer: null, legend: null };

export default function drawVisualization(container, message = {}) {
  // --- helpers locales para matching robusto (fallback) ---
  const UWS_RE = /[\u00A0\u1680\u2000-\u200D\u202F\u205F\u2060\u3000\uFEFF]/g;
  const cleanStringFallback = (s) =>
    String(s ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')   // quita tildes
      .replace(UWS_RE, ' ')              // NBSP/zero-width -> espacio
      .replace(/\s+/g, ' ')              // colapsa
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

  // --- container: no lo vaciamos si ya hay mapa; solo garantizamos tamaño ---
  container.style.width = '100%';
  container.style.height = '100%';

  // ---- estilo + datos ----
  const style  = readStyle(message);                         // helper del proyecto
  const nivel  = style.nivelJerarquia || 'barrio';
  const stats  = buildValueMap(message);                     // espera table-like (headers/rows)
  const geojson = (typeof GEOJSON !== 'undefined') ? GEOJSON : { type: 'FeatureCollection', features: [] };

  // ---- mapa: crear una sola vez y reutilizar entre renders ----
  if (!__leafletState.map) {
    __leafletState.map = L.map(container, { zoomControl: true, attributionControl: true });
  } else {
    // si el contenedor real cambió (pasa en Studio), movemos el DOM del mapa
    const current = __leafletState.map.getContainer();
    if (current && current !== container) {
      container.appendChild(current);
      setTimeout(() => { try { __leafletState.map.invalidateSize(); } catch {} }, 0);
    }
    // limpiar capa/leyenda previas
    if (__leafletState.layer) {
      try { __leafletState.map.removeLayer(__leafletState.layer); } catch {}
      __leafletState.layer = null;
    }
    if (__leafletState.legend) {
      try { __leafletState.legend.remove(); } catch {}
      __leafletState.legend = null;
    }
  }
  const map = __leafletState.map;

  // ---- estilo por feature (usa matching robusto) ----
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
      const nombreLabel = String(nombreRaw); // etiqueta “humana” intacta

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

  // ---- ajuste de vista ----
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

  // ---- leyenda opcional ----
  if (style.showLegend) {
    const legend = L.control({ position: style.legendPosition || 'bottomright' });
    legend.onAdd = () => {
      const div = L.DomUtil.create('div', 'legend');
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



function fmt(n) {
  if (!Number.isFinite(n)) return 's/d';
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return (Math.round(n * 100) / 100).toString();
}

// ---------------------- Wrapper dscc: subscribe + objectTransform ----------------------
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

function initWrapper(attempt = 1) {
  try {
    const MAX_ATTEMPTS = 5;

    if (window.parent !== window) {
      console.log('[Viz] Cargado en iframe – dscc debería inyectarse o venir bundleado.');
    } else {
      console.warn('[Viz] No en iframe – dscc del host no se inyectará. Usá un informe real o mock.');
    }

    // --- diagnóstico seguro (no rompe si no existe dsccModule) ---
    const dsccModuleExists   = (typeof dsccModule !== 'undefined') && !!dsccModule;
    const dsccModuleSubType  = (typeof dsccModule !== 'undefined') ? typeof dsccModule?.subscribeToData : 'undefined';
    const dsccModuleObjType  = (typeof dsccModule !== 'undefined') ? typeof dsccModule?.objectTransform  : 'undefined';

    const _diag = (label, extra = {}) => {
      console.log(`[Diag ${label}]`, {
        time: new Date().toISOString(),
        dsccWindowExists: !!window.dscc,
        dsccWindowType: typeof window.dscc,
        dsccWindowSubscribeType: typeof window.dscc?.subscribeToData,
        dsccWindowObjectTransform: typeof window.dscc?.objectTransform,
        dsccModuleExists,
        dsccModuleSubscribeType: dsccModuleSubType,
        dsccModuleObjectTransform: dsccModuleObjType,
        locationHref: location.href,
        referrer: document.referrer,
        attempt,
        ...extra   // ⬅️ importante: spread correcto (antes había `.extra`)
      });
    };

    _diag(`attempt-${attempt}`);

    // --- resolución segura del proveedor dscc (módulo → window → null) ---
const dsccResolved =
  (dsccModuleExists && dsccModuleSubType === 'function') ? dsccModule :
  (window.dscc && typeof window.dscc.subscribeToData === 'function') ? window.dscc :
  null;

if (dsccResolved && typeof dsccResolved.subscribeToData === 'function') {
  const from = (dsccModuleExists && dsccResolved === dsccModule) ? 'module'
             : (dsccResolved === window.dscc) ? 'window'
             : 'unknown';

  console.log(`[Viz] dscc disponible en attempt ${attempt}`, {
    dsccFrom: from,
    subscribeType: typeof dsccResolved.subscribeToData,
    hasObjectTransform: typeof dsccResolved.objectTransform === 'function'
  });

  dsccResolved.subscribeToData((data) => {
    try {
      console.group('[Viz] Datos con objectTransform');
      // Guardá una copia por si querés inspeccionar en consola
      try { window.__lastData = data; } catch {}

      // 1) Normalizá objectTransform -> forma "tabla"
      const t = objectToTableShape(data);

      // 2) Logs equivalentes a los que ya usabas
      console.log(`Dimensiones (${t.dims.length}):`, t.dims.map(d => d.name));
      console.log(`Métricas (${t.mets.length}):`, t.mets.map(m => m.name));
      console.log(`Headers tabla (${t.headers.length}):`, t.headers.map(h => h.name));
      console.log(`Total de filas: ${t.rows.length}`);
      if (t.rows.length > 0) {
        const sampleCount = Math.min(t.rows.length, 5);
        for (let i = 0; i < sampleCount; i++) {
          const rowObj = {};
          t.headers.forEach((h, idx) => { rowObj[h.name] = t.rows[i][idx]; });
          console.log(`Fila ${i + 1}:`, rowObj);
        }
      } else {
        console.warn('[Viz] La tabla normalizada no contiene filas.');
      }

      // 3) Armá el "table-like" que consume tu drawVisualization
      const tableLike = {
        fields: { dimensions: t.dims, metrics: t.mets },
        tables: { DEFAULT: { headers: t.headers, rows: t.rows } }
      };
      try { window.__lastTableLike = tableLike; } catch {}

      // 4) Dibujar usando tu función existente
      drawVisualization(ensureContainer(), tableLike);

      console.groupEnd();
    } catch (err) {
      console.error('[Viz] Error procesando datos (object→table):', err);
    }
  }, { transform: dsccResolved.objectTransform });

  return;
}

    // Si todavía no hay dscc, intentá inyectar la lib oficial y reintentar
    ensureDsccScript();

    if (attempt < MAX_ATTEMPTS) {
      console.warn(`[Viz] dscc no disponible en attempt ${attempt}, reintentando en 1s...`, {
        dsccModuleSubscribe: dsccModuleSubType,
        dsccWindowSubscribe: typeof window.dscc?.subscribeToData
      });
      setTimeout(() => initWrapper(attempt + 1), 1000);
      return;
    }

    // Fallback definitivo (mock) luego de agotar reintentos
    console.error('[Viz] dscc no disponible tras 5 intentos. Entrando en fallback (mock).');
    _diag('fallback');

    const container = ensureContainer();
    container.innerHTML = `
      <div style="font:14px system-ui; padding:12px; border:1px solid #eee; border-radius:8px; margin-bottom:8px">
        <strong>Sin dscc:</strong> No se pudo inicializar la API de Looker Studio.<br/>
        Revisá:
        <ul style="margin:6px 0 0 18px">
          <li>Que el manifiesto sea el correcto y la viz esté agregada desde ese manifest.</li>
          <li>Que la fuente de datos tenga habilitado <em>Community visualization access</em>.</li>
          <li>Que <code>Config.json</code> no tenga <code>defaultValue</code> en <code>data.elements</code> (solo en <code>style</code>).</li>
        </ul>
      </div>`;

    const mockData = {
      tables: {
        DEFAULT: {
          fields: [{ id: 'barrio', name: 'Barrio' }, { id: 'poblacion', name: 'Población' }],
          rows: [
            { barrio: 'Palermo',  poblacion: 225000 },
            { barrio: 'Recoleta', poblacion: 188000 }
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

// Boot strap
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    try { console.log('[Viz] DOMContentLoaded → initWrapper()'); initWrapper(); } catch (e) { console.error(e); }
  });
} else {
  try { console.log('[Viz] DOM listo → initWrapper()'); initWrapper(); } catch (e) { console.error(e); }
}

})();
