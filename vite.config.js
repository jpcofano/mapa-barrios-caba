import path from 'path';

export default {
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