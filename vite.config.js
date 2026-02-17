import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: 'public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'public/index.html')
      }
    },
    minify: 'terser',
    sourcemap: false
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:5177',
        changeOrigin: true
      },
      '/download': {
        target: 'http://localhost:5177',
        changeOrigin: true
      },
      '/download-zip': {
        target: 'http://localhost:5177',
        changeOrigin: true
      }
    }
  }
});
