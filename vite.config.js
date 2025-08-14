// vite.config.js
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  assetsInclude: ['**/*.geojson'], // permite importar geojson con ?raw
  build: {
    target: 'es2018',
    cssCodeSplit: false, // 1 solo css
    lib: {
      entry: resolve(__dirname, 'src/Visualization.js'),
      name: 'Visualization',
      formats: ['iife'],                 // Community Viz: bundle IIFE
      fileName: () => 'Visualization.js' // nombre fijo
    },
    rollupOptions: {
      output: {
        // 🔒 garantiza 1 solo bundle (sin chunks)
        inlineDynamicImports: true,
        entryFileNames: 'Visualization.js',
        chunkFileNames: 'Visualization.js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith('.css')) {
            return 'Visualization.css';  // css fijo
          }
          // otros assets (si los hubiera)
          return assetInfo.name || 'assets/[name][extname]';
        }
      },
      // 🔁 bundlear todo dentro (evita dependencias externas en runtime)
      external: []
    }
  }
});
