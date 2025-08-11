import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Build “2025-ready” para Community Viz:
 * - ÚNICO JS (IIFE) → Visualization.bundle.js
 * - ÚNICO CSS        → Visualization.css
 * - Sin hashes ni subcarpetas
 * - Compatible con import de GeoJSON vía `?raw` (no requiere plugin)
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default {
  base: '/',                 // se sirve embebido por Looker Studio
  assetsInclude: ['**/*.geojson'],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2018',
    cssCodeSplit: false,     // un solo CSS
    lib: {
      entry: path.resolve(__dirname, 'src/Visualization.js'),
      name: 'Visualization', // nombre global del IIFE
      fileName: () => 'Visualization.bundle.js',
      formats: ['iife']      // ejecutable directo (no ESM)
    },
    rollupOptions: {
      output: {
        // Nombres estables y sin hashes
        entryFileNames: 'Visualization.bundle.js',
        chunkFileNames: 'Visualization.bundle.js',
        // Fuerza nombre fijo para CSS y preserva nombres de assets
        assetFileNames: (assetInfo) => {
          const ext = path.extname(assetInfo.name || '').toLowerCase();
          if (ext === '.css') return 'Visualization.css';
          return '[name][extname]';
        }
      },
      // Aseguramos que TODO se bundlee en el IIFE (no marcar externals)
      external: []
    }
  }
};
