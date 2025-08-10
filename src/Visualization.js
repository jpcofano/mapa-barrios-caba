import L from 'leaflet';

// Default export used by Looker Studio to render the map
export default function drawVisualization(container) {
  // Initialize map centered on Buenos Aires
  const map = L.map(container).setView([-34.61, -58.38], 12);

  // Basic OpenStreetMap tile layer
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  // Load GeoJSON with city neighborhoods
  fetch('https://storage.googleapis.com/mapa-barrios-caba/barrioscaba.geojson')
    .then(response => response.json())
    .then(data => {
      L.geoJSON(data, {
        style: () => ({
          color: '#555',
          weight: 1,
          fillColor: '#3388ff',
          fillOpacity: 0.4
        })
      }).addTo(map);
    });
}

// Expose function globally for environments without modules
if (typeof window !== 'undefined') {
  window.drawVisualization = drawVisualization;
}
