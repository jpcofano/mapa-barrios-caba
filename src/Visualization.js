/* Visualization.js - Community Viz (Leaflet) - 2025-08-12
   Requisitos:
   - Leaflet cargado en el HTML (L global)
   - Este bundle en formato IIFE
*/

(function () {
  'use strict';

  // ====== Helpers de DOM/CSS básicos ======
  const ensureBaseStyles = () => {
    if (document.getElementById('viz-css-base')) return;
    const css = `
      html, body { height: 100%; margin: 0; }
      #viz-root { position: relative; width: 100%; height: 100%; }
      #viz-map  { position: absolute; inset: 0; }
      .legend {
        background: rgba(255,255,255,0.9);
        padding: 8px 10px;
        border-radius: 4px;
        font: 12px/1.3 system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
        box-shadow: 0 1px 3px rgba(0,0,0,0.2);
      }
      .legend .row { display:flex; align-items:center; gap:6px; margin:2px 0; }
      .legend .swatch { width:14px; height:14px; border:1px solid rgba(0,0,0,0.2); }
      .leaflet-tooltip { pointer-events: none; }
    `;
    const style = document.createElement('style');
    style.id = 'viz-css-base';
    style.textContent = css;
    document.head.appendChild(style);
  };

  const ensureRoot = () => {
    let root = document.getElementById('viz-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'viz-root';
      document.body.appendChild(root);
    }
    let mapDiv = document.getElementById('viz-map');
    if (!mapDiv) {
      mapDiv = document.createElement('div');
      mapDiv.id = 'viz-map';
      root.appendChild(mapDiv);
    }
    return mapDiv;
  };

  // ====== GEOJSON embebido (reemplazá por el tuyo) ======
  // Debe ser un FeatureCollection válido. Dejo un placeholder minimal.
  const GEOJSON = {
    "type": "FeatureCollection",
    "features": [] // <-- pegá acá tus features si querés testear sin fetch
  };

  // ====== Normalización, color y utilitarios de datos ======
  const stripDiacritics = (s) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '');
  const normalizeKeyFuzzy = (s) => {
    const raw = (s ?? '').toString().trim();
    const base = stripDiacritics(raw).toLowerCase();
    // devolvemos varias variantes (para mayor chance de match)
    const variants = new Set();
    variants.add(base);
    variants.add(base.replace(/\s+/g, ' '));
    variants.add(base.replace(/\s+/g, ''));
    variants.add(base.replace(/[^\p{L}\p{N}]+/gu, ''));
    return Array.from(variants);
  };

  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp01 = (t) => Math.max(0, Math.min(1, t));
  const toHex = (x) => {
    const h = Math.round(x).toString(16).padStart(2, '0');
    return h.length > 2 ? h.slice(0, 2) : h;
  };
  const rgb = (r, g, b) => `#${toHex(r)}${toHex(g)}${toHex(b)}`;

  // paletas simples cuando no viene COLOR_PALETTE
  const colorFromScale = (scaleName, t, invert) => {
    t = clamp01(t);
    if (invert) t = 1 - t;
    switch (scaleName) {
      case 'greenToRed': {
        // verde (0,170,0) -> rojo (204,0,0)
        const r = lerp(0, 204, t);
        const g = lerp(170, 0, t);
        const b = 0;
        return rgb(r, g, b);
      }
      case 'blueToYellow': {
        // azul (0,90,170) -> amarillo (240,200,0)
        const r = lerp(0, 240, t);
        const g = lerp(90, 200, t);
        const b = lerp(170, 0, t);
        return rgb(r, g, b);
      }
      case 'grayscale': {
        const g = lerp(240, 40, t);
        return rgb(g, g, g);
      }
      case 'yellow': {
        // escala monocroma amarilla
        const r = lerp(255, 130, t);
        const g = lerp(255, 130, t);
        const b = lerp(180, 20, t);
        return rgb(r, g, b);
      }
      default:
        // fallback a greenToRed
        const rr = lerp(0, 204, t);
        const gg = lerp(170, 0, t);
        return rgb(rr, gg, 0);
    }
  };

  // ====== Lectura de estilo (robusta a variaciones) ======
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
      geojsonUrl:      s?.geojsonUrl?.value ?? '',
      geojsonProperty: (s?.geojsonProperty?.value || '').toString().trim(),
      colorScale:      s?.colorScale?.value ?? 'greenToRed',
      invertScale:     !!s?.invertScale?.value,
      showLabels:      !!s?.showLabels?.value,
      showLegend:      (s?.showLegend?.value ?? true),
      legendPosition:  s?.legendPosition?.value ?? 'bottomright',
      borderColor:     s?.borderColor?.value?.color ?? '#000000',
      borderWidth:     Number(s?.borderWidth?.value ?? 1),
      borderOpacity:   Number(s?.borderOpacity?.value ?? 1),
      opacity:         Number(s?.opacity?.value ?? (s?.minMaxOpacity?.value ?? 0.45)),
      colorMissing:    s?.colorMissing?.value?.color ?? '#cccccc',
      popupFormat:     s?.popupFormat?.value ?? '<strong>{{nombre}}</strong><br/>Valor: {{valor}}',
      showBorders:     (s?.showBorders?.value ?? true),
      colorPalette:    getPalette(),
    };
  }

  // ====== Nombre por propiedad del GeoJSON o heurística barrio/comuna ======
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

  // ====== Construcción del mapa de valores (data -> Map normalizado) ======
  function buildValueMap(message) {
    // Fuentes posibles:
    //  - Esquema moderno: message.fieldsByConfigId.geoDimension / metricPrimary
    //  - Esquema legacy: message.fieldsByConfigId.mainData.elements
    //  - Tablas: message.tables.DEFAULT.{fields,rows}
    const fbc = message?.fieldsByConfigId || {};
    const modernDim = Array.isArray(fbc?.geoDimension) ? fbc.geoDimension[0] : null;
    const modernMet = Array.isArray(fbc?.metricPrimary) ? fbc.metricPrimary[0] : null;

    const legacyMain = fbc?.mainData?.elements || [];

    const table = message?.tables?.DEFAULT || {};
    const fieldIds = Array.isArray(table.fields) ? table.fields : [];
    const dataRows = Array.isArray(table.rows) ? table.rows
                    : (Array.isArray(table.data) ? table.data : []);

    // Detectar índices de dimensión / métrica
    let idxDim = -1, idxMet = -1;

    // A) Intento por esquema moderno usando nombre o id
    if (modernDim || modernMet) {
      const wantedDim = (modernDim?.name || modernDim?.id || '').toString().toLowerCase();
      const wantedMet = (modernMet?.name || modernMet?.id || '').toString().toLowerCase();
      fieldIds.forEach((f, i) => {
        const nm = (f?.name || f?.id || '').toString().toLowerCase();
        if (idxDim < 0 && wantedDim && nm === wantedDim) idxDim = i;
        if (idxMet < 0 && wantedMet && nm === wantedMet) idxMet = i;
      });
    }

    // B) Intento legacy: asumimos [dim, met]
    if ((idxDim < 0 || idxMet < 0) && legacyMain.length >= 2) {
      idxDim = (idxDim < 0) ? 0 : idxDim;
      idxMet = (idxMet < 0) ? 1 : idxMet;
    }

    // C) Heurística por nombre
    if ((idxDim < 0 || idxMet < 0) && Array.isArray(fieldIds)) {
      const dimIdx = fieldIds.findIndex(f => /barrio|comuna|nombre|texto|name/i.test(f?.name || f?.id || ''));
      const metIdx = fieldIds.findIndex(f => /valor|m(é|e)trica|metric|value|cantidad|total/i.test(f?.name || f?.id || ''));
      if (idxDim < 0 && dimIdx >= 0) idxDim = dimIdx;
      if (idxMet < 0 && metIdx >= 0) idxMet = metIdx;
    }

    const map = new Map();
    const values = [];

    if (idxDim < 0 || idxMet < 0 || !Array.isArray(dataRows) || dataRows.length === 0) {
      return { map, min: NaN, max: NaN, count: 0 };
    }

    for (const row of dataRows) {
      const d = row[idxDim];
      const m = row[idxMet];

      const key = (d?.v ?? d?.value ?? d ?? '').toString();
      const valRaw = (m?.v ?? m?.value ?? m);
      const val = Number(valRaw);

      if (key && Number.isFinite(val)) {
        // Generamos variantes normalizadas para mejorar el match con GeoJSON
        const keys = normalizeKeyFuzzy(key);
        for (const k of keys) map.set(k, val);
        values.push(val);
      }
    }

    const min = values.length ? Math.min(...values) : NaN;
    const max = values.length ? Math.max(...values) : NaN;
    return { map, min, max, count: values.length };
  }


  // ====== Factories para estilo y popups (sin depender de variables globales) ======
  const makeStyleFn = (style, stats, nivel) => (feature) => {
    const nombre = getFeatureNameProp(feature, nivel, style.geojsonProperty);
    const keys = normalizeKeyFuzzy(nombre);

    let v;
    if (stats?.map?.size) {
      for (const k of keys) { if (stats.map.has(k)) { v = stats.map.get(k); break; } }
    }

    let fillColor;
    if (stats?.map?.size && Number.isFinite(v)) {
      const denom = (stats.max - stats.min) || 1;
      const t = (v - stats.min) / denom;
      if (style.colorPalette?.colors?.length) {
        const n = style.colorPalette.colors.length;
        const idx = Math.max(0, Math.min(n - 1, Math.round(t * (n - 1))));
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

  const makeOnEach = (style, stats, nivel) => (feature, lyr) => {
    const nombre = getFeatureNameProp(feature, nivel, style.geojsonProperty) ?? '—';

    if (style.showLabels) {
      lyr.bindTooltip(String(nombre), { sticky: true, direction: 'center' });
    }

    let v;
    if (stats?.map?.size) {
      const keys = normalizeKeyFuzzy(nombre);
      for (const k of keys) if (stats.map.has(k)) { v = stats.map.get(k); break; }
    }

    const content = (style.popupFormat || '')
      .replace(/\{\{\s*nombre\s*\}\}/gi, String(nombre))
      .replace(/\{\{\s*valor\s*\}\}/gi, (v != null && Number.isFinite(v)) ? String(v) : 's/d');

    lyr.bindPopup(content, { closeButton: false });
  };

  // ====== Leyenda ======
  function buildLegend(map, style, stats) {
    if (!style.showLegend) return;

    const ctrl = L.control({ position: style.legendPosition || 'bottomright' });
    ctrl.onAdd = function () {
      const div = L.DomUtil.create('div', 'legend');
      if (!stats || !Number.isFinite(stats.min) || !Number.isFinite(stats.max) || stats.count === 0) {
        div.textContent = 'Sin datos';
        return div;
      }

      const breaks = 5;
      const rows = [];
      for (let i = 0; i < breaks; i++) {
        const a = stats.min + (stats.max - stats.min) * (i / breaks);
        const b = stats.min + (stats.max - stats.min) * ((i + 1) / breaks);
        const mid = (a + b) / 2;
        const t = (mid - stats.min) / ((stats.max - stats.min) || 1);

        let col;
        if (style.colorPalette?.colors?.length) {
          const n = style.colorPalette.colors.length;
          const idx = Math.max(0, Math.min(n - 1, Math.round(t * (n - 1))));
          col = style.colorPalette.colors[idx];
        } else {
          col = colorFromScale(style.colorScale, t, style.invertScale);
        }
        rows.push({ col, a, b });
      }

      // Render
      rows.forEach(({ col, a, b }) => {
        const row = document.createElement('div');
        row.className = 'row';
        const sw = document.createElement('span');
        sw.className = 'swatch';
        sw.style.background = col;
        const label = document.createElement('span');
        label.textContent = `${fmt(a)} – ${fmt(b)}`;
        row.appendChild(sw);
        row.appendChild(label);
        div.appendChild(row);
      });
      return div;
    };
    ctrl.addTo(map);
    return ctrl;
  }

  const fmt = (n) => {
    if (!Number.isFinite(n)) return 's/d';
    // formato corto sin locales (evita Intl en IIFE antiguas)
    const abs = Math.abs(n);
    if (abs >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    if (abs >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (abs >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return (Math.round(n * 100) / 100).toString();
  };

  // ====== Carga de GeoJSON (opcional URL con CORS; aquí usamos embebido) ======
  async function getGeoJSON(style) {
    // Si querés usar URL, activá esto y resolvé CORS en GCS
    if (style.geojsonUrl && /^https?:\/\//i.test(style.geojsonUrl)) {
      try {
        const resp = await fetch(style.geojsonUrl, { mode: 'cors' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const j = await resp.json();
        if (j?.type === 'FeatureCollection') return j;
      } catch (e) {
        console.warn('[Viz] No se pudo cargar geojsonUrl, uso embebido:', e);
      }
    }
    return GEOJSON; // fallback embebido
  }

  // ====== Estado del mapa para evitar recrear en cada tick ======
  let _leaflet = {
    map: null,
    layer: null,
    legend: null,
    lastBoundsFit: false,
  };

  // ====== Render principal ======
  async function drawVisualization(message) {
    ensureBaseStyles();
    const mapDiv = ensureRoot();

    const style = readStyle(message);
    const nivel = style.nivelJerarquia || 'barrio';
    const stats = buildValueMap(message);

    // crear o reutilizar mapa
    if (!_leaflet.map) {
      _leaflet.map = L.map(mapDiv, { zoomControl: true, attributionControl: true });
      // fondo soft (Carto light / OSM): si tenés CSP estricto, usá el tuyo
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap'
      }).addTo(_leaflet.map);
    }

    // quitar capa previa
    if (_leaflet.layer) {
      _leaflet.layer.remove();
      _leaflet.layer = null;
    }
    if (_leaflet.legend) {
      _leaflet.legend.remove();
      _leaflet.legend = null;
    }

    const geojson = await getGeoJSON(style);

    _leaflet.layer = L.geoJSON(geojson, {
      style: makeStyleFn(style, stats, nivel),
      onEachFeature: makeOnEach(style, stats, nivel)
    }).addTo(_leaflet.map);

    // ajustar vista solo una vez (o si no hay bounds previos válidos)
    if (!_leaflet.lastBoundsFit) {
      try {
        const b = _leaflet.layer.getBounds();
        if (b && b.isValid && b.isValid()) {
          _leaflet.map.fitBounds(b, { padding: [20, 20] });
          _leaflet.lastBoundsFit = true;
        }
      } catch (e) {
        // ignore
      }
    }

    _leaflet.legend = buildLegend(_leaflet.map, style, stats);
  }

  // ====== Suscripción a datos (Community Viz) ======
  // Si no existe dscc (modo local), hacemos un mock mínimo
  const dscc = (window.dscc || window.google?.dataStudio?.Component?.viz || null);

  if (dscc && typeof dscc.subscribeToData === 'function') {
    dscc.subscribeToData(drawVisualization, { transform: dscc.tableTransform });
  } else {
    // Modo fallback: dibuja una vez con mensaje vacío (para pruebas locales)
    console.warn('[Viz] dscc no está disponible; render local de prueba.');
    drawVisualization({});
  }

})();
