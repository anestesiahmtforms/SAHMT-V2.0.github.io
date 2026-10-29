import {defineConfig} from 'vite';import {resolve} from 'node:path';
export default defineConfig({root:'indicators-platform',base:'/',build:{outDir:'../dist-indicators',emptyOutDir:true,rollupOptions:{input:resolve('indicators-platform/index.html')}}});
