(function(){
  // --- Sanitizador de NBSP / espacios en vizId, js, css ---
  try {
    const fixOne = (val) => {
      if (!val) return val;
      // URLSearchParams ya entrega decodificado: gs://.../a barrios → hay \u00A0
      // Regla: si hay NBSP/espacio inmediatamente después de "/{carpeta}", lo cambiamos por "/"
      // Soporta 1 segmento de carpeta (a, b, v2025, etc.)
      return String(val).replace(
        /(gs:\/\/[^/]+\/[^/?#\s]+)[\u00A0 ]+/i,  // gs://bucket/<carpeta> + NBSP/espacio
        (_m, g1) => g1 + '/'
      );
    };

    const usp = new URLSearchParams(window.location.search);
    const keys = ['vizId', 'js', 'css'];
    let changed = false;

    for (const k of keys) {
      if (!usp.has(k)) continue;
      const before = usp.get(k);
      const after  = fixOne(before);
      if (after !== before) { usp.set(k, after); changed = true; }
    }

    if (changed) {
      const q = usp.toString(); // re-encodea correcto
      history.replaceState(null, '', (q ? '?' + q : location.pathname));
    }
  } catch (e) {
    console.warn('[Viz] No se pudo sanear query:', e);
  }

  // --- Caja de diagnóstico (igual que la tuya) ---
  const box=document.createElement('div');
  box.style.cssText='position:fixed;bottom:8px;left:8px;z-index:999999;background:#000c;color:#fff;padding:8px 10px;border-radius:8px;font:12px system-ui;max-width:70vw;cursor:pointer';
  box.title='clic para cerrar'; box.onclick=()=>box.remove();
  const rawQ = location.search || '';
  const decQ = decodeURIComponent(rawQ);
  const hasNBSP = /%C2%A0/i.test(rawQ) || /\u00A0/.test(decQ);
  box.innerHTML = [
    '<b>Diag URL</b>',
    'hasNBSP: '+hasNBSP,
    'search(raw): '+rawQ.slice(0,200),
    'search(dec): '+decQ.slice(0,200)
  ].join('<br/>');
  document.body.appendChild(box);
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


// ---------------------- Utils de texto/colores ----------------------
const stripDiacritics = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const normalizeKey = (s) => stripDiacritics(s).trim().toLowerCase();
const normalizeKeyFuzzy = (s) => {
  const raw = stripDiacritics(String(s ?? '').trim().toLowerCase());
  const set = new Set([
    raw,
    raw.replace(/\s+/g, ' '),
    raw.replace(/\s+/g, ''),
    raw.replace(/[^\p{L}\p{N}]+/gu, '')
  ]);
  return Array.from(set);
};
const clamp01 = (t) => Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
const lerp = (a, b, t) => a + (b - a) * clamp01(t);
const toHex = (x) => Math.round(x).toString(16).padStart(2, '0');
const rgb = (r, g, b) => `#${toHex(r)}${toHex(g)}${toHex(b)}`;

// Escalas por nombre (fallback si no hay palette)
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
    // customPalette: "#ff0000,#00ff00,#0000ff"
    const raw = (s.customPalette && s.customPalette.value ? String(s.customPalette.value) : '').trim();
    if (raw) {
      const colors = raw.split(',')
        .map(x => x.trim())
        .filter(x => /^#?[0-9a-f]{6}$/i.test(x))
        .map(x => x.startsWith('#') ? x : '#'+x);
      if (colors.length) return { mode: 'custom', colors };
    }
    // colorPalette avanzado (si existe)
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
    colorScale:      (s.colorScale && s.colorScale.value) || 'greenToRed',
    invertScale:     !!(s.invertScale && s.invertScale.value),

    showLabels:      !!(s.showLabels && s.showLabels.value),
    showLegend:      (s.showLegend && s.showLegend.value !== undefined) ? !!s.showLegend.value : true,
    legendPosition:  (s.legendPosition && s.legendPosition.value) || 'bottomright',
    showBorders:     (s.showBorders && s.showBorders.value !== undefined) ? !!s.showBorders.value : true,

    borderColor:     (s.borderColor && s.borderColor.value && s.borderColor.value.color) || '#000000',
    borderWidth:     num(s.borderWidth && s.borderWidth.value, 1),
    borderOpacity:   num(s.borderOpacity && s.borderOpacity.value, 1),

    opacity:         num(s.opacity && s.opacity.value, 0.45),
    colorMissing:    (s.colorMissing && s.colorMissing.value && s.colorMissing.value.color) || '#cccccc',
    popupFormat:     (s.popupFormat && s.popupFormat.value) || '<strong>{{nombre}}</strong><br/>Valor: {{valor}}',

    colorPalette:    getPalette(),
  };
}


// (Alineado con tu Config moderno: ids y tipos de controls).  

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
// (Misma heurística robusta que la versión IIFE). 

// ---------------------- Datos: mapear dimensión → métrica ----------------------
/*function buildValueMap(message) {
  // ---- 1) Esquema MODERNO: fields.geoDimension / fields.metricPrimary
  const fbc = message?.fieldsByConfigId || {};
  const modernDim = Array.isArray(fbc?.geoDimension) ? fbc.geoDimension[0] : null;
  const modernMet = Array.isArray(fbc?.metricPrimary) ? fbc.metricPrimary[0] : null;

  // ---- 2) Esquema LEGACY: data[].elements -> mainData (barrio/valor)
  // Si existe, asumimos orden [DIM, MET] como en tu Config legacy.
  const legacyMain = fbc?.mainData?.elements || null;

  // Tablas (objectTransform): nombres en DEFAULT.fields y valores en DEFAULT.rows
  const table = message?.tables?.DEFAULT || {};
  // Normalizar claves para asegurar match
const dimName = fields[0].id; // El id del campo dimensión (Barrio)
const geoKeyName = 'BARRIO';  // El nombre de la propiedad en el GeoJSON

const dataMap = new Map();
data.forEach(row => {
  const key = normalizeKeyFuzzy(row[dimName])[0]; // Usa primera variante
  dataMap.set(key, row);
});

geojson.features.forEach(feature => {
  const featureKey = normalizeKeyFuzzy(feature.properties[geoKeyName])[0];
  const row = dataMap.get(featureKey);
  if (row) {
    feature.properties.metric = row[fields[1].id];
  } else {
    feature.properties.metric = null;
  }
});

// SOPORTE fields (tableTransform) y headers (objectTransform)
const fieldIds = Array.isArray(table.fields) ? table.fields
                : (Array.isArray(table.headers) ? table.headers : []);
const rows = Array.isArray(table.rows) ? table.rows
            : (Array.isArray(table.data) ? table.data : []);
// PATCH Debug
try {
  console.log('[Viz] table keys:', Object.keys(table));
  console.log('[Viz] fields/headers:', (fieldIds || []).map(f => f?.name || f?.id));
  console.log('[Viz] rows.length:', Array.isArray(rows) ? rows.length : 0);
  console.log('[Viz] fieldsByConfigId:', Object.keys(message?.fieldsByConfigId || {}));
} catch {}


  // Detectar índices
  let idxDim = -1, idxMet = -1;

  // 2a) LEGACY por posición
  if (legacyMain && legacyMain.length >= 2) {
    idxDim = 0;
    idxMet = 1;
  }

  // 1a) MODERNO por name/id
  if ((idxDim < 0 || idxMet < 0) && (modernDim || modernMet)) {
    const wantedDim = (modernDim?.name || modernDim?.id || '').toString().toLowerCase();
    const wantedMet = (modernMet?.name || modernMet?.id || '').toString().toLowerCase();
    fieldIds.forEach((f, i) => {
      const nm = (f?.name || f?.id || '').toString().toLowerCase();
      if (idxDim < 0 && wantedDim && nm === wantedDim) idxDim = i;
      if (idxMet < 0 && wantedMet && nm === wantedMet) idxMet = i;
    });
  }

  // 3) Heurística por nombre (cubre 'barrio'/'valor' del legacy y otros)
  if ((idxDim < 0 || idxMet < 0) && Array.isArray(fieldIds)) {
    const dimIdx = fieldIds.findIndex(f => /barrio|comuna|nombre|texto|name/i.test(f?.name || f?.id || ''));
    const metIdx = fieldIds.findIndex(f => /valor|m(é|e)trica|metric|value|cantidad|total/i.test(f?.name || f?.id || ''));
    if (idxDim < 0 && dimIdx >= 0) idxDim = dimIdx;
    if (idxMet < 0 && metIdx >= 0) idxMet = metIdx;
  }
// PATCH Fallback: si aún no hay métrica, elegir la primera columna NUMÉRICA escaneando filas
if (idxMet < 0 && Array.isArray(fieldIds) && Array.isArray(rows) && rows.length) {
  const sampleN = Math.min(rows.length, 25);
  const isNumericCol = (colIdx) => {
    let hits = 0, seen = 0;
    for (let r = 0; r < sampleN; r++) {
      const cell = rows[r]?.[colIdx];
      const n = Number(cell?.v ?? cell?.value ?? cell);
      if (!Number.isNaN(n)) hits++;
      seen++;
    }
    // al menos 60% de filas numéricas en la muestra
    return seen > 0 && hits / seen >= 0.6;
  };
  for (let i = 0; i < fieldIds.length; i++) {
    if (i !== idxDim && isNumericCol(i)) { idxMet = i; break; }
  }
}

  const map = new Map();
  const values = [];

  if (idxDim < 0 || idxMet < 0 || !rows.length) {
    return { map, min: NaN, max: NaN, count: 0 };
  }
// PATCH Debug sample de mapeo (primeras 5 claves normalizadas)
try {
  const sample = [];
  let c = 0;
  for (const [k, v] of map.entries()) { sample.push([k, v]); if (++c >= 5) break; }
  console.log('[Viz] sample map entries:', sample);
  console.log('[Viz] min/max/count:', min, max, values.length);
} catch {}

  for (const row of rows) {
    const d = row[idxDim];
    const m = row[idxMet];

    const key = (d?.v ?? d?.value ?? d ?? '').toString();
    const val = Number(m?.v ?? m?.value ?? m);

    if (key && Number.isFinite(val)) {
      for (const k of normalizeKeyFuzzy(key)) map.set(k, val);
      values.push(val);
    }
  }

  const min = values.length ? Math.min(...values) : NaN;
  const max = values.length ? Math.max(...values) : NaN;
  return { map, min, max, count: values.length };
}
*/
function buildValueMap(message) {
  const fbc = message?.fieldsByConfigId || {};
  const modernDim = Array.isArray(fbc?.geoDimension) ? fbc.geoDimension[0] : null;
  const modernMet = Array.isArray(fbc?.metricPrimary) ? fbc.metricPrimary[0] : null;
  const table = message?.tables?.DEFAULT || {};
  const fieldIds = Array.isArray(table.fields) ? table.fields : (Array.isArray(table.headers) ? table.headers : []);
  const rows = Array.isArray(table.rows) ? table.rows : (Array.isArray(table.data) ? table.data : []);

  // Debug
  console.log('[Viz] table keys:', Object.keys(table));
  console.log('[Viz] fields/headers:', fieldIds.map(f => f?.id || f?.name));
  console.log('[Viz] rows.length:', rows.length);
  console.log('[Viz] fieldsByConfigId:', Object.keys(fbc));

  let idxDim = -1, idxMet = -1;
  let keyFieldId, valFieldId;

  // Moderno: usar IDs de fieldsByConfigId
  if (modernDim && modernMet) {
    keyFieldId = modernDim.id || modernDim.name;
    valFieldId = modernMet.id || modernMet.name;
    fieldIds.forEach((f, i) => {
      const nm = (f?.id || f?.name || '').toString().toLowerCase();
      if (keyFieldId.toLowerCase() === nm) idxDim = i;
      if (valFieldId.toLowerCase() === nm) idxMet = i;
    });
  }

  // Legacy o heurística
  if (idxDim < 0 || idxMet < 0) {
    idxDim = fieldIds.findIndex(f => /barrio|comuna|nombre|texto|name/i.test(f?.name || f?.id || ''));
    idxMet = fieldIds.findIndex(f => /valor|m(é|e)trica|metric|value|cantidad|total/i.test(f?.name || f?.id || ''));
  }

  // Fallback numérico para métrica
  if (idxMet < 0 && rows.length) {
    const sampleN = Math.min(rows.length, 25);
    const isNumericCol = (colIdx) => {
      let hits = 0, seen = 0;
      for (let r = 0; r < sampleN; r++) {
        const row = rows[r];
        const cell = Array.isArray(row) ? row[colIdx] : row[fieldIds[colIdx]?.id || fieldIds[colIdx]?.name];
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

  for (const row of rows) {
    const d = Array.isArray(row) ? row[idxDim] : row[keyFieldId];
    const m = Array.isArray(row) ? row[idxMet] : row[valFieldId];
    const key = (d?.v ?? d?.value ?? d ?? '').toString();
    const val = Number(m?.v ?? m?.value ?? m);

    if (key && Number.isFinite(val)) {
      for (const k of normalizeKeyFuzzy(key)) map.set(k, val);
      values.push(val);
    }
  }

  const min = values.length ? Math.min(...values) : NaN;
  const max = values.length ? Math.max(...values) : NaN;

  console.log('[Viz] sample map entries:', Array.from(map.entries()).slice(0, 5));
  console.log('[Viz] min/max/count:', min, max, values.length);
  return { map, min, max, count: values.length };
}

// (Soporta moderno y fallback a tablas; evita el “no puedo leer … undefined”). 

// ---------------------- Render principal ----------------------
export default function drawVisualization(container, message = {}) {
  // Reset contenedor
  container.innerHTML = '';
  container.style.width = '100%';
  container.style.height = '100%';

  const style = readStyle(message);
  const nivel = style.nivelJerarquia || 'barrio';
  const stats = buildValueMap(message);
  const geojson = GEOJSON;

  // Mapa (sin tiles externos; CSP-safe)
  const map = L.map(container, { zoomControl: true, attributionControl: true });
  // Rectángulo de contexto si hiciera falta
  // L.rectangle([[-34.75, -58.55], [-34.48, -58.25]], { color: '#bbb', weight: 1, fillOpacity: 0.02 }).addTo(map);

  // Estilo por feature (usa palette o escala)
  const styleFn = (feature) => {
    const nombre = getFeatureNameProp(feature, nivel, style.geojsonProperty);
    let v;
    if (stats?.map?.size) {
      for (const k of normalizeKeyFuzzy(nombre)) { if (stats.map.has(k)) { v = stats.map.get(k); break; } }
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
      color:  style.showBorders ? style.borderColor  : 'transparent',
      weight: style.showBorders ? style.borderWidth  : 0,
      opacity:style.showBorders ? style.borderOpacity: 0,
      fillColor,
      fillOpacity: style.opacity
    };

  };

  const layer = L.geoJSON(geojson, {
    style: styleFn,
    onEachFeature: (feature, lyr) => {
      const nombre = getFeatureNameProp(feature, nivel, style.geojsonProperty) ?? '—';
      if (style.showLabels) {
        lyr.bindTooltip(String(nombre), { sticky: true, direction: 'center' });
      }
      let v;
      if (stats?.map?.size) {
        for (const k of normalizeKeyFuzzy(nombre)) { if (stats.map.has(k)) { v = stats.map.get(k); break; } }
      }
      const content = (style.popupFormat || '')
        .replace(/\{\{\s*nombre\s*\}\}/gi, String(nombre))
        .replace(/\{\{\s*valor\s*\}\}/gi, (v != null && Number.isFinite(v)) ? String(v) : 's/d');
      lyr.bindPopup(content, { closeButton: false });
    }
  }).addTo(map);

try {
  const b = layer.getBounds();
  if (b && b.isValid && b.isValid()) {
    map.fitBounds(b, { padding: [16, 16] });
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

  // --- helper: asegura un contenedor 100% del área ---
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
    const _diag = (label, extra = {}) => {
      console.log(`[Diag ${label}]`, {
        time: new Date().toISOString(),
        dsccExists: !!window.dscc,
        dsccType: typeof window.dscc,
        subscribeToDataType: typeof window.dscc?.subscribeToData,
        tableTransformType: typeof window.dscc?.tableTransform,
        objectTransformType: typeof window.dscc?.objectTransform,
        locationHref: location.href,
        ...extra
      });
    };

    _diag(`attempt-${attempt}`);

    const dscc = (typeof window !== 'undefined') ? window.dscc : null;

    if (dscc && typeof dscc.subscribeToData === 'function') {
      console.log(`[Viz] initWrapper: dscc disponible en attempt ${attempt}`);

      // Suscripción con tableTransform (la que usamos normalmente)
      dscc.subscribeToData((data) => {
        try {
          console.group('[Viz] Datos con tableTransform');

          const dims = data?.fields?.dimensions || [];
          const mets = data?.fields?.metrics || [];
          const rows = data?.tables?.DEFAULT?.rows || [];
          const headers = data?.tables?.DEFAULT?.headers || [];

          console.log(`Dimensiones (${dims.length}):`, dims.map(d => d.name));
          console.log(`Métricas (${mets.length}):`, mets.map(m => m.name));
          console.log(`Headers tabla (${headers.length}):`, headers.map(h => h.name));
          console.log(`Total de filas: ${rows.length}`);

          if (rows.length > 0) {
            const sampleCount = Math.min(rows.length, 5);
            console.log(`Mostrando ${sampleCount} filas de ejemplo:`);

            // Mapea cada fila a un objeto {header: valor}
            for (let i = 0; i < sampleCount; i++) {
              const rowObj = {};
              headers.forEach((h, idx) => {
                rowObj[h.name] = rows[i][idx];
              });
              console.log(`Fila ${i + 1}:`, rowObj);
            }
          } else {
            console.warn('[Viz] La tabla transformada no contiene filas.');
          }

          console.groupEnd();

          console.log('[Viz] → Ejecutando drawVisualization...');
          drawVisualization(ensureContainer(), data);
          console.log('[Viz] drawVisualization finalizó sin error.');
        } catch (err) {
          console.error('[Viz] Error procesando datos en subscribeToData (transform):', err);
        }
      }, { transform: dscc.tableTransform });

    } else {
      if (attempt < 5) {
        console.warn(`[Viz] dscc no disponible en attempt ${attempt}, reintentando en 1s...`);
        console.log('Href:', location.href);
        console.log('Referrer:', document.referrer);
        setTimeout(() => initWrapper(attempt + 1), 1000);
      } else {
        console.error('[Viz] dscc no disponible tras 5 intentos, entrando en fallback.');
        console.log('[Viz] Contenido de window (keys):', Object.keys(window));
                console.log('Href:', location.href);
        console.log('Referrer:', document.referrer);
        const container = ensureContainer();
        container.innerHTML = `
          <div style="font:14px system-ui; padding:12px; border:1px solid #eee; border-radius:8px">
            <strong>Sin dscc:</strong> No se detecta API de Looker Studio.<br/>
            Verificá que la viz esté insertada como <em>Componente de la comunidad</em> en un informe real.
          </div>`;
        drawVisualization(container, {});
      }
    }
  } catch (e) {
    console.error('[Viz] Error initWrapper:', e);
  }
}






  // --- invocación segura del wrapper ---
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      try { console.log('[Viz] DOMContentLoaded → initWrapper()'); initWrapper(); } catch (e) { console.error(e); }
    });
  } else {
    try { console.log('[Viz] DOM listo → initWrapper()'); initWrapper(); } catch (e) { console.error(e); }
  }
})();
