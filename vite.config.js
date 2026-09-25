import {defineConfig} from 'vite';

export default defineConfig({
  base: '/SAHMT-V2.0.github.io/',
  build: {outDir: 'dist', emptyOutDir: true},
  server: {host: '0.0.0.0'}
});
