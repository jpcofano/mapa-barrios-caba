// src/Visualization.js
// Community Viz 2025 — Leaflet sin fetch/tiles (CSP-safe) + wrapper dscc

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Embebido del GeoJSON (Vite: ?raw devuelve string)
import geojsonText from './barrioscaba.geojson?raw';
const GEOJSON = JSON.parse(geojsonText);

// ---------------------- Helpers de estilo ----------------------
function readStyle(message = {}) {
  const s = message?.styleById ?? {};
  return {
    nivelJerarquia: s?.nivelJerarquia?.value ?? 'barrio',
    colorScale:     s?.colorScale?.value     ?? 'greenToRed',
    invertScale:    !!s?.invertScale?.value,
    showLabels:     !!s?.showLabels?.value,
    showLegend:     (s?.showLegend?.value ?? true),
    borderColor:    s?.borderColor?.value?.color ?? '#000000',
    borderWidth:    Number(s?.borderWidth?.value ?? 1),
  };
}

function lerp(a, b, t) { return Math.round(a + (b - a) * t); }
function rgb(r, g, b) { return `rgb(${r},${g},${b})`; }
function clamp01(x) { return Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0)); }

function colorFromScale(scaleName, t, invert = false) {
  t = clamp01(t);
  if (invert) t = 1 - t;

  switch (scaleName) {
    case 'yellow': { // Amarillo → Rojo
      return rgb(lerp(255, 244, t), lerp(193, 67, t), lerp(7, 54, t));
    }
    case 'blueToYellow': { // Azul → Amarillo
      return rgb(lerp(30, 255, t), lerp(136, 193, t), lerp(229, 7, t));
    }
    case 'grayscale': { // Gris → Negro
      const g = Math.round(255 * (1 - t));
      return rgb(g, g, g);
    }
    case 'greenToRed':
    default: { // Verde → Rojo
      return rgb(lerp(67, 229, t), lerp(160, 57, t), lerp(71, 35, t));
    }
  }
}

// ---------------------- Helpers de datos ----------------------
function normalizeKey(v) {
  if (v == null) return '';
  const s = String(v);
  return s
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita acentos
    .replace(/[^\w\s]/g, ' ')                         // quita signos
    .replace(/\s+/g, ' ')                             // colapsa espacios
    .trim()
    .toUpperCase();
}



function getFeatureName(feature, nivelJerarquia = 'barrio') {
  const p = feature?.properties || {};
  if (nivelJerarquia === 'comuna') {
    // COMUNA numérica → la pasamos a string normalizada
    return p.COMUNA ?? p.comuna ?? p.Comuna ?? p.cod_comuna ?? p.codigo_comuna ?? p.COD_COMUNA;
  }
  // BARRIO / NOMBRE (candidatos en varios estilos)
  const candidates = [
    p.nombre, p.NOMBRE, p.Nombre,
    p.barrio, p.BARRIO, p.Barrio,
    p.name, p.NOMBRE_BARRIO, p.barrio_nombre, p.barrio_desc
  ];
  for (const c of candidates) {
    if (c != null && String(c).trim().length) return c;
  }
  // fallback: primer string en properties
  const anyStr = Object.values(p).find(v => typeof v === 'string' && v.trim().length);
  return anyStr ?? '—';
}
// 1) Conversión segura a número (soporta "1.234", "1,234", "1 234")
function toNumber(v) {
  if (v == null) return NaN;
  const s = String(v).trim().replace(/\s+/g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

// Espera transform: dscc.objectTransform
// 2) buildValueMap con logs y conversión robusta
function buildValueMap(message, nivelJerarquia = 'barrio') {
  try {
    const fields = (message?.fieldsByConfigId?.mainData) || [];
    const rows   = (message?.tables?.DEFAULT?.rows) || [];

    console.info('[Viz] rows:', rows.length);

    if (!Array.isArray(fields) || !Array.isArray(rows) || !fields.length || !rows.length) return null;

    // Elegir DIM y METRIC
    const findDim = () => {
      if (nivelJerarquia === 'comuna') {
        return fields.find(f => f.concept === 'DIMENSION' && /(comuna|codigo_?comuna|cod_?comuna)/i.test(f.configId || f.id))
            || fields.find(f => f.concept === 'DIMENSION');
      }
      return fields.find(f => f.concept === 'DIMENSION' && /(barrio|nombre|name)/i.test(f.configId || f.id))
          || fields.find(f => f.concept === 'DIMENSION');
    };

    const dimField    = findDim();
    const metricField = fields.find(f => f.concept === 'METRIC');

    console.info('[Viz] fields:', { dimId: dimField?.id, metricId: metricField?.id });

    if (!dimField?.id || !metricField?.id) return null;

    const map = new Map();
    let min = Infinity, max = -Infinity;

    for (const r of rows) {
      // objectTransform => r es objeto: {<fieldId>: valor, ...}
      const keyRaw = r[dimField.id];
      const val    = toNumber(r[metricField.id]);
      if (keyRaw == null || !Number.isFinite(val)) continue;

      const k = normalizeKey(keyRaw);
      map.set(k, val);
      if (val < min) min = val;
      if (val > max) max = val;
    }

    const size = map.size;
    if (!size) {
      console.warn('[Viz] valueMap vacío (no hubo match de claves o métrica NaN)');
      return null;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
      console.warn('[Viz] rango degenerado, usando 0..1', { min, max });
      console.info('[Viz] valueMap:', { size, min: 0, max: 1 });
      return { map, min: 0, max: 1 };
    }

    console.info('[Viz] valueMap:', { size, min, max });
    return { map, min, max };
  } catch (e) {
    console.warn('buildValueMap error:', e);
    return null;
  }
}


console.info('[Viz] drawVisualization()');

// ---------------------- Render principal ----------------------
export default function drawVisualization(container, message = {}) {
  // Reset contenedor
  container.innerHTML = '';
  container.style.width = '100%';
  container.style.height = '100%';

  const style = readStyle(message);
  const nivel = style.nivelJerarquia || 'barrio';

  // Mapa sin tiles (fondo blanco) — compatible CSP
  const map = L.map(container, { zoomControl: true, attributionControl: false })
               .setView([-34.61, -58.38], 12);

  // Datos GeoJSON embebidos
  const data = GEOJSON;
  if (!data) {
    console.error('GeoJSON embebido no disponible.');
    L.rectangle([[-34.75, -58.55], [-34.48, -58.25]], { color: '#bbb', weight: 1, fillOpacity: 0.05 }).addTo(map);
    return;
  }
console.info('[Viz] fieldsByConfigId', message?.fieldsByConfigId);
console.info('[Viz] rows', message?.tables?.DEFAULT?.rows?.length || 0);

  // Join barrio → valor (si hay datos)
const stats = buildValueMap(message, nivel);

// Punto 3: log de claves para comparar DIMENSIÓN ↔ GeoJSON
try {
  const dataKeys = stats ? Array.from(stats.map.keys()).slice(0, 2) : [];
  const gjKeys = (GEOJSON?.features || [])
    .slice(0, 2)
    .map(f => normalizeKey(getFeatureName(f, nivel)));
  console.info('[Viz] sampleKeys:', { data: dataKeys, geojson: gjKeys });
} catch (err) {
  console.warn('[Viz] sampleKeys error:', err);
}

const styleFn = (feature) => {
  // ...
};

// 4) styleFn (sin cambios lógicos, solo usa stats si existe)
const styleFn = (feature) => {
  let fill = '#3388ff';
  const nombre = getFeatureName(feature, nivel);
  const k = normalizeKey(nombre);

  if (stats?.map?.size) {
    const v = stats.map.get(k);
    const t = Number.isFinite(v) ? (v - stats.min) / (stats.max - stats.min || 1) : 0.05;
    fill = colorFromScale(style.colorScale, t, style.invertScale);
  } else {
    fill = colorFromScale(style.colorScale, 0.4, style.invertScale);
  }

  return {
    color: style.borderColor,
    weight: style.borderWidth,
    fillColor: fill,
    fillOpacity: 0.45
  };
};


console.info('[Viz] style', style, 'nivel', nivel);
// Crea la capa SIN .addTo(map)
const layer = L.geoJSON(GEOJSON, {
  style: styleFn,
  onEachFeature: (feature, lyr) => {
    const nombre = getFeatureName(feature, nivel) ?? '—';
    if (style.showLabels) {
      lyr.bindTooltip(String(nombre), { sticky: true, direction: 'center' });
    }
    if (stats?.map?.size) {
      const v = stats.map.get(normalizeKey(nombre));
      lyr.bindPopup(`<strong>${nombre}</strong><br/>Valor: ${v != null ? v : 's/d'}`, { closeButton: false });
    } else {
      lyr.bindPopup(`<strong>${nombre}</strong>`, { closeButton: false });
    }
  }
});

// 🔍 Diagnóstico opcional (muestra hasta 10 barrios sin dato)
if (stats?.map?.size) {
  const missing = [];
  GEOJSON.features?.forEach(f => {
    const k = normalizeKey(getFeatureName(f, nivel));
    if (!stats.map.has(k)) missing.push(k);
  });
  console.info('[Viz] Sin dato (10):', missing.slice(0,10), 'Total:', missing.length);
}

// Ahora sí, agregá la capa al mapa
layer.addTo(map);


  try {
    map.fitBounds(layer.getBounds(), { padding: [12, 12] });
  } catch {}

  if (style.showLegend) {
    const legend = L.control({ position: 'bottomright' });
    legend.onAdd = () => {
      const div = L.DomUtil.create('div', 'legend');
      Object.assign(div.style, {
        background: 'white',
        padding: '8px 10px',
        borderRadius: '8px',
        boxShadow: '0 1px 4px rgba(0,0,0,.25)',
        font: '12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
      });

      const steps = 5, items = [];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const c = colorFromScale(style.colorScale, t, style.invertScale);
        items.push(
          `<div style="display:flex;align-items:center;gap:8px;">
             <span style="display:inline-block;width:12px;height:12px;background:${c};border:1px solid #0001"></span>
             <span>${Math.round(t*100)}%</span>
           </div>`
        );
      }

      div.innerHTML = `
        <div style="margin-bottom:6px;"><strong>Escala</strong> · ${style.colorScale}${style.invertScale ? ' (invertida)' : ''}</div>
        ${items.join('')}
      `;
      return div;
    };
    legend.addTo(map);
  }
}

// ---------------------- Wrapper dscc (suscripción de datos) ----------------------
(function initWrapper() {
  try {
    // Looker inyecta `dscc` en runtime; en dev puede no estar
    // eslint-disable-next-line no-undef
    const dscc = (typeof window !== 'undefined') ? window.dscc : null;

    const ensureContainer = () => {
      let el = document.getElementById('container');
      if (!el) {
        el = document.createElement('div');
        el.id = 'container';
        el.style.width = '100%';
        el.style.height = '100%';
        document.body.appendChild(el);
      }
      return el;
    };

    const container = ensureContainer();

    if (dscc && dscc.subscribeToData) {
      dscc.subscribeToData(
        (data) => {
          // Normalizamos shape para evitar keys inesperadas
          const message = {
            styleById: data?.style?.styleParamsByConfigId || data?.styleById || {},
            fieldsByConfigId: data?.fieldsByConfigId || {},
            tables: data?.tables || {}
          };
          try {
            drawVisualization(container, message);
          } catch (err) {
            console.error('[Viz] Render error:', err);
          }
        },
        { transform: dscc.objectTransform }
      );
    } else {
      // Dev local fuera de Looker
      drawVisualization(container, {});
    }

    // Exponer global por compatibilidad
    if (typeof window !== 'undefined') {
      window.drawVisualization = drawVisualization;
    }
  } catch (e) {
    console.warn('[Viz] Wrapper init falló:', e);
  }
})();
