import {defineConfig} from 'vite';

export default defineConfig({
  base: '/SAHMT-V2.0.github.io/',
  build: {outDir: 'dist', emptyOutDir: true, manifest: 'assets-manifest.json'},
  server: {host: '0.0.0.0'}
});
