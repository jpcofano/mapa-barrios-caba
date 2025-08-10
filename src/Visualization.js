import L from 'leaflet';

// Default export used by Looker Studio to render the map
export default function drawVisualization(container) {
  // Limpia el contenedor si re-renderiza
  container.innerHTML = '';
  container.style.width = '100%';
  container.style.height = '100%';

  // Inicializa mapa en CABA
  const map = L.map(container).setView([-34.61, -58.38], 12);

  // Capa base OSM
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  // Carga GeoJSON desde GCS (público)
  const GEOJSON_URL = 'https://storage.googleapis.com/mapa-barrios-degcba/barrioscaba.geojson';

  fetch(GEOJSON_URL, { cache: 'no-store' })
    .then(r => {
      if (!r.ok) throw new Error(`GeoJSON HTTP ${r.status}`);
      return r.json();
    })
    .then(data => {
      L.geoJSON(data, {
        style: () => ({
          color: '#555',
          weight: 1,
          fillColor: '#3388ff',
          fillOpacity: 0.4
        })
      }).addTo(map);
    })
    .catch(err => {
      console.error('Error cargando GeoJSON:', err);
    });
}

// Exposición global por compatibilidad
if (typeof window !== 'undefined') {
  window.drawVisualization = drawVisualization;
}
