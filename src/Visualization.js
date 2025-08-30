/* global L, GEOJSON, GEOJSON_COMUNAS */
/* ============================================================================
 * Visualización coroplética Looker Studio – Barrios/Comunas
 * - Escalas/paletas (invertibles) y bordes con "auto" (contraste)
 * - Nivel por parámetro (param_nivel) → estilo → heurística
 * - Tooltip/Popup helpers: {{col:...}}, {{csv:colN,idx}}, {{csvn:colN,idx}},
 *   {{tasaCsv:colN,iNum,iDen,factor}}, {{tasa:numCol,denCol,factor}},
 *   {{sum:col}}, {{avg:col}}, {{min:col}}, {{max:col}}, {{count}},
 *   {{rank}}, {{percentil}}
 * - Leyenda consistente con el mapa + "Sin datos"
 * - Branding (logo data: URL) con tamaño/posición/opacidad
 * - Probe/Debug activable con ?debug=1 o window.__DEBUG_VIZ = true
 * ==========================================================================*/

(function(){
  'use strict';

  /* ---------------------------- Debug / Probe ---------------------------- */
  const DEBUG = /[?&]debug=1\b/.test(location.search) || !!window.__DEBUG_VIZ;

  function _flatStyle(s) {
    const out = {};
    for (const [k, v] of Object.entries(s || {})) {
      if (v && typeof v === 'object' && 'value' in v) {
        const vv = v.value;
        out[k] = (vv && typeof vv === 'object' && 'color' in vv) ? vv.color : vv;
      } else out[k] = v;
    }
    return out;
  }

  function probeMessage(message, extra = {}) {
    if (!DEBUG) return;
    console.group('[Probe] objectTransform');
    try {
      const T = message?.tables?.DEFAULT;
      console.log('headers?', Array.isArray(T?.headers), T?.headers);
      console.log('rows len:', Array.isArray(T?.rows) ? T.rows.length : 0);
      console.log('fieldsByConfigId:', message?.fieldsByConfigId);
      console.log('style keys:', Object.keys(message?.styleById || message?.style || {}));
      console.table(_flatStyle(message?.styleById || message?.style || {}));
      if (extra) console.log('extra:', extra);
      window.__dsccLast = message;
    } finally { console.groupEnd(); }
  }

  let __tapOnce = false;
  function tapTableTransform(dscc) {
    if (!DEBUG || __tapOnce || !dscc?.tableTransform) return;
    __tapOnce = true;
    dscc.subscribeToData((t) => {
      console.group('[tap.tableTransform]');
      try {
        const T = t?.tables?.DEFAULT;
        console.log('tables keys:', Object.keys(t?.tables || {}));
        console.log('rows len:', Array.isArray(T) ? T.length : '(no array)');
        if (Array.isArray(T)) console.log('sample row 0:', T[0]);
      } finally { console.groupEnd(); }
    }, { transform: dscc.tableTransform });
  }

  /* ---------------------------- Paletas --------------------------------- */
  const PRESET_PALETTES = {
    viridis: [
      '#440154', '#482878', '#3e4989', '#31688e', '#26828e',
      '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725'
    ],
    magma:   ['#000004','#1b0c41','#4f0a6d','#7c1d6f','#a52c60','#cf4446','#ed6925','#fb9b06','#f7d13d','#fcfdbf'],
    plasma:  ['#0d0887','#5b02a3','#9a179b','#cb4679','#ed7953','#fb9f3a','#fdca26','#f0f921'],
    cividis: ['#00224e','#233b67','#3f5a78','#5a7b89','#7a9c98','#9fbc9f','#c9dca0','#f2f4b3'],
    turbo:   ['#23171b','#3b0f70','#6a00a8','#9c179e','#bd3786','#d8576b','#ed7953','#fb9f3a','#fdca26','#f0f921'],
    Spectral:['#9e0142','#d53e4f','#f46d43','#fdae61','#fee08b','#e6f598','#abdda4','#66c2a5','#3288bd','#5e4fa2'],
    soloAmarillo: ['#fffde7','#fff9c4','#fff176','#ffee58','#ffeb3b','#fdd835','#fbc02d','#f9a825','#f57f17','#fbc02d'],
    coolToYellow: ['#0d47a1','#1565c0','#1976d2','#1e88e5','#42a5f5','#64b5f6','#90caf9','#bbdefb','#fbe278','#ffd54f'],
    baWarm: ['#f3c300','#f6d24b','#f8dd74','#fae69a','#fbefbd','#fcf6da','#fbf9e8','#fffdf4','#fffef9','#ffffff'],
    baCool: ['#4e79a7','#6b93be','#86abd0','#a3c1df','#bed4ea','#d6e5f2','#e9f1f8','#f4f8fb','#fafcfe','#ffffff']
  };

  /* ----------------------------- Utils ---------------------------------- */
  const __leafletState = { map: null, layer: null, legend: null, logo: null };

  function clamp01(x){ return Math.max(0, Math.min(1, Number(x))); }
  function lerp(a,b,t){ return a + (b-a)*t; }
  function luminance(hex){
    try{
      const c = String(hex||'#ccc').replace('#','');
      const r = parseInt(c.substring(0,2),16)/255;
      const g = parseInt(c.substring(2,4),16)/255;
      const b = parseInt(c.substring(4,6),16)/255;
      const f = (u)=> u <= 0.03928 ? u/12.92 : Math.pow((u+0.055)/1.055,2.4);
      return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b);
    }catch(e){ return 0.5; }
  }
  function autoBorderFor(fill){ return luminance(fill) > 0.6 ? '#222' : '#fff'; }
  function toNumberLoose(x){
    if (x == null) return NaN;
    const s = String(x).replace(/\s+/g,'').replace(/\./g,'').replace(',', '.'); // 1.234,56 → 1234.56
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }
  function fmtInt(n){ return Number.isFinite(n) ? Math.round(n).toLocaleString('es-AR') : 's/d'; }

  /* ------------------------ Lectura de estilo ---------------------------- */
  function readStyle(msg){
    const s = (msg?.styleById || msg?.style || {});
    const pick = (id, def) => {
      const v = s[id];
      if (v && typeof v === 'object' && 'value' in v) return v.value;
      return (v != null) ? v : def;
    };
    const out = {
      nivelJerarquia: pick('nivelJerarquia', 'barrio'),
      geojsonProperty: pick('geojsonProperty',''),

      palettePreset: pick('palettePreset','viridis'),
      invertScale: !!pick('invertScale', false),
      colorMissing: pick('noDataColor', '#d9d9d9'),
      fillOpacity: Number(pick('opacity', 0.75)),

      showBorders: !!pick('showBorders', true),
      borderColor: pick('borderColor','auto'),
      borderWidth: Number(pick('borderWidth',1)),
      borderOpacity: Number(pick('borderOpacity',0.7)),

      showLegend: !!pick('showLegend', true),
      legendPosition: pick('legendPosition','bottomright'),
      legendBreaks: Number(pick('legendBreaks', 5)),       // ← NUEVO
      legendNoDecimals: !!pick('legendNoDecimals', true),
      legendNoDataText: pick('legendNoDataText', 'Sin datos'),

      showLabels: !!pick('showLabels', true),
      tooltipFormat: pick('tooltipFormat', '<strong>{{nombre}}</strong><br/>Valor: {{valor}}'),
      popupFormat: pick('popupFormat', '<strong>{{nombre}}</strong><br/>Valor: {{valor}}'),

      categoryMode: !!pick('categoryMode', false),
      cat1Value: toNumberLoose(pick('cat1Value',1)),
      cat1Color: pick('cat1Color','#f3c300'),
      cat1Label: pick('cat1Label','Categoría 1'),
      cat2Value: toNumberLoose(pick('cat2Value',2)),
      cat2Color: pick('cat2Color','#4e79a7'),
      cat2Label: pick('cat2Label','Categoría 2'),
      cat3Value: toNumberLoose(pick('cat3Value',3)),
      cat3Color: pick('cat3Color','#59a14f'),
      cat3Label: pick('cat3Label','Categoría 3'),
      categoryOtherColor: pick('categoryOtherColor','#cccccc'),

      logoEnabled: !!pick('logoEnabled', false),
      logoDataUrl: pick('logoDataUrl',''),
      logoWidthPx: Number(pick('logoWidthPx',128)),
      logoOpacity: Number(pick('logoOpacity',1)),
      logoPosition: pick('logoPosition','bottomright')
    };
    try{ window.__lastStyle = out; }catch(e){}
    return out;
  }

  /* --------------- Índices DIM/MET: ignorar param_nivel ----------------- */
  function resolveIndices(message){
    const H = message?.tables?.DEFAULT?.headers || [];
    let dim = -1, metric = -1;

    for (let i = 0; i < H.length; i++){
      const h  = H[i] || {};
      const nm = (h.name || '').toString().toLowerCase();
      const id = (h.id   || '').toString().toLowerCase();

      const isParamNivel = id.includes('param_nivel') || nm.includes('param_nivel');
      if (isParamNivel) continue;

      if (dim === -1 && (h.type === 'DIMENSION' || /barrio|comuna|nombre/.test(nm))) dim = i;
      if (metric === -1 && (h.type === 'METRIC'    || /asistent|total|valor|métric|metric/.test(nm))) metric = i;

      if (id.includes('geodimension')) dim = i;
      if (id.includes('metricprimary')) metric = i;
    }

    if (dim === -1) dim = 0;
    if (metric === -1 && H.length > 1) metric = 1;

    if (DEBUG) console.log('[resolveIndices] dim:', dim, 'metric:', metric, 'headers:', H);
    return { dim, metric, headers: H };
  }

  /* -------------------- Feature keys / nombres --------------------------- */
  function canonicalKey(str){
    return String(str||'')
      .normalize('NFKD')
      .replace(/[’'`´]/g,'')
      .replace(/\s+/g,' ')
      .trim()
      .toLowerCase();
  }
  function getFeatureKey(f, nivel, overrideProp=''){
    const props = f?.properties || {};
    if (overrideProp && props[overrideProp] != null) return canonicalKey(props[overrideProp]);
    if (nivel === 'comuna'){
      return canonicalKey(props.comuna || props.Comuna || props.NOMBRE || props.nombre || props.NAME || props.name);
    }
    return canonicalKey(props.barrio || props.Barrio || props.NOMBRE || props.nombre || props.NAME || props.name);
  }
  function getFeatureNameProp(f, nivel, overrideProp=''){
    const props = f?.properties || {};
    if (overrideProp && props[overrideProp] != null) return String(props[overrideProp]);
    if (nivel === 'comuna'){
      return String(props.comuna || props.Comuna || props.NOMBRE || props.nombre || props.NAME || props.name || '—');
    }
    return String(props.barrio || props.Barrio || props.NOMBRE || props.nombre || props.NAME || props.name || '—');
  }

  /* ----------------------------- Datos ---------------------------------- */
function buildValueMap(message, dimIdx, metIdx){
  const H = message?.tables?.DEFAULT?.headers || [];
  const R = message?.tables?.DEFAULT?.rows || [];
  const sums = new Map();

  for (const row of R){
    const key = canonicalKey(row[dimIdx]);
    const v = toNumberLoose(row[metIdx]);
    if (Number.isFinite(v)){
      sums.set(key, (sums.get(key) || 0) + v);
    }
  }

  let min = +Infinity, max = -Infinity, count = 0;
  for (const total of sums.values()){
    if (Number.isFinite(total)){
      min = Math.min(min, total);
      max = Math.max(max, total);
      count++;
    }
  }
  if (!count){ min = NaN; max = NaN; }

  return { map: sums, min, max, count, headers: H };
}


function buildRowLookup(message, dimIdx){
  const R = message?.tables?.DEFAULT?.rows || [];
  const H = message?.tables?.DEFAULT?.headers || [];
  const map = new Map();
  for (const row of R){
    const name = String(row[dimIdx] ?? '');
    const canon = canonicalKey(name);
    const byName = {}, byId = {};
    for (let i=0;i<H.length;i++){
      const id = String(H[i]?.id ?? `col${i+1}`);
      const nm = String(H[i]?.name ?? id);
      byId[id] = row[i];
      byName[nm] = row[i];
      byName[`col${i+1}`] = row[i];
    }
    const payload = { __raw: row, byName, byId };
    map.set(name, payload);
    map.set(canon, payload); // 🔸 también por clave canónica
  }
  return map;
}


  /* ------------------------- Ranking (1 = mayor) ------------------------- */
  function makeRankCtx(values, { highIsOne = true } = {}){
    const vec = values.filter(Number.isFinite).slice().sort((a,b)=>a-b); // asc
    const N = vec.length;
    const rankOf = (v)=>{
      if (!Number.isFinite(v) || !N) return NaN;
      let idx = vec.findIndex(x => x >= v);
      if (idx === -1) idx = N-1;
      return highIsOne ? (N - idx) : (idx + 1);
    };
    const percentileOf = (v)=>{
      if (!Number.isFinite(v) || !N) return NaN;
      let idx = vec.findIndex(x => x >= v);
      if (idx === -1) idx = N-1;
      return Math.round(((idx+1)/N)*100);
    };
    return { N, rankOf, percentileOf };
  }

  /* -------------------- Color continuo según paleta ---------------------- */
  function getColorFromScaleOrPalette(t, style){
    const arr = PRESET_PALETTES[style.palettePreset] || PRESET_PALETTES.viridis;
    const tt = clamp01(style.invertScale ? 1 - t : t);
    const n = arr.length;
    if (n <= 1) return arr[0] || '#cccccc';
    const idx = tt*(n-1);
    const i0 = Math.floor(idx);
    const i1 = Math.min(n-1, i0+1);
    const frac = idx - i0;
    const toRGB = (hex)=>({
      r: parseInt(hex.slice(1,3),16),
      g: parseInt(hex.slice(3,5),16),
      b: parseInt(hex.slice(5,7),16)
    });
    const a = toRGB(arr[i0]), b = toRGB(arr[i1]);
    const r = Math.round(lerp(a.r,b.r,frac)).toString(16).padStart(2,'0');
    const g = Math.round(lerp(a.g,b.g,frac)).toString(16).padStart(2,'0');
    const bl= Math.round(lerp(a.b,b.b,frac)).toString(16).padStart(2,'0');
    return `#${r}${g}${bl}`;
  }

  /* ------------------------------- Logo ---------------------------------- */
  function renderLogo(container, style, state){
    try{
      if (state.logo){ state.logo.remove(); state.logo = null; }
      if (!style.logoEnabled || !style.logoDataUrl) return;

      const wrap = document.createElement('div');
      wrap.style.position = 'absolute';
      wrap.style.pointerEvents = 'none';
      wrap.style.opacity = String(clamp01(style.logoOpacity));
      const pos = style.logoPosition || 'bottomright';
      const pad = '12px';
      wrap.style.width = '0'; wrap.style.height = '0';
      if (pos.includes('bottom')) wrap.style.bottom = pad; else wrap.style.top = pad;
      if (pos.includes('right'))  wrap.style.right  = pad; else wrap.style.left = pad;

      const img = document.createElement('img');
      img.src = style.logoDataUrl;
      img.alt = 'logo';
      img.style.width = `${Math.max(16, style.logoWidthPx|0)}px`;
      img.style.height = 'auto';
      img.style.border = '0';

      wrap.appendChild(img);
      container.appendChild(wrap);
      state.logo = wrap;
    }catch(e){ /* ignorar */ }
  }

  /* --------------------------- Template helpers -------------------------- */
  function renderTemplate(tpl, nombreLabel, v, rowByName, rankCtx){
    const getCol = (row, key)=>{
      if (!row) return undefined;
      const k = String(key).trim();
      if (row.byName && k in row.byName) return row.byName[k];
      if (row.byId && k in row.byId) return row.byId[k];
      return undefined;
    };
    const fmt0 = fmtInt;

    // CSV helpers
    const getCsvTxt = (colKey, idx1)=>{
      const raw = getCol(rowByName, colKey);
      const parts = String(raw ?? '').split(/,(?!\d)/).map(s=>s.trim()); // no corta "1,23"
      const i = Math.max(1, parseInt(idx1,10)||1) - 1;
      return parts[i] ?? '';
    };
    const extractNums = (raw)=>{
      const s = String(raw??'');
      const rx = /-?(?:\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,]\d+)?/g;
      const m = s.match(rx) || [];
      return m.map(toNumberLoose).filter(Number.isFinite);
    };
    const getCsvNum = (colKey, idx1)=>{
      const raw = getCol(rowByName, colKey);
      const nums = extractNums(raw);
      const i = Math.max(1, parseInt(idx1,10)||1) - 1;
      return nums[i];
    };
    const getStat = (row, col)=>{
      const v = toNumberLoose(getCol(row, col));
      return Number.isFinite(v) ? v : NaN;
    };

    let out = String(tpl||'');

    // básicos
    out = out.replace(/\{\{\s*nombre\s*\}\}/gi, nombreLabel);
    out = out.replace(/\{\{\s*valor\s*\}\}/gi, (v!=null && Number.isFinite(v)) ? fmt0(v) : 's/d');

    // rank / percentil
    out = out.replace(/\{\{\s*rank\s*\}\}/gi, ()=>{
      const r = rankCtx?.rankOf?.(v);
      return Number.isFinite(r) ? `${r}/${rankCtx.N}` : 's/d';
    });
    out = out.replace(/\{\{\s*percentil\s*\}\}/gi, ()=>{
      const p = rankCtx?.percentileOf?.(v);
      return Number.isFinite(p) ? `${p}º` : 's/d';
    });

    // csv números / texto
    out = out.replace(/\{\{\s*csvn\s*:\s*([^,}]+)\s*,\s*([^}]+)\s*\}\}/gi,
      (_m, colKey, idxStr)=> {
        const val = getCsvNum(colKey, idxStr);
        return Number.isFinite(val) ? fmt0(val) : 's/d';
      });
    out = out.replace(/\{\{\s*csv\s*:\s*([^,}]+)\s*,\s*([^}]+)\s*\}\}/gi,
      (_m, colKey, idxStr) => getCsvTxt(colKey, idxStr));

    // tasaCsv
    out = out.replace(/\{\{\s*tasaCsv\s*:\s*([^,}]+)\s*,\s*([^,}]+)\s*,\s*([^,}]+)(?:\s*,\s*([^}]+))?\s*\}\}/gi,
      (_m, colKey, iNumStr, iDenStr, factorStr)=>{
        const num = getCsvNum(colKey, iNumStr);
        const den = getCsvNum(colKey, iDenStr);
        const factor = Number(factorStr ?? 100);
        const t = (Number.isFinite(num) && Number.isFinite(den) && den>0)
          ? (num/den)*(Number.isFinite(factor)?factor:100) : NaN;
        return Number.isFinite(t) ? fmt0(t) : 's/d';
      });

    // columna directa
    out = out.replace(/\{\{\s*col\s*:\s*([^}]+)\s*\}\}/gi,
      (_m, colName)=>{
        const raw = getCol(rowByName, String(colName||'').trim());
        const n = Number(raw);
        return Number.isFinite(n) ? fmt0(n) : (raw ?? '');
      });

    // sum/avg/min/max (sobre la fila agregada)
    out = out.replace(/\{\{\s*(sum|avg|min|max)\s*:\s*([^}]+?)\s*\}\}/gi,
      (_m, _op, col)=> fmt0(getStat(rowByName, String(col).trim())));

    // count (Record Count o similares)
    out = out.replace(/\{\{\s*count(?:\s*:\s*([^}]+))?\s*\}\}/gi,
      (_m, colOpt)=>{
        if (colOpt && colOpt.trim()) return fmt0(getStat(rowByName, colOpt.trim()));
        const candidates = ['Record Count','RECORD_COUNT','record_count','Cant_Reuniones','Reuniones','Cantidad Reuniones'];
        for (const k of candidates){
          const v = getStat(rowByName, k);
          if (Number.isFinite(v)) return fmt0(v);
        }
        return 's/d';
      });

    return out;
  }

  /* =========================== DRAW VISUALIZATION ======================== */
  function drawVisualization(container, message = {}) {
    container.style.width = '100%';
    container.style.height = '100%';

    probeMessage(message, { note: 'antes de normalizar' });

    const style  = readStyle(message);
    const idx    = resolveIndices(message);

    // Nivel: parámetro (si llega en tabla) → estilo → heurística
    const H = message?.tables?.DEFAULT?.headers || [];
    const R = message?.tables?.DEFAULT?.rows || [];
    let nivel = style.nivelJerarquia || 'barrio';
    try{
      const pIdx = H.findIndex(h => {
        const id = (h?.id||'').toLowerCase(), nm = (h?.name||'').toLowerCase();
        return id === 'param_nivel' || nm === 'param_nivel' || id === 'nivel' || nm === 'nivel';
      });
      if (pIdx >= 0 && R.length){
        const pv = String(R[0][pIdx] ?? '').toLowerCase();
        if (pv === 'barrio' || pv === 'comuna') nivel = pv;
      }
    }catch(e){}
    try{ window.__lastNivel = nivel; }catch(e){}

    // GeoJSON según nivel
    const geojson =
      (nivel === 'comuna' && typeof GEOJSON_COMUNAS !== 'undefined' && GEOJSON_COMUNAS)
        ? GEOJSON_COMUNAS
        : (typeof GEOJSON !== 'undefined' ? GEOJSON : {type:'FeatureCollection',features:[]});

    // Stats y lookup
    const stats     = buildValueMap(message, idx.dim, idx.metric);
    const rowLookup = buildRowLookup(message, idx.dim);

    // Rank sobre features que pintan
    const paintedVals = [];
    if (geojson?.features){
      for (const f of geojson.features){
        const key = getFeatureKey(f, nivel, style.geojsonProperty);
        const val = stats.map.get(key);
        if (Number.isFinite(val)) paintedVals.push(val);
      }
    }
    const rankCtx = makeRankCtx(paintedVals, { highIsOne: true });

    // Detección automática de modo categórico 1–3
    const uniqVals = new Set();
    for (const vv of stats.map.values()){ if (Number.isFinite(vv)) uniqVals.add(vv); }
    const autoCategory = uniqVals.size>0 && [...uniqVals].every(v => Number.isInteger(v) && v>=1 && v<=3);
    const categoryModeActive = !!style.categoryMode || autoCategory;

    // Leaflet map init / cleanup
    if (!__leafletState.map) {
      __leafletState.map = L.map(container, { zoomControl: true, attributionControl: false });
    } else {
      const current = __leafletState.map.getContainer();
      if (current && current !== container) {
        container.appendChild(current);
        setTimeout(() => { try { __leafletState.map.invalidateSize(); } catch(e){} }, 0);
      }
      if (__leafletState.layer)  { try { __leafletState.map.removeLayer(__leafletState.layer); } catch(e){} }
      if (__leafletState.legend) { try { __leafletState.legend.remove(); } catch(e){} }
      __leafletState.layer = null; __leafletState.legend = null;
    }
    const map = __leafletState.map;

    const styleFn = (feature) => {
      const key = getFeatureKey(feature, nivel, style.geojsonProperty);
      const v = stats.map.get(key);

      // color de relleno
      let fillColor;
      if (Number.isFinite(v) && categoryModeActive) {
        if (v === style.cat1Value)      fillColor = style.cat1Color;
        else if (v === style.cat2Value) fillColor = style.cat2Color;
        else if (v === style.cat3Value) fillColor = style.cat3Color;
        else                            fillColor = style.categoryOtherColor || style.colorMissing;
      } else if (stats.count && Number.isFinite(v)) {
        const t = (v - stats.min) / ((stats.max - stats.min) || 1);
        fillColor = getColorFromScaleOrPalette(t, style);
      } else {
        fillColor = style.colorMissing;
      }

      const strokeCol = style.showBorders
        ? (String(style.borderColor).toLowerCase() === 'auto' ? autoBorderFor(fillColor) : style.borderColor)
        : 'transparent';

      return {
        color:       strokeCol,
        weight:      style.showBorders ? style.borderWidth  : 0,
        opacity:     style.showBorders ? style.borderOpacity: 0,
        fillColor,
        fillOpacity: style.fillOpacity
      };
    };

    const layer = L.geoJSON(geojson, {
      style: styleFn,
      onEachFeature: (feature, lyr) => {
        const nombreLabel = getFeatureNameProp(feature, nivel, style.geojsonProperty) ?? '—';
        const key         = getFeatureKey(feature, nivel, style.geojsonProperty);
        const v           = stats.map.get(key);
        const rowByName = rowLookup.get(nombreLabel) || rowLookup.get(canonicalKey(nombreLabel));


        const popupTpl   = style.popupFormat || '<strong>{{nombre}}</strong><br/>Valor: {{valor}}';
        const tooltipTpl = (style.tooltipFormat && style.tooltipFormat.trim()) ? style.tooltipFormat : popupTpl;

        // Tooltip (hover)
        if (style.showLabels) {
          const tooltipHtml = renderTemplate(tooltipTpl, nombreLabel, v, rowByName, rankCtx);
          try { lyr.unbindTooltip(); } catch(e){}
          lyr.bindTooltip(tooltipHtml, { sticky: true, direction: 'auto', opacity: 0.95 });
        }
        // Popup (click)
        const popupHtml = renderTemplate(popupTpl, nombreLabel, v, rowByName, rankCtx);
        lyr.bindPopup(popupHtml, { closeButton: false });
      }
    }).addTo(map);
    __leafletState.layer = layer;

    // Ajustar vista
    try {
      const b = layer.getBounds();
      if (b?.isValid && b.isValid()) {
        map.fitBounds(b, { padding: [16,16] });
        setTimeout(() => { try { map.invalidateSize(); } catch(e){} }, 0);
      }
    } catch (e) { /* noop */ }

    // Leyenda
    if (style.showLegend) {
      const legend = L.control({ position: style.legendPosition || 'bottomright' });
      legend.onAdd = () => {
        const div = L.DomUtil.create('div', 'legend');
        try { L.DomEvent.disableClickPropagation(div); L.DomEvent.disableScrollPropagation(div); } catch(e){}
        Object.assign(div.style, {
          background: 'rgba(255,255,255,.9)',
          padding: '8px 10px',
          borderRadius: '8px',
          boxShadow: '0 1px 4px rgba(0,0,0,.25)',
          font: '12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
        });

        if (categoryModeActive) {
          const entries = [
            { col: style.cat1Color, lbl: style.cat1Label, val: style.cat1Value },
            { col: style.cat2Color, lbl: style.cat2Label, val: style.cat2Value },
            { col: style.cat3Color, lbl: style.cat3Label, val: style.cat3Value },
            { col: style.categoryOtherColor, lbl: 'Otros' }
          ];
          for (const e of entries) {
            const row = document.createElement('div');
            row.style.display = 'flex'; row.style.alignItems = 'center'; row.style.gap = '8px'; row.style.margin = '2px 0';
            const sw = document.createElement('span');
            sw.style.display='inline-block'; sw.style.width='14px'; sw.style.height='14px';
            sw.style.border='1px solid rgba(0,0,0,.2)'; sw.style.background=e.col;
            const label = document.createElement('span');
            label.textContent = e.lbl + (typeof e.val === 'number' ? ` (=${e.val})` : '');
            row.appendChild(sw); row.appendChild(label); div.appendChild(row);
          }
          // Sin datos
          const ndRow = document.createElement('div');
          ndRow.style.display='flex'; ndRow.style.alignItems='center'; ndRow.style.gap='8px'; ndRow.style.margin='2px 0';
          const ndSw = document.createElement('span');
          ndSw.style.display='inline-block'; ndSw.style.width='14px'; ndSw.style.height='14px';
          ndSw.style.border='1px solid rgba(0,0,0,.2)'; ndSw.style.background = style.colorMissing;
          const ndLabel = document.createElement('span');
          ndLabel.textContent = style.legendNoDataText || 'Sin datos';
          ndRow.appendChild(ndSw); ndRow.appendChild(ndLabel); div.appendChild(ndRow);
          return div;
        }

        if (!stats || !Number.isFinite(stats.min) || !Number.isFinite(stats.max) || !stats.count) {
          div.textContent = 'Sin datos';
          return div;
        }

        const nRaw = Number(style.legendBreaks);
        const breaks = Number.isFinite(nRaw) ? Math.max(1, Math.min(12, Math.round(nRaw))) : 5;
        const fmt = (x) => {
          if (!Number.isFinite(x)) return 's/d';
          if (style.legendNoDecimals) return Math.round(x).toLocaleString('es-AR');
          return x.toLocaleString('es-AR', { maximumFractionDigits: 1 });
        };

        for (let i = 0; i < breaks; i++) {
          const a   = stats.min + (stats.max - stats.min) * (i / breaks);
          const b   = stats.min + (stats.max - stats.min) * ((i + 1) / breaks);
          const mid = (a + b) / 2;

          const u   = (mid - stats.min) / ((stats.max - stats.min) || 1);
          const col = getColorFromScaleOrPalette(u, style);

          const row = document.createElement('div');
          row.style.display='flex'; row.style.alignItems='center'; row.style.gap='8px'; row.style.margin='2px 0';

          const sw = document.createElement('span');
          sw.style.display='inline-block'; sw.style.width='14px'; sw.style.height='14px';
          sw.style.border='1px solid rgba(0,0,0,.2)'; sw.style.background=col;

          const label = document.createElement('span');
          label.textContent = `${fmt(a)} – ${fmt(b)}`;

          row.appendChild(sw); row.appendChild(label); div.appendChild(row);
        }

        // Sin datos
        const ndRow = document.createElement('div');
        ndRow.style.display='flex'; ndRow.style.alignItems='center'; ndRow.style.gap='8px'; ndRow.style.margin='2px 0';
        const ndSw = document.createElement('span');
        ndSw.style.display='inline-block'; ndSw.style.width='14px'; ndSw.style.height='14px';
        ndSw.style.border='1px solid rgba(0,0,0,.2)'; ndSw.style.background = style.colorMissing;
        const ndLabel = document.createElement('span');
        ndLabel.textContent = style.legendNoDataText || 'Sin datos';
        ndRow.appendChild(ndSw); ndRow.appendChild(ndLabel); div.appendChild(ndRow);

        return div;
      };
      legend.addTo(map);
      __leafletState.legend = legend;
    }

    // Logo
    renderLogo(map.getContainer(), style, __leafletState);

    if (DEBUG) console.log('[Viz] Render OK — nivel:', nivel, 'features:', geojson?.features?.length||0);
  }

  /* ====== INIT / DSCC bootstrap ====== */

// Si no existe, defino un probe no-op (por si tu archivo ya lo trae)
if (typeof probeMessage !== 'function') {
  window.probeMessage = function(){};
}

// Debug toggle (podés activar con ?debug=1)
//const DEBUG = /[?&]debug=1\b/.test(location.search) || !!window.__DEBUG_VIZ;

let __VIZ_SUBSCRIBED = false;

async function waitForDscc() {
  if (window.dscc && typeof window.dscc.subscribeToData === 'function') return window.dscc;
  // Poll cortito (2s total)
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 100));
    if (window.dscc && typeof window.dscc.subscribeToData === 'function') return window.dscc;
  }
  return null;
}

function ensureContainer(){
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


async function initWrapper(attempt = 1) {
  try {
    const MAX_ATTEMPTS = 5;
    if (__VIZ_SUBSCRIBED) { if (DEBUG) console.log('[Viz] ya suscripto'); return; }

    const dscc = await waitForDscc();
    if (dscc && typeof dscc.subscribeToData === 'function') {
      if (DEBUG) console.log('[Viz] dscc listo');
      dscc.subscribeToData((message) => {
        try { window.__dsccLast = message; } catch {}
        try { probeMessage(message, { note: 'callback' }); } catch {}
        try {
          const container = ensureContainer();
          drawVisualization(container, message);
        } catch (e) {
          console.error('[Viz] render error:', e);
        }
      }, { transform: dscc.objectTransform });

      tapTableTransform(dscc); // opcional para ver rows crudas
      __VIZ_SUBSCRIBED = true;
      return;
    }

    if (attempt < MAX_ATTEMPTS) {
      console.warn(`[Viz] dscc no disponible (attempt ${attempt}), reintento…`);
      setTimeout(() => initWrapper(attempt + 1), 1000);
      return;
    }
    console.error('[Viz] dscc no disponible tras reintentos.');
  } catch (e) {
    console.error('[Viz] Error initWrapper:', e);
  }
}

// Boot
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { initWrapper(); });
} else {
  initWrapper();
}

// Helpers de consola
window.__viz = {
  forceRender: () => {
    const m = window.__dsccLast;
    if (!m) return console.warn('No hay snapshot todavía');
    drawVisualization(ensureContainer(), m);
  },
  nivel: () => window.__lastNivel
};

})();
