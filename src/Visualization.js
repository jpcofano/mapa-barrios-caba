import L from 'leaflet';

// Helpers para leer estilos desde Looker Studio según tu Config.json
function readStyle(message = {}) {
  const s = message?.styleById ?? {};
  return {
    colorScale: s?.colorScale?.value ?? 'greenToRed',
    invertScale: !!s?.invertScale?.value,
    showLabels: !!s?.showLabels?.value,
    showLegend: s?.showLegend?.value ?? true,
    borderColor: s?.borderColor?.value?.color ?? '#000000',
    borderWidth: Number(s?.borderWidth?.value ?? 1),
  };
}

// Color base simple por escala (puedes refinarlo a gradientes luego)
function pickFillColor(scale, invert) {
  const base = {
    yellow: '#FFC107',
    greenToRed: invert ? '#E53935' : '#43A047',
    blueToYellow: invert ? '#FFC107' : '#1E88E5',
    grayscale: '#9E9E9E',
  };
  return base[scale] ?? '#3388ff';
}

// Default export usado por Looker Studio para renderizar
// AHORA acepta el 'message' opcional del runtime
export default function drawVisualization(container, message = {}) {
  // Limpia contenedor
  container.innerHTML = '';
  container.style.width = '100%';
  container.style.height = '100%';

  // Lee estilos desde Looker Studio (no existe 'hierarchy' acá)
  const style = readStyle(message);

  // Inicializa mapa en CABA
  const map = L.map(container).setView([-34.61, -58.38], 12);

  // Capa base OSM
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  // Carga GeoJSON
  const GEOJSON_URL = 'https://storage.googleapis.com/mapa-barrios-degcba/barrioscaba.geojson';

  fetch(GEOJSON_URL, { cache: 'no-store' })
    .then(r => {
      if (!r.ok) throw new Error(`GeoJSON HTTP ${r.status}`);
      return r.json();
    })
    .then(data => {
      const fill = pickFillColor(style.colorScale, style.invertScale);

      const layer = L.geoJSON(data, {
        style: () => ({
          color: style.borderColor,
          weight: style.borderWidth,
          fillColor: fill,
          fillOpacity: 0.4
        }),
        onEachFeature: (feature, lyr) => {
          // Etiquetas opcionales
          if (style.showLabels) {
            const name = feature?.properties?.BARRIO ?? '—';
            lyr.bindTooltip(name, { permanent: false, direction: 'center' });
          }
        }
      }).addTo(map);

      // Leyenda opcional (placeholder)
      if (style.showLegend) {
        const legend = L.control({ position: 'bottomright' });
        legend.onAdd = () => {
          const div = L.DomUtil.create('div', 'legend');
          div.style.background = 'white';
          div.style.padding = '6px 10px';
          div.style.borderRadius = '6px';
          div.style.boxShadow = '0 1px 4px rgba(0,0,0,.2)';
          div.innerHTML = `<strong>Escala</strong><br>${style.colorScale}${style.invertScale ? ' (invertida)' : ''}`;
          return div;
        };
        legend.addTo(map);
      }
    })
    .catch(err => {
      console.error('Error cargando GeoJSON:', err);
    });
}

// Exposición global por compatibilidad con wrappers
if (typeof window !== 'undefined') {
  window.drawVisualization = drawVisualization;
}
