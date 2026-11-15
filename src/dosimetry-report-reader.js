import {parseDosimetryReport} from './dosimetry-report-parser.js';

const cancelled=()=>new Error('Leitura do relatório cancelada.');
// Scanned table borders otherwise merge with glyphs and defeat word detection.
export function removeTableRules(canvas){
 const context=canvas.getContext('2d',{willReadFrequently:true}),image=context.getImageData(0,0,canvas.width,canvas.height),{data,width,height}=image;
 const dark=(x,y)=>data[(y*width+x)*4]<180;
 const erase=(x,y)=>{if(x<0||y<0||x>=width||y>=height)return;const p=(y*width+x)*4;data[p]=data[p+1]=data[p+2]=255;};
 const runs=[];
 for(let y=0;y<height;y++){let start=-1;for(let x=0;x<=width;x++){if(x<width&&dark(x,y)){if(start<0)start=x;}else if(start>=0){if(x-start>width*.15)runs.push([start,y,x,y]);start=-1;}}}
 for(let x=0;x<width;x++){let start=-1;for(let y=0;y<=height;y++){if(y<height&&dark(x,y)){if(start<0)start=y;}else if(start>=0){if(y-start>height*.06)runs.push([x,start,x,y]);start=-1;}}}
 for(const [x0,y0,x1,y1] of runs){if(y0===y1){for(let x=x0;x<x1;x++)for(let d=-2;d<=2;d++)erase(x,y0+d);}else{for(let y=y0;y<y1;y++)for(let d=-2;d<=2;d++)erase(x0+d,y);}}
 context.putImageData(image,0,0);
}
export async function readDosimetryReport(file,{onProgress=()=>{},isCurrent=()=>true}={}){
 if(!file||typeof file.arrayBuffer!=='function'||file.size>30*1024*1024)throw Error('Selecione um relatório PDF de até 30 MB.');
 const buffer=await file.arrayBuffer();
 if(!isCurrent())throw cancelled();
 const sourceFingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),b=>b.toString(16).padStart(2,'0')).join('');
 const pdfjs=await import('pdfjs-dist');
 pdfjs.GlobalWorkerOptions.workerSrc=new URL('pdfjs-dist/build/pdf.worker.min.mjs',import.meta.url).href;
 // No PDF or OCR content leaves this browser. All runtime assets use our own origin.
 const loadingTask=pdfjs.getDocument({data:new Uint8Array(buffer),isEvalSupported:false});
 let worker;const pages=[];let usedOcr=false;
 try{
  const pdf=await loadingTask.promise;
  if(pdf.numPages>30)throw Error('O relatório deve ter no máximo 30 páginas.');
  for(let index=1;index<=pdf.numPages;index++){
   if(!isCurrent())throw cancelled();
   onProgress({stage:'text',page:index,totalPages:pdf.numPages,progress:(index-1)/pdf.numPages});
   const page=await pdf.getPage(index),text=await page.getTextContent();
   let items=text.items.filter(item=>item.str?.trim()).map(item=>({str:item.str,x:item.transform[4],y:item.transform[5]+item.height/2,w:item.width,h:item.height}));
   if(items.reduce((sum,item)=>sum+item.str.length,0)<40){
    usedOcr=true;
    if(!worker){
     onProgress({stage:'ocr-loading',page:index,totalPages:pdf.numPages,progress:0});
     const {createWorker}=await import('tesseract.js');
     const base=new URL(`${import.meta.env.BASE_URL}dosimetry-ocr/`,location.origin).href;
     worker=await createWorker('por',1,{workerPath:`${base}worker.min.js`,corePath:base,langPath:base,gzip:false,workerBlobURL:false,cacheMethod:'none',logger:message=>{
      if(isCurrent())onProgress({stage:'ocr',page:index,totalPages:pdf.numPages,progress:message.progress||0});
     }});
     await worker.setParameters({tessedit_pageseg_mode:'11',preserve_interword_spaces:'1'});
    }
    if(!isCurrent())throw cancelled();
    const scale=4,viewport=page.getViewport({scale}),canvas=document.createElement('canvas');
    if(viewport.width*viewport.height>25_000_000)throw Error('As dimensões da página excedem o limite de leitura local.');
    canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
    try{
     await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
     removeTableRules(canvas);
     const result=await worker.recognize(canvas,{}, {blocks:true});
     items=(result.data.blocks||[]).flatMap(block=>(block.paragraphs||[]).flatMap(paragraph=>(paragraph.lines||[]).flatMap(line=>(line.words||[]).map(word=>({str:word.text,x:word.bbox.x0/scale,y:(canvas.height-(word.bbox.y0+word.bbox.y1)/2)/scale,w:(word.bbox.x1-word.bbox.x0)/scale,h:(word.bbox.y1-word.bbox.y0)/scale,confidence:word.confidence})))));
     // Sparse-text recognition omits isolated one-digit month counts. Read
     // that narrow column as a text block to independently verify every row.
     const countHeader=items.find(i=>/^Nro\.?$/i.test(i.str));
     const jan=items.find(i=>/^Jan$/i.test(i.str));
     if(countHeader&&jan){
      const left=Math.floor((countHeader.x-2)*scale),top=Math.ceil((canvas.height/scale-jan.y+10)*scale);
      const width=Math.floor((countHeader.x-jan.x)/12*.72*scale);
      const cropped=document.createElement('canvas');cropped.width=width;cropped.height=canvas.height-top;
      try{
       cropped.getContext('2d').drawImage(canvas,left,top,width,cropped.height,0,0,width,cropped.height);
       await worker.setParameters({tessedit_pageseg_mode:'6',tessedit_char_whitelist:'0123456789'});
       const counts=await worker.recognize(cropped,{}, {blocks:true});
       const countItems=(counts.data.blocks||[]).flatMap(b=>(b.paragraphs||[]).flatMap(p=>(p.lines||[]).flatMap(l=>(l.words||[]).map(w=>({str:w.text,x:(left+w.bbox.x0)/scale,y:(canvas.height-top-(w.bbox.y0+w.bbox.y1)/2)/scale,w:(w.bbox.x1-w.bbox.x0)/scale,h:(w.bbox.y1-w.bbox.y0)/scale,confidence:w.confidence})))));
       items=items.filter(i=>i.y>=jan.y-10||i.x<countHeader.x-3||i.x>countHeader.x+width/scale);
       items.push(...countItems);
      }finally{cropped.width=0;cropped.height=0;await worker.setParameters({tessedit_pageseg_mode:'11',tessedit_char_whitelist:''});}
     }
    }finally{canvas.width=0;canvas.height=0;}
   }
   pages.push(items);page.cleanup();
  }
  if(!isCurrent())throw cancelled();
  const parsed=parseDosimetryReport(pages);
  if(usedOcr)parsed.warnings.push('Relatório digitalizado: confira todos os nomes e valores extraídos por OCR antes de publicar.');
  onProgress({stage:'done',progress:1});
  return {...parsed,sourceFingerprint,fileName:file.name||'relatorio.pdf',usedOcr};
 }finally{if(worker)await worker.terminate();await loadingTask.destroy();}
}
