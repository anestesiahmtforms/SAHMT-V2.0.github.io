export function imageTargetSize(width,height,max=1600){
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw Error('Imagem inválida.');
 const scale=Math.min(1,max/Math.max(width,height));return{width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};
}
export const documentSizeLabel=bytes=>bytes<1048576?`${Math.ceil(bytes/1024)} KB`:`${(bytes/1048576).toFixed(1).replace('.',',')} MB`;
const canvasBlob=(canvas,quality)=>new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Não foi possível preparar a foto.')),'image/jpeg',quality));

async function openDocumentImage(file){
 try{
  const bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});
  return {image:bitmap,width:bitmap.width,height:bitmap.height,release:()=>bitmap.close()};
 }catch{
  // Safari can display a native photo even when createImageBitmap rejects it.
  const url=URL.createObjectURL(file),image=new Image();
  try{
   await new Promise((resolve,reject)=>{
    image.onload=resolve;
    image.onerror=()=>reject(Error('Este formato de imagem não abriu. Use JPEG, PNG ou fotografe novamente.'));
    image.src=url;
   });
   return {image,width:image.naturalWidth,height:image.naturalHeight,release:()=>URL.revokeObjectURL(url)};
  }catch(error){
   URL.revokeObjectURL(url);
   throw error;
  }
 }
}

export async function prepareDocumentFile(file){
 if(!file||file.size===0||file.size>20*1024*1024)throw Error('Selecione uma imagem de até 20 MB ou um PDF de até 5 MB.');
 const unspecified=!file.type||file.type==='application/octet-stream';
 if(file.type==='application/pdf'||unspecified){
  const header=new TextDecoder().decode(await file.slice(0,5).arrayBuffer());
  if(header==='%PDF-'){
   if(file.size>5*1024*1024)throw Error('O PDF deve ter até 5 MB.');
   return {blob:file,mimeType:'application/pdf',image:false};
  }
  if(file.type==='application/pdf'||/\.pdf$/i.test(file.name||''))throw Error('O arquivo não é um PDF válido.');
 }
 if(!unspecified&&!['image/jpeg','image/png','image/webp','image/heic','image/heif','image/avif'].includes(file.type))throw Error('Use uma foto ou um arquivo PDF.');
 const source=await openDocumentImage(file);
 try{
  const size=imageTargetSize(source.width,source.height),canvas=document.createElement('canvas');Object.assign(canvas,size);
  const context=canvas.getContext('2d');if(!context)throw Error('Não foi possível preparar a foto.');context.fillStyle='#fff';context.fillRect(0,0,size.width,size.height);context.drawImage(source.image,0,0,size.width,size.height);
  let blob=await canvasBlob(canvas,.82);if(blob.size>2*1024*1024)blob=await canvasBlob(canvas,.65);
  if(blob.size>2*1024*1024)throw Error('A foto ainda ficou grande. Aproxime e fotografe uma página por vez.');
  return{blob,mimeType:'image/jpeg',image:true,...size};
 }finally{source.release();}
}
export async function documentBase64(blob){
 const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(binary);
}
