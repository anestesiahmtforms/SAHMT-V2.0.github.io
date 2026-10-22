import {defineConfig} from 'vite';

export default defineConfig({
  base: '/SAHMT-V2.0.github.io/',
  build: {outDir: 'dist', emptyOutDir: true, manifest: 'assets-manifest.json',rollupOptions:{input:{app:'index.html'}}},
  server: {host: '0.0.0.0'}
});
