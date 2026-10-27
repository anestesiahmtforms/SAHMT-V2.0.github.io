import {defineConfig} from 'vite';
export default defineConfig({root: 'climate', base: '/', build: {outDir: '../dist-climate', emptyOutDir: true, rollupOptions: {input: {survey: 'climate/index.html', dashboard: 'climate/dashboard.html'}}}});
