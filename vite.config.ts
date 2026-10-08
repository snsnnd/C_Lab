import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  // `allowedHosts: true` lets tunneling services (SakuraFrp / nat.app etc.) reach the
  // dev server; Vite would otherwise reject unknown Host headers. Dev-only: the
  // classroom server (npm run serve) has no such restriction.
  server: { port: 5173, strictPort: true, allowedHosts: true },
  preview: { allowedHosts: true },
  worker: { format: 'es' },
  // `web-tree-sitter` locates its own runtime with `new URL("web-tree-sitter.wasm", import.meta.url)`.
  // Pre-bundling it would point that URL at `/node_modules/.vite/deps/`, where the file does not
  // exist, so dev-server requests fall back to index.html and WebAssembly instantiation fails.
  optimizeDeps: { exclude: ['web-tree-sitter'] },
});
