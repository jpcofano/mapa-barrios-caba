// src/Visualization.js
// Community Viz 2025 — Leaflet (sin fetch) + Vite + dscc.objectTransform

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './styles.css';


// GeoJSON embebido (Vite: ?raw devuelve string)
import geojsonText from './barrioscaba.geojson?raw';
const GEOJSON = JSON.parse(geojsonText);

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
  const s = message?.styleById ?? {};

  const getPalette = () => {
    const v = s?.colorPalette?.value;
    if (!v) return null;
    if (typeof v === 'string') return { mode: 'custom', colors: [v] };
    const colors = v.colors || v.palette || v.values || [];
    return { mode: v.mode || 'custom', colors: Array.isArray(colors) ? colors : [] };
  };

  return {
    nivelJerarquia: s?.nivelJerarquia?.value ?? 'barrio',
    geojsonProperty: (s?.geojsonProperty?.value || '').toString().trim(),
    colorScale:      s?.colorScale?.value ?? 'greenToRed',
    invertScale:     !!s?.invertScale?.value,

    showLabels:      !!s?.showLabels?.value,
    showLegend:      (s?.showLegend?.value ?? true),
    legendPosition:  s?.legendPosition?.value ?? 'bottomright',
    showBorders:     (s?.showBorders?.value ?? true),

    borderColor:     s?.borderColor?.value?.color ?? '#000000',
    borderWidth:     Number(s?.borderWidth?.value ?? 1),
    borderOpacity:   Number(s?.borderOpacity?.value ?? 1),

    opacity:         Number(s?.opacity?.value ?? 0.45),
    colorMissing:    s?.colorMissing?.value?.color ?? '#cccccc',
    popupFormat:     s?.popupFormat?.value ?? '<strong>{{nombre}}</strong><br/>Valor: {{valor}}',

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
function buildValueMap(message) {
  // ---- 1) Esquema MODERNO: fields.geoDimension / fields.metricPrimary
  const fbc = message?.fieldsByConfigId || {};
  const modernDim = Array.isArray(fbc?.geoDimension) ? fbc.geoDimension[0] : null;
  const modernMet = Array.isArray(fbc?.metricPrimary) ? fbc.metricPrimary[0] : null;

  // ---- 2) Esquema LEGACY: data[].elements -> mainData (barrio/valor)
  // Si existe, asumimos orden [DIM, MET] como en tu Config legacy.
  const legacyMain = fbc?.mainData?.elements || null;

  // Tablas (objectTransform): nombres en DEFAULT.fields y valores en DEFAULT.rows
  const table = message?.tables?.DEFAULT || {};
  const fieldIds = Array.isArray(table.fields) ? table.fields : [];
  const rows = Array.isArray(table.rows) ? table.rows
              : (Array.isArray(table.data) ? table.data : []);

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

  const map = new Map();
  const values = [];

  if (idxDim < 0 || idxMet < 0 || !rows.length) {
    return { map, min: NaN, max: NaN, count: 0 };
  }

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
    if (b && b.isValid && b.isValid()) map.fitBounds(b, { padding: [16, 16] });
  } catch {}

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
(function initWrapper() {
  try {
    // eslint-disable-next-line no-undef
    const dscc = (typeof window !== 'undefined') ? window.dscc : null;

    // En modo informe, existe dscc; en dev local, no.
    if (dscc && dscc.subscribeToData) {
      dscc.subscribeToData((data) => {
        // Normalizamos shape "moderno"
        const message = {
          styleById: data?.style?.styleParamsByConfigId || data?.styleById || {},
          fieldsByConfigId: data?.fieldsByConfigId || {},
          tables: data?.tables || {}
        };
        const container = ensureContainer();
        drawVisualization(container, message);
      }, { transform: dscc.objectTransform }); // <- MODERNO
    } else {
      // Dev local: render mínimo
      const container = ensureContainer();
      drawVisualization(container, {});
    }
  } catch (e) {
    console.error('[Viz] Error initWrapper:', e);
  }

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
})();
