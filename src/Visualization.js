// src/Visualization.js
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const dscc = window.dscc;

// Mantener refs globales
let mapInstance = null;
let geojsonLayer = null;
let legendControl = null;
let geojsonCache = null;

// CSS de leyenda (inyectado una sola vez)
(function addLegendCssOnce() {
  const id = 'leaflet-legend-style';
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = `
    .info.legend {
      padding: 6px 8px;
      font: 14px/16px Arial, Helvetica, sans-serif;
      background: rgba(255,255,255,0.85);
      box-shadow: 0 0 15px rgba(0,0,0,0.2);
      border-radius: 5px;
      line-height: 18px;
      color: #555;
    }
    .legend i {
      width: 18px;
      height: 18px;
      float: left;
      margin-right: 8px;
      opacity: 0.8;
    }
  `;
  document.head.appendChild(style);
})();

// Normaliza nombres de barrio
const norm = (s) =>
  (s || '')
    .toString()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();

// Quintiles (fallback a intervalos iguales si hay pocos datos)
const getQuantileBreaks = (arr, parts = 5) => {
  const values = arr.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!values.length) return null;
  if (values.length < parts) {
    const min = values[0], max = values[values.length - 1];
    const step = (max - min) / (parts - 1 || 1);
    return [min + step, min + 2 * step, min + 3 * step, min + 4 * step].slice(0, 4);
  }
  const pct = [0.2, 0.4, 0.6, 0.8];
  return pct.map((p) => {
    const pos = (values.length - 1) * p;
    const base = Math.floor(pos);
    const rest = pos - base;
    const next = values[base + 1];
    return next !== undefined ? values[base] + rest * (next - values[base]) : values[base];
  });
};

const drawViz = (data) => {
  const fields = data.fields;
  const style = data.style;
  const tableData = data.tables.DEFAULT || [];

  const barrioIndex = fields.findIndex((f) => f.id === 'barrio');
  const valueIndex = fields.findIndex((f) => f.id === 'valor');

  if (barrioIndex < 0 || valueIndex < 0) {
    const c = document.getElementById('root') || document.body;
    c.innerHTML = '<div style="padding:12px;color:#b00">Faltan campos "Barrio" y/o "Valor" en la configuración.</div>';
    return;
  }

  // Contenedor
  const container = document.getElementById('root') || document.body;
  container.innerHTML = '';
  const mapContainer = document.createElement('div');
  mapContainer.style.width = '100%';
  mapContainer.style.height = '100%';
  container.appendChild(mapContainer);

  // Nuevo mapa por render
  if (mapInstance) { try { mapInstance.remove(); } catch (e) {} }
  mapInstance = L.map(mapContainer).setView([-34.61, -58.38], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(mapInstance);

  // Mapear datos
  const dataMap = Object.create(null);
  const allValues = [];
  tableData.forEach((row) => {
    const key = norm(row[barrioIndex]);
    const val = Number(row[valueIndex]);
    if (Number.isFinite(val)) {
      dataMap[key] = val;
      allValues.push(val);
    }
  });

  const hasData = allValues.some(Number.isFinite);
  const quintileBreaks = hasData ? getQuantileBreaks(allValues, 5) : null;

  // Paletas & estilo
  const colorPalettes = {
    yellow: ["#ffffcc", "#fed976", "#fd8d3c", "#e31a1c", "#800026"],
    greenToRed: ["#2c7bb6", "#abd9e9", "#ffffbf", "#fdae61", "#d7191c"],
    blueToYellow: ["#d0d1e6", "#a6bddb", "#67a9cf", "#1c9099", "#016c59"],
    grayscale: ["#f7f7f7", "#cccccc", "#969696", "#636363", "#252525"]
  };
  const base = colorPalettes[style?.colorScale?.value] || colorPalettes.yellow;
  const selectedPalette = (style?.invertScale?.value ? [...base].reverse() : base);
  const neutral = '#cfd4da';

  const getColor = (v) => {
    if (!Number.isFinite(v) || !hasData || !quintileBreaks) return neutral;
    if (v <= quintileBreaks[0]) return selectedPalette[0];
    if (v <= quintileBreaks[1]) return selectedPalette[1];
    if (v <= quintileBreaks[2]) return selectedPalette[2];
    if (v <= quintileBreaks[3]) return selectedPalette[3];
    return selectedPalette[4];
  };

  const renderGeojson = (geojsonData) => {
    if (geojsonLayer) { try { mapInstance.removeLayer(geojsonLayer); } catch (e) {} }

    const border =
      (style?.borderColor?.value && style.borderColor.value.color) || '#000000';

    geojsonLayer = L.geoJSON(geojsonData, {
      renderer: L.canvas(),
      style: (feature) => {
        const barrioName = feature.properties?.nombre;
        const value = dataMap[norm(barrioName)];
        return {
          color: border,
          weight: parseFloat(style?.borderWidth?.value ?? 1),
          fillColor: getColor(value),
          fillOpacity: 0.7
        };
      },
      onEachFeature: (feature, layer) => {
        if (style?.showLabels?.value) {
          const barrioName = feature.properties?.nombre;
          const value = dataMap[norm(barrioName)];
          const formatted = Number.isFinite(value)
            ? value.toLocaleString('es-AR', { maximumFractionDigits: 2 })
            : 'Sin datos';
          layer.bindTooltip(`${barrioName}: ${formatted}`, { direction: 'auto' });
        }
      }
    }).addTo(mapInstance);

    // Enmarcar al GeoJSON
    try {
      const b = geojsonLayer.getBounds();
      if (b && b.isValid()) mapInstance.fitBounds(b, { padding: [10, 10] });
    } catch {}

    // Leyenda (respeta showLegend)
    if (legendControl) { try { mapInstance.removeControl(legendControl); } catch {} }
    legendControl = null;

    if (style?.showLegend?.value !== false) {
      legendControl = L.control({ position: 'bottomright' });
      legendControl.onAdd = function () {
        const div = L.DomUtil.create('div', 'info legend');
        const fmt = (n) => Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 });

        if (!hasData || !quintileBreaks) {
          div.innerHTML = `<div><i style="background:${neutral}"></i> Sin datos</div>`;
          return div;
        }

        const grades = [Number.NEGATIVE_INFINITY, ...quintileBreaks, Number.POSITIVE_INFINITY];
        for (let i = 0; i < grades.length - 1; i++) {
          const from = grades[i];
          const to = grades[i + 1];
          const swatchVal = i === 0 ? quintileBreaks[0] : (from + to) / 2;
          const label =
            (isFinite(from) ? `${fmt(from)} ` : '') +
            (i === 0 ? '≤' : '–') +
            ` ${isFinite(to) ? fmt(to) : 'máx'}`;
          div.innerHTML += `
            <div>
              <i style="background:${getColor(swatchVal)}"></i>
              ${label}
            </div>`;
        }
        return div;
      };
      legendControl.addTo(mapInstance);
    }
  };

  const handleError = (error) => {
    const c = document.getElementById('root') || document.body;
    c.innerHTML = `<div style="padding: 20px; text-align: center; color: red;">
      Error: No se pudo cargar el mapa de barrios.<br/>${error.message}
      <br/><small>Revisá URL pública y permisos del bucket.</small></div>`;
    // eslint-disable-next-line no-console
    console.error('Error GeoJSON:', error);
  };

  if (geojsonCache) {
    renderGeojson(geojsonCache);
  } else {
    fetch("https://storage.googleapis.com/mapa-barrios-degcba/barrioscaba.geojson")
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((gj) => { geojsonCache = gj; renderGeojson(gj); })
      .catch(handleError);
  }
};

// Suscripción
dscc.subscribeToData(drawViz, { transform: dscc.objectTransform });
