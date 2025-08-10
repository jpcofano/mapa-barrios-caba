// Visualization.js
// Comunidad Looker Studio — Viz Leaflet sin fetch y sin tiles (CSP-safe)

import L from 'leaflet';

// ---------- Utils de estilo (alineados a tu Config.json) ----------
function readStyle(message = {}) {
  const s = message?.styleById ?? {};
  return {
    nivelJerarquia: s?.nivelJerarquia?.value ?? "barrio",
    colorScale:     s?.colorScale?.value     ?? "greenToRed",
    invertScale:    !!s?.invertScale?.value,
    showLabels:     !!s?.showLabels?.value,
    showLegend:     (s?.showLegend?.value ?? true),
    borderColor:    s?.borderColor?.value?.color ?? "#000000",
    borderWidth:    Number(s?.borderWidth?.value ?? 1),
  };
}

function colorFromScale(scaleName, t, invert = false) {
  // t en [0,1]
  const clamp = (x) => Math.min(1, Math.max(0, x ?? 0));
  t = clamp(t);
  if (invert) t = 1 - t;

  // Paletas simples para demo; podés reemplazar por una rampa más linda luego
  const lerp = (a, b, t) => Math.round(a + (b - a) * t);
  const rgb = (r, g, b) => `rgb(${r},${g},${b})`;

  switch (scaleName) {
    case "yellow":       // Amarillo → Rojo
      return rgb(lerp(255, 244, t), lerp(193, 67, t), lerp(7, 54, t));
    case "blueToYellow": // Azul → Amarillo
      return rgb(lerp(30, 255, t),  lerp(136,193, t), lerp(229, 7, t));
    case "grayscale":    // Gris → Negro
      const g = Math.round(255 * (1 - t));
      return rgb(g, g, g);
    case "greenToRed":   // Verde → Rojo (default)
    default:
      return rgb(lerp(67, 229, t), lerp(160, 57, t), lerp(71, 35, t));
  }
}

// ---------- Utils de datos (join barrio → valor) ----------
// Estructura esperada (transform: dscc.objectTransform):
// - message.fieldsByConfigId.mainData: array de fields con `concept` ('DIMENSION'/'METRIC'), `id`, `configId`
// - message.tables.DEFAULT.rows: array de objetos { [field.id]: value, ... }
function buildValueMap(message) {
  try {
    const fields = message?.fieldsByConfigId?.mainData ?? [];
    const rows = message?.tables?.DEFAULT?.rows ?? [];
    if (!fields.length || !rows.length) return null;

    // Buscar el fieldId para la dimensión de barrio (configId === 'barrio')
    const barrioField =
      fields.find(f => (f.configId || f.id) === "barrio" && f.concept === "DIMENSION") ||
      fields.find(f => f.concept === "DIMENSION");
    if (!barrioField?.id) return null;

    // Primera métrica disponible
    const metricField = fields.find(f => f.concept === "METRIC");
    if (!metricField?.id) return null;

    const map = new Map();
    let min = Infinity, max = -Infinity;

    for (const r of rows) {
      const barrio = r[barrioField.id];
      const val = Number(r[metricField.id]);
      if (barrio == null || isNaN(val)) continue;
      map.set(String(barrio).toUpperCase(), val);
      if (val < min) min = val;
      if (val > max) max = val;
    }
    if (!map.size || !isFinite(min) || !isFinite(max) || min === max) {
      return { map, min: 0, max: 1 }; // evita división por cero
    }
    return { map, min, max };
  } catch {
    return null;
  }
}

function normalizeBarrioName(s) {
  return String(s ?? "").trim().toUpperCase();
}

// ---------- Render principal ----------
export default function drawVisualization(container, message = {}) {
  // Limpieza
  container.innerHTML = "";
  container.style.width = "100%";
  container.style.height = "100%";

  const style = readStyle(message);

  // Mapa sin tiles (fondo blanco) — compatible con CSP
  const map = L.map(container, {
    zoomControl: true,
    attributionControl: false
  }).setView([-34.61, -58.38], 12);

  // GeoJSON inyectado por manifest (ver barrioscaba.js)
  const data = (typeof window !== "undefined") ? window.__GEOJSON : null;
  if (!data) {
    console.error("GeoJSON no disponible: asegurate de incluir 'barrioscaba.js' en el manifest.json");
    // Render minimal para no dejar el contenedor vacío
    L.rectangle([[-34.75, -58.55], [-34.48, -58.25]], { color: "#bbb", weight: 1, fillOpacity: 0.05 }).addTo(map);
    return;
  }

  // Si hay datos de Looker, construir mapa de valores por barrio
  const stats = buildValueMap(message);

  // Función de estilo por feature (choropleth si hay datos, si no color plano)
  const styleFn = (feature) => {
    let fill = "#3388ff";
    if (stats?.map?.size) {
      const barrio = normalizeBarrioName(feature?.properties?.BARRIO);
      const v = stats.map.get(barrio);
      if (v != null) {
        const t = (v - stats.min) / (stats.max - stats.min || 1);
        fill = colorFromScale(style.colorScale, t, style.invertScale);
      } else {
        fill = colorFromScale(style.colorScale, 0.05, style.invertScale); // barrios sin dato
      }
    } else {
      // Sin datos: tono base de la escala
      fill = colorFromScale(style.colorScale, 0.4, style.invertScale);
    }

    return {
      color: style.borderColor,
      weight: style.borderWidth,
      fillColor: fill,
      fillOpacity: 0.45
    };
  };

  const layer = L.geoJSON(data, {
    style: styleFn,
    onEachFeature: (feature, lyr) => {
      const name = feature?.properties?.BARRIO ?? "—";
      if (style.showLabels) {
        lyr.bindTooltip(String(name), { sticky: true, direction: "center" });
      }
      // Tooltip con valor si hay datos
      if (stats?.map?.size) {
        const key = normalizeBarrioName(name);
        const v = stats.map.get(key);
        const valTxt = (v != null ? v : "s/d");
        lyr.bindPopup(`<strong>${name}</strong><br/>Valor: ${valTxt}`, { closeButton: false });
      } else {
        lyr.bindPopup(`<strong>${name}</strong>`, { closeButton: false });
      }
    }
  }).addTo(map);

  try {
    map.fitBounds(layer.getBounds(), { padding: [12, 12] });
  } catch {}

  // Leyenda opcional
  if (style.showLegend) {
    const legend = L.control({ position: "bottomright" });
    legend.onAdd = () => {
      const div = L.DomUtil.create("div", "legend");
      div.style.background = "white";
      div.style.padding = "8px 10px";
      div.style.borderRadius = "8px";
      div.style.boxShadow = "0 1px 4px rgba(0,0,0,.25)";
      div.style.font = "12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

      const entries = [];
      const steps = 5;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const c = colorFromScale(style.colorScale, t, style.invertScale);
        entries.push(`<span style="display:inline-block;width:12px;height:12px;background:${c};margin-right:6px;border:1px solid #0001"></span>${Math.round(t * 100)}%`);
      }

      div.innerHTML = `
        <div style="margin-bottom:6px;"><strong>Escala</strong> · ${style.colorScale}${style.invertScale ? " (invertida)" : ""}</div>
        <div style="display:grid;grid-template-columns:auto auto;gap:4px 12px;align-items:center;">
          ${entries.map(e => `<div>${e}</div>`).join("")}
        </div>
      `;
      return div;
    };
    legend.addTo(map);
  }
}

// Exposición global por compatibilidad con wrappers
if (typeof window !== "undefined") {
  window.drawVisualization = drawVisualization;
}
