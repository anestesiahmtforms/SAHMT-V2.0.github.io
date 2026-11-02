import {build} from 'esbuild';
await build({entryPoints:['fa-performance/domain.js'],bundle:true,format:'iife',globalName:'FaPerformanceDomain',target:'es2020',outfile:'apps-script-v2/FaPerformanceDomain.gs'});
