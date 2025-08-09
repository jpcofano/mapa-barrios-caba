// vite.config.js
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  base: '/', // se despliega en la raíz del bucket
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit: false, // 1 CSS plano
    lib: {
      entry: path.resolve(__dirname, 'src/Visualization.js'),
      name: 'Visualization',
      // Fuerza nombre estable del bundle JS
      fileName: () => 'Visualization.js',
      formats: ['iife'] // ejecutable directo en el navegador (no module)
    },
    rollupOptions: {
      output: {
        // Evita hashes en nombres y subcarpetas para JS/CSS/imágenes
        assetFileNames: '[name][extname]',
        chunkFileNames: '[name].js',
        entryFileNames: 'Visualization.js'
      }
    }
  }
});
