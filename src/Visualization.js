// src/Visualization.js
// Community Viz 2025 — Leaflet sin fetch/tiles (CSP-safe) + wrapper dscc

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Embebido del GeoJSON (Vite: ?raw devuelve string)
import geojsonText from './barrioscaba.geojson?raw';
let GEOJSON = null;
try {
  if (typeof geojsonText !== 'string' || !geojsonText.length) {
    console.error('[Viz] GeoJSON embebido vacío o no-string. typeof=', typeof geojsonText, 'len=', geojsonText?.length || 0);
  } else {
    console.info('[Viz] geojsonText len=', geojsonText.length, 'preview=', geojsonText.slice(0, 80));
    GEOJSON = JSON.parse(geojsonText);
  }
} catch (e) {
  console.error('[Viz] Error al parsear GeoJSON embebido:', e);
}
if (GEOJSON?.type !== 'FeatureCollection') {
  console.warn('[Viz] GeoJSON no es FeatureCollection o no parseó:', GEOJSON);
} else {
  const n = Array.isArray(GEOJSON.features) ? GEOJSON.features.length : -1;
  console.info('[Viz] GEOJSON OK · features=', n);
}
if (typeof window !== 'undefined') window.GEOJSON = GEOJSON;
// Cache del último mapa válido para evitar “parpadeos” cuando rows=0
let LAST_STATS = null;

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
  return String(v)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // sin acentos
    .replace(/[^\w\s]/g, ' ')                         // signos → espacio
    .replace(/\s+/g, ' ')                             // colapsa espacios
    .trim()
    .toUpperCase();
}

// Si no matchea directo, probamos variantes sin paréntesis/sufijos
function normalizeKeyFuzzy(v) {
  const base = normalizeKey(v);
  const variants = [base];

  // quita “(…)” al final
  variants.push(base.replace(/\s*\([^)]*\)\s*$/, '').trim());

  // quita “- …” o “, …” sufijos comunes
  variants.push(base.replace(/\s*[-,].*$/, '').trim());

  // quita la palabra CABA/CIUDAD si viniera
  variants.push(base.replace(/\b(CABA|CIUDAD|CAPITAL FEDERAL)\b/g, '').replace(/\s+/g, ' ').trim());

  // únicas y no vacías
  return Array.from(new Set(variants.filter(x => x && x.length)));
}




function getFeatureName(feature, nivelJerarquia = 'barrio') {
  const p = feature?.properties || {};
  if (nivelJerarquia === 'comuna') {
    // COMUNA numérica → string sin ceros a la izquierda
    const raw = p.COMUNA ?? p.comuna ?? p.Comuna ?? p.cod_comuna ?? p.codigo_comuna ?? p.COD_COMUNA;
    if (raw == null) return raw;
    const s = String(raw).trim();
    const sinCeros = /^\d+$/.test(s) ? s.replace(/^0+/, '') : s;
    return sinCeros;
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
// 1) Conversión segura a número (soporta "1.234", "1,234", "1 234")
function toNumber(v) {
  if (v == null) return NaN;
  let s = String(v).trim();
  // quitar espacios/miles y normalizar coma/punto (conserva el separador decimal final)
  s = s.replace(/\s+/g, '');
  if (/[.,]/.test(s)) {
    const last = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    s = s.replace(/[.,]/g, (m, idx) => (idx === s.lastIndexOf(last) ? '.' : ''));
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}


// Espera transform: dscc.objectTransform
// 2) buildValueMap con logs y conversión robusta
// Espera transform: dscc.objectTransform
// 2) buildValueMap con logs y conversión robusta (soporta rows como objeto o array)
function buildValueMap(message, nivelJerarquia = 'barrio') {
  try {
  // Preferimos fieldsByConfigId.mainData, pero si viene vacío usamos tables.DEFAULT.fields
  const fieldsCfg = message?.fieldsByConfigId?.mainData || [];
  const fieldsTbl = message?.tables?.DEFAULT?.fields || [];
  const fields = (Array.isArray(fieldsCfg) && fieldsCfg.length) ? fieldsCfg : fieldsTbl;
  const rows   = (message?.tables?.DEFAULT?.rows) || [];


    console.info('[Viz] rows:', rows.length);

    if (!Array.isArray(fields) || !Array.isArray(rows) || !fields.length || !rows.length) return null;

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
    console.info('[Viz] fields:', {
      dimId: dimField?.id, dimConfigId: dimField?.configId,
      metricId: metricField?.id, metricConfigId: metricField?.configId
    });
    if (!dimField?.id || !metricField?.id) return null;

    // índices posicionales por si rows vienen como arrays
    const dimIdx    = fields.findIndex(f => f.id === dimField.id);
    const metricIdx = fields.findIndex(f => f.id === metricField.id);

    const map = new Map();
    let min = Infinity, max = -Infinity;

    // helper para leer una celda sin asumir shape
    const getCell = (row, fieldObj, idx) => {
      if (row == null) return undefined;
      // objeto por field.id
      if (row && typeof row === 'object' && !Array.isArray(row) && fieldObj?.id in row) {
        return row[fieldObj.id];
      }
      // array posicional
      if (Array.isArray(row) && idx >= 0) {
        return row[idx];
      }
      return undefined;
    };

    // log de shape (solo 1 fila)
    if (rows.length) {
      const r0 = rows[0];
      console.info('[Viz] row[0] shape:', Array.isArray(r0) ? 'array' : typeof r0);
      console.info('[Viz] sample dim:', getCell(r0, dimField, dimIdx), 'metric:', getCell(r0, metricField, metricIdx));
    }

for (const r of rows) {
  const keyRaw = getCell(r, dimField, dimIdx);
  const val    = toNumber(getCell(r, metricField, metricIdx));

  if (keyRaw == null || !Number.isFinite(val)) continue;

  const k = normalizeKey(keyRaw);
  map.set(k, val);
  if (val < min) min = val;
  if (val > max) max = val;
}



const size = map.size;
if (!size) {
  console.warn('[Viz] stats.map vacío (sin filas válidas)');
  return null;
}
if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
  console.warn('[Viz] rango degenerado; aplico 0..1', { min, max });
  const out = { map, min: 0, max: 1 };
  console.info('[Viz] stats:', { size, min: out.min, max: out.max });
  return out;
}

console.info('[Viz] stats:', { size, min, max });
return { map, min, max };
  } catch (err) {
    console.error('[Viz] Error en buildValueMap:', err);
    return null;
  }
} // ✅ ← Cierra aquí la función correctamente




// ---------------------- Render principal ----------------------
function drawVisualization(container, message = {}) {
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

  // --- Diagnóstico mínimo + stats con cache ---
  // Preferimos fieldsByConfigId.mainData, pero si viene vacío usamos tables.DEFAULT.fields
  const fieldsCfg = message?.fieldsByConfigId?.mainData ?? [];
  const fieldsTbl = message?.tables?.DEFAULT?.fields ?? [];
  const fields = (Array.isArray(fieldsCfg) && fieldsCfg.length) ? fieldsCfg : fieldsTbl;
  const rows   = message?.tables?.DEFAULT?.rows ?? [];

  console.info('[Viz] rows:', rows.length);
  console.info('[Viz] fields:', fields.map(f => ({ id: f?.id, name: f?.name, concept: f?.concept })));

  // --- Stats (ÚNICO) con cache para evitar parpadeos cuando rows=0 ---
  const statsRaw = buildValueMap(message, nivel);
  const stats    = statsRaw || LAST_STATS || null;
  if (statsRaw) LAST_STATS = statsRaw;

  const size = (stats?.map instanceof Map) ? stats.map.size : 0;
  console.info('[Viz] stats.map:', { size, min: stats?.min ?? null, max: stats?.max ?? null });

  // Diagnósticos útiles (seguros)
  console.info('[Viz] drawVisualization()');
  if (stats?.map instanceof Map) {
    console.info('[Debug] Claves en stats.map:', Array.from(stats.map.keys()).slice(0, 10));
  } else {
    console.info('[Debug] Claves en stats.map: (sin datos)');
  }

  if (GEOJSON?.features?.length) {
    console.info('[Debug] Claves en GeoJSON:', GEOJSON.features
      .slice(0, 10)
      .map(f => getFeatureName(f, nivel)));
  } else {
    console.info('[Debug] Claves en GeoJSON: (sin features)');
  }

  // Muestra 2 claves de datos vs 2 del GeoJSON (diagnóstico fino)
  try {
    const dataKeys = size ? Array.from(stats.map.keys()).slice(0, 2) : [];
    const gjKeys = (GEOJSON?.features || [])
      .slice(0, 2)
      .map(f => normalizeKey(getFeatureName(f, nivel)));
    console.info('[Viz] sampleKeys:', { data: dataKeys, geojson: gjKeys });
  } catch (err) {
    console.warn('[Viz] sampleKeys error:', err);
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
