import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

export default {
  base: '/',
  assetsInclude: ['**/*.geojson'], // <-- habilita importar .geojson (con ?raw)
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2018',
    cssCodeSplit: false, // un solo CSS
    lib: {
      entry: path.resolve(__dirname, 'src/Visualization.js'),
      name: 'Visualization',                 // nombre global del IIFE
      fileName: () => 'Visualization.js',    // nombre fijo
      formats: ['iife']
    },
    rollupOptions: {
      output: {
        entryFileNames: 'Visualization.js',
        chunkFileNames: 'Visualization.js',
        assetFileNames: (assetInfo) => {
          const ext = path.extname(assetInfo.name || '').toLowerCase();
          if (ext === '.css') return 'Visualization.css'; // nombre fijo CSS
          return '[name][extname]';
        }
      },
      external: [] // bundlea todo
    }
  }
};
