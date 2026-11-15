import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

/** Keep OCR worker and WASM on our origin in dev and in release bundles. */
export function dosimetryOcrAssets(){
 const files=new Map([
  ['worker.min.js','node_modules/tesseract.js/dist/worker.min.js'],
  ...['tesseract-core-lstm.wasm.js','tesseract-core-simd-lstm.wasm.js','tesseract-core-relaxedsimd-lstm.wasm.js'].map(name=>[name,`node_modules/tesseract.js-core/${name}`])
 ]);
 return {name:'dosimetry-local-ocr',configureServer(server){server.middlewares.use((req,res,next)=>{
  const path=decodeURIComponent((req.url||'').split('?')[0]);const name=path.split('/dosimetry-ocr/')[1];if(!files.has(name))return next();
  res.setHeader('Content-Type','application/javascript');res.end(readFileSync(resolve(files.get(name))));
 });},generateBundle(){for(const [name,path] of files)this.emitFile({type:'asset',fileName:`dosimetry-ocr/${name}`,source:readFileSync(resolve(path))});}};
}
