import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
    rollupOptions: {
      output: {
        // Function form on purpose: the object form assigned shared modules
        // (e.g. react/jsx-runtime) into the markdown chunk, forcing the entry
        // to statically preload it. Everything except the react vendor chunk
        // is left to Rollup, which already splits along dynamic imports
        // (pdfService / docxService / MarkdownResult / KaTeXLine).
        manualChunks(id: string) {
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) {
            return 'vendor';
          }
          return undefined;
        },
      },
    },
  },
});
