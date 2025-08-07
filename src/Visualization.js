
import L from 'leaflet';
import leafletCss from 'leaflet/dist/leaflet.css';

// Ensure Leaflet CSS is injected once
(function injectLeafletCss() {
  const id = 'leaflet-core-css';
  if (!document.getElementById(id)) {
    const style = document.createElement('style');
    style.id = id;
    style.textContent = leafletCss;
    document.head.appendChild(style);
  }
})();

const dscc = window.dscc;

// Keep map references to avoid full re-init glitches, but rebuild cleanly when needed
let mapInstance = null;
let geojsonLayer = null;
let legendControl = null;

/**
 * Inject legend CSS once
 */
const addLegendCss = () => {
  const styleId = 'leaflet-legend-style';
  if (document.getElementById(styleId)) return;
  const styleElement = document.createElement('style');
  styleElement.id = styleId;
  styleElement.innerHTML = `
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
  document.head.appendChild(styleElement);
};

/**
 * Quintile breaks for choropleth
 */
const getQuintileBreaks = (dataArray) => {
  const sorted = dataArray
    .map(Number)
    .filter((d) => Number.isFinite(d))
    .sort((a, b) => a - b);
  if (sorted.length < 5) return [0, 1, 2, 3];
  const pct = [0.2, 0.4, 0.6, 0.8];
  return pct.map((p) => {
    const pos = (sorted.length - 1) * p;
    const base = Math.floor(pos);
    const rest = pos - base;
    const next = sorted[base + 1];
    return Math.round(next !== undefined ? sorted[base] + rest * (next - sorted[base]) : sorted[base]);
  });
};

/**
 * Main draw
 */
const drawViz = (data) => {
  const fields = data.fields;
  const style = data.style;
  const tableData = data.tables.DEFAULT || [];

  const barrioIndex = fields.findIndex((f) => f.id === 'barrio');
  const valueIndex = fields.findIndex((f) => f.id === 'valor');

  // Reset container
  const container = document.body;
  container.innerHTML = '';
  const mapContainer = document.createElement('div');
  mapContainer.style.width = '100%';
  mapContainer.style.height = '100%';
  container.appendChild(mapContainer);

  // Fresh map each render to avoid detaching/reattaching DOM issues
  if (mapInstance) {
    try { mapInstance.remove(); } catch (e) {}
    mapInstance = null;
  }
  mapInstance = L.map(mapContainer).setView([-34.61, -58.38], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(mapInstance);

  // Data mapping
  const dataMap = {};
  const allValues = [];
  tableData.forEach((row) => {
    const barrioName = row[barrioIndex];
    const value = parseFloat(row[valueIndex]) || 0;
    dataMap[barrioName] = value;
    allValues.push(value);
  });
  const quintileBreaks = getQuintileBreaks(allValues);

  const colorPalettes = {
    yellow: ["#ffffcc", "#fed976", "#fd8d3c", "#e31a1c", "#800026"],
    greenToRed: ["#2c7bb6", "#abd9e9", "#ffffbf", "#fdae61", "#d7191c"],
    blueToYellow: ["#d0d1e6", "#a6bddb", "#67a9cf", "#1c9099", "#016c59"],
    grayscale: ["#f7f7f7", "#cccccc", "#969696", "#636363", "#252525"]
  };
  const selectedPalette = colorPalettes[style?.colorScale?.value] || colorPalettes.yellow;

  const getColor = (value) => {
    if (value <= quintileBreaks[0]) return selectedPalette[0];
    if (value <= quintileBreaks[1]) return selectedPalette[1];
    if (value <= quintileBreaks[2]) return selectedPalette[2];
    if (value <= quintileBreaks[3]) return selectedPalette[3];
    return selectedPalette[4];
  };

  fetch("https://storage.googleapis.com/mapa-barrios-degcba/barrioscaba.geojson")
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((geojsonData) => {
      if (geojsonLayer) {
        try { mapInstance.removeLayer(geojsonLayer); } catch (e) {}
      }

      geojsonLayer = L.geoJSON(geojsonData, {
        style: (feature) => {
          const barrioName = feature.properties?.nombre;
          const value = dataMap[barrioName] || 0;
          return {
            color: style?.borderColor?.value?.color || '#000',
            weight: parseFloat(style?.borderWidth?.value ?? 1),
            fillColor: getColor(value),
            fillOpacity: 0.7
          };
        },
        onEachFeature: (feature, layer) => {
          if (style?.showLabels?.value) {
            const barrioName = feature.properties?.nombre;
            const value = dataMap[barrioName] || 0;
            layer.bindTooltip(`${barrioName}: ${value.toLocaleString()}`);
          }
        }
      }).addTo(mapInstance);

      // Legend
      if (legendControl) {
        try { mapInstance.removeControl(legendControl); } catch (e) {}
        legendControl = null;
      }

      if (style?.showLegend?.value) {
        addLegendCss();
        legendControl = L.control({ position: 'bottomright' });
        legendControl.onAdd = function () {
          const div = L.DomUtil.create('div', 'info legend');
          const grades = [0, ...quintileBreaks];
          const fmt = (n) => Number(n).toLocaleString();

          div.innerHTML += `<i style="background:${getColor(grades[0])}"></i> ≤ ${fmt(grades[1])}<br>`;
          for (let i = 1; i < grades.length - 1; i++) {
            div.innerHTML += `<i style="background:${getColor(grades[i] + 1)}"></i> ${fmt(grades[i] + 1)}–${fmt(grades[i + 1])}<br>`;
          }
          div.innerHTML += `<i style="background:${getColor(grades[grades.length - 1] + 1)}"></i> > ${fmt(grades[grades.length - 1])}`;
          return div;
        };
        legendControl.addTo(mapInstance);
      }
    })
    .catch((error) => {
      console.error('Error GeoJSON:', error);
      container.innerHTML = `<div style="padding: 20px; text-align: center; color: red;">Error: No se pudo cargar el mapa de barrios. <br/>${error.message}</div>`;
    });
};

// Subscribe
dscc.subscribeToData(drawViz, { transform: dscc.objectTransform });
