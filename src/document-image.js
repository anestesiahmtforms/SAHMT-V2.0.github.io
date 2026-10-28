export function imageTargetSize(width,height,max=1600){
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw Error('Imagem inválida.');
 const scale=Math.min(1,max/Math.max(width,height));return{width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};
}
export const documentSizeLabel=bytes=>bytes<1048576?`${Math.ceil(bytes/1024)} KB`:`${(bytes/1048576).toFixed(1).replace('.',',')} MB`;
const canvasBlob=(canvas,quality)=>new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Não foi possível preparar a foto.')),'image/jpeg',quality));
export async function prepareDocumentFile(file){
 if(!file||file.size===0||file.size>20*1024*1024)throw Error('Selecione uma imagem de até 20 MB ou um PDF de até 5 MB.');
 if(file.type==='application/pdf'){
  if(file.size>5*1024*1024)throw Error('O PDF deve ter até 5 MB.');
  const header=new TextDecoder().decode(await file.slice(0,5).arrayBuffer());if(header!=='%PDF-')throw Error('O arquivo não é um PDF válido.');return{blob:file,mimeType:'application/pdf',image:false};
 }
 if(!['image/jpeg','image/png','image/webp','image/heic','image/heif','image/avif'].includes(file.type))throw Error('Use uma foto ou um arquivo PDF.');
 let bitmap;try{bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});}catch{throw Error('Este formato de imagem não abriu. Use JPEG, PNG ou fotografe novamente.');}
 try{
  const size=imageTargetSize(bitmap.width,bitmap.height),canvas=document.createElement('canvas');Object.assign(canvas,size);
  const context=canvas.getContext('2d');if(!context)throw Error('Não foi possível preparar a foto.');context.fillStyle='#fff';context.fillRect(0,0,size.width,size.height);context.drawImage(bitmap,0,0,size.width,size.height);
  let blob=await canvasBlob(canvas,.82);if(blob.size>2*1024*1024)blob=await canvasBlob(canvas,.65);
  if(blob.size>2*1024*1024)throw Error('A foto ainda ficou grande. Aproxime e fotografe uma página por vez.');
  return{blob,mimeType:'image/jpeg',image:true,...size};
 }finally{bitmap.close();}
}
export async function documentBase64(blob){
 const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(binary);
}
