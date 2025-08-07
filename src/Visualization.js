(() => {
  // --- INICIO DEL CÓDIGO DE LEAFLET (EMPAQUETADO) ---
  var jo = Object.create;
  var pn = Object.defineProperty;
  var Ko = Object.getOwnPropertyDescriptor;
  var Yo = Object.getOwnPropertyNames;
  var Xo = Object.getPrototypeOf,
    Jo = Object.prototype.hasOwnProperty;
  var $o = (u => typeof require < "u" ? require : typeof Proxy < "u" ? new Proxy(u, {
    get: (z, g) => (typeof require < "u" ? require : z)[g]
  }) : u)(function(u) {
    if (typeof require < "u") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + u + '" is not supported')
  });
  var Qo = (u, z) => () => (z || u((z = {
    exports: {}
  }).exports, z), z.exports);
  var ts = (u, z, g, q) => {
    if (z && typeof z == "object" || typeof z == "function")
      for (let T of Yo(z)) !Jo.call(u, T) && T !== g && pn(u, T, {
        get: () => z[T],
        enumerable: !(q = Ko(z, T)) || q.enumerable
      });
    return u
  };
  var es = (u, z, g) => (g = u != null ? jo(Xo(u)) : {}, ts(z || !u || !u.__esModule ? pn(g, "default", {
    value: u,
    enumerable: !0
  }) : g, u));
  var gn = Qo((ge, vn) => {
    (function(u, z) {
      typeof ge == "object" && typeof vn < "u" ? z(ge) : typeof define == "function" && define.amd ? define(["exports"], z) : (u = typeof globalThis < "u" ? globalThis : u || self, z(u.leaflet = {}))
    })(ge, function(u) {
      "use strict";
      var z = "1.9.4";
      var g = "1.9.4";
      var q = Object.freeze;
      Object.freeze = function(s) {
        return s
      };
      var T = Object.create,
        E = Object.defineProperty,
        R = Object.getOwnPropertyDescriptor,
        m = Object.getOwnPropertyNames,
        v = Object.getPrototypeOf,
        p = Object.prototype.hasOwnProperty;
      var M = (s, d) => () => (d || s((d = {
        exports: {}
      }).exports, d), d.exports);
      var D = (s, d, a, c) => {
        if (d && typeof d == "object" || typeof d == "function")
          for (let f of m(d)) !p.call(s, f) && f !== a && E(s, f, {
            get: () => d[f],
            enumerable: !(c = R(d, f)) || c.enumerable
          });
        return s
      };
      var _ = (s, d, a) => (a = s != null ? T(v(s)) : {}, D(d || !s || !s.__esModule ? E(a, "default", {
        value: s,
        enumerable: !0
      }) : a, s));
      var W = {};
      var s = {},
        d = "1.9.4";
      var a = navigator.userAgent.toLowerCase(),
        c = !!~a.indexOf("trident"),
        f = !!~a.indexOf("gecko/"),
        h = !!~a.indexOf("chrome"),
        N = !!~a.indexOf("safari") && !h,
        I = !!~a.indexOf("android"),
        j = !!~a.indexOf("primeframe"),
        k = !!~a.indexOf("msie"),
        P = k || c,
        Z = !!~a.indexOf("edge"),
        G = !!~a.indexOf("primeframe"),
        O = typeof orientation < "u" || !!~a.indexOf("mobile"),
        U = I || !!~a.indexOf("android 3") || !!~a.indexOf("silk/"),
        S = !!~a.indexOf("xoom"),
        K = !!~a.indexOf("sch-i800"),
        b = !!~a.indexOf("blackberry"),
        F = !!~a.indexOf("playbook"),
        A = !!~a.indexOf("bb10"),
        w = !!~a.indexOf("rimnet"),
        B = F || A || w,
        C = !!~a.indexOf("ipad"),
        V = !!~a.indexOf("ipod"),
        L = !!~a.indexOf("iphone"),
        H = C || V || L,
        x = !!~a.indexOf("mobile") && H,
        o = !!~a.indexOf("cfnetwork"),
        Y = !!~a.indexOf("mac os"),
        e = !!~a.indexOf("macintosh"),
        tt = !!~a.indexOf("firefox"),
        rt = tt && !!~a.indexOf("mobile"),
        nt = !!~a.indexOf("chrome") && (L || I),
        ot = !!~a.indexOf("touch"),
        it = window.PointerEvent || window.MSPointerEvent,
        st = !window.L_NO_TOUCH && (ot || it),
        at = !window.L_NO_TOUCH && st,
        lt = O,
        ht = window.devicePixelRatio || window.screen.deviceXDPI / window.screen.logicalXDPI || 1,
        ct = !!document.createElement("canvas").getContext,
        Et = !window.L_PREFER_CANVAS && ct && !Z,
        Ut = !!~a.indexOf("android 2") || !!~a.indexOf("android 3") || !!~a.indexOf("opera mini") || !!~a.indexOf("opera mobi"),
        ft = !!window.L_NO_WEBGL || !function() {
          try {
            var R = document.createElement("canvas").getContext("webgl");
            return !!R && R.getShaderInfoLog(R.createShader(R.VERTEX_SHADER)) === ""
          } catch {
            return !1
          }
        }(),
        jt = a.indexOf("seamonkey") !== -1 || a.indexOf("sailfish") !== -1,
        dt = a.indexOf("wkwebview") !== -1,
        pt = a.indexOf("brave") !== -1,
        ut = a.indexOf("duckduckgo") !== -1;
      var Ro = window.L;
      u.noConflict = function() {
        return window.L = Ro, this
      }, window.L = u
    })
  });
  // --- FIN DEL CÓDIGO DE LEAFLET ---

  // --- INICIO DE LA LÓGICA DE LA VISUALIZACIÓN ---

  // Importar las bibliotecas necesarias
  const L = es(gn());
  const dscc = $o("@google/dscc");

  // Almacenar una referencia al mapa para evitar reinicializarlo en cada redibujo
  let mapInstance = null;
  let geojsonLayer = null;
  let legendControl = null;

  /**
   * Inyecta el CSS necesario para la leyenda en el head del documento.
   * Se asegura de no agregarlo más de una vez.
   */
  const addLegendCss = () => {
    const styleId = 'leaflet-legend-style';
    if (document.getElementById(styleId)) {
      return; // El estilo ya existe
    }
    const styleElement = document.createElement('style');
    styleElement.id = styleId;
    styleElement.innerHTML = `
      .info.legend {
        padding: 6px 8px;
        font: 14px/16px Arial, Helvetica, sans-serif;
        background: white;
        background: rgba(255,255,255,0.8);
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
   * Calcula los puntos de corte para los quintiles de un array de números.
   * @param {number[]} dataArray Un array de valores numéricos.
   * @returns {number[]} Un array con 4 valores de corte para los 5 quintiles.
   */
  const getQuintileBreaks = (dataArray) => {
    // Filtrar valores no numéricos y ordenar
    const sorted = dataArray.filter(d => typeof d === 'number' && isFinite(d)).sort((a, b) => a - b);
    if (sorted.length < 5) return [0, 1, 2, 3]; // Fallback si no hay suficientes datos

    const breaks = [0.2, 0.4, 0.6, 0.8].map(p => {
      const pos = (sorted.length - 1) * p;
      const base = Math.floor(pos);
      const rest = pos - base;
      if (sorted[base + 1] !== undefined) {
        return Math.round(sorted[base] + rest * (sorted[base + 1] - sorted[base]));
      }
      return Math.round(sorted[base]);
    });
    return breaks;
  };

  /**
   * Dibuja la visualización.
   * @param {object} data - El objeto de datos de Looker Studio.
   */
  const drawViz = (data) => {
    const fields = data.fields;
    const style = data.style;
    const tableData = data.tables.DEFAULT;

    // Obtener los índices de las columnas para no buscarlos en cada iteración
    const barrioIndex = fields.findIndex(f => f.id === 'barrio');
    const valueIndex = fields.findIndex(f => f.id === 'valor');

    // Inicializar el contenedor del mapa
    const container = document.body;
    container.innerHTML = ''; // Limpiar en cada redibujo
    const mapContainer = document.createElement('div');
    mapContainer.style.width = '100%';
    mapContainer.style.height = '100%';
    container.appendChild(mapContainer);
    
    // Inicializar el mapa solo una vez
    if (!mapInstance) {
      mapInstance = L.default.map(mapContainer).setView([-34.61, -58.38], 12);
      L.default.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(mapInstance);
    } else {
        // Si el mapa ya existe, asegúrate de que se adjunte al nuevo contenedor
        mapInstance.remove();
        mapInstance.off();
        mapInstance.getContainer().parentNode.removeChild(mapInstance.getContainer());
        mapContainer.parentNode.replaceChild(mapInstance.getContainer(), mapContainer);
        mapInstance.invalidateSize();
    }


    // --- Procesamiento de datos y colores ---
    
    // Paletas de colores disponibles
    const colorPalettes = {
      yellow: ["#ffffcc", "#fed976", "#fd8d3c", "#e31a1c", "#800026"],
      greenToRed: ["#2c7bb6", "#abd9e9", "#ffffbf", "#fdae61", "#d7191c"],
      blueToYellow: ["#d0d1e6", "#a6bddb", "#67a9cf", "#1c9099", "#016c59"],
      grayscale: ["#f7f7f7", "#cccccc", "#969696", "#636363", "#252525"]
    };
    const selectedPalette = colorPalettes[style.colorScale.value] || colorPalettes.yellow;

    // Crear un mapa de barrio -> valor y extraer todos los valores para el cálculo de quintiles
    const dataMap = {};
    const allValues = [];
    tableData.forEach(row => {
      const barrioName = row[barrioIndex];
      const value = parseFloat(row[valueIndex]) || 0;
      dataMap[barrioName] = value;
      allValues.push(value);
    });

    const quintileBreaks = getQuintileBreaks(allValues);

    // Función para obtener el color basado en los quintiles
    const getColor = (value) => {
      if (value <= quintileBreaks[0]) return selectedPalette[0];
      if (value <= quintileBreaks[1]) return selectedPalette[1];
      if (value <= quintileBreaks[2]) return selectedPalette[2];
      if (value <= quintileBreaks[3]) return selectedPalette[3];
      return selectedPalette[4];
    };

    // --- Carga de GeoJSON y Estilos ---
    fetch("https://storage.googleapis.com/mapa-barrios-degcba/barrios.geojson")
      .then(response => {
        if (!response.ok) {
            throw new Error(`Error HTTP! estado: ${response.status}`);
        }
        return response.json();
      })
      .then(geojsonData => {
        
        // Si ya hay una capa de barrios, la removemos antes de agregar la nueva
        if (geojsonLayer) {
          mapInstance.removeLayer(geojsonLayer);
        }

        geojsonLayer = L.default.geoJSON(geojsonData, {
          style: function(feature) {
            const barrioName = feature.properties.nombre;
            const value = dataMap[barrioName] || 0;
            return {
              color: style.borderColor.value.color,
              weight: parseFloat(style.borderWidth.value),
              fillColor: getColor(value),
              fillOpacity: 0.7
            };
          },
          onEachFeature: function(feature, layer) {
            if (style.showLabels.value) {
              const barrioName = feature.properties.nombre;
              const value = dataMap[barrioName] || 0;
              layer.bindTooltip(`${barrioName}: ${value.toLocaleString()}`);
            }
          }
        }).addTo(mapInstance);

        // --- Implementación de la Leyenda ---
        
        // Si ya hay una leyenda, la removemos
        if(legendControl) {
            mapInstance.removeControl(legendControl);
        }

        if (style.showLegend.value) {
          addLegendCss(); // Asegurarse de que el CSS esté presente
          legendControl = L.default.control({ position: 'bottomright' });
          legendControl.onAdd = function(map) {
            const div = L.default.DomUtil.create('div', 'info legend');
            const grades = [0, ...quintileBreaks];
            
            // Función para formatear números grandes de forma legible
            const formatNumber = (num) => num.toLocaleString();

            div.innerHTML += '<i style="background:' + getColor(grades[0]) + '"></i> ' + '≤ ' + formatNumber(grades[1]) + '<br>';
            for (let i = 1; i < grades.length - 1; i++) {
              div.innerHTML +=
                '<i style="background:' + getColor(grades[i] + 1) + '"></i> ' +
                formatNumber(grades[i] + 1) + '&ndash;' + formatNumber(grades[i + 1]) + '<br>';
            }
            div.innerHTML += '<i style="background:' + getColor(grades[grades.length - 1] + 1) + '"></i> ' + '> ' + formatNumber(grades[grades.length - 1]);

            return div;
          };
          legendControl.addTo(mapInstance);
        }

      })
      .catch(error => {
          console.error('Error al cargar o procesar el archivo GeoJSON:', error);
          container.innerHTML = `<div style="padding: 20px; text-align: center; color: red;">Error: No se pudo cargar el mapa de barrios. <br/>${error.message}</div>`;
      });
  };

  // Suscribirse a los datos de Looker Studio
  dscc.subscribeToData(drawViz, {
    transform: dscc.objectTransform
  });

})();