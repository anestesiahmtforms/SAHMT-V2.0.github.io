import {Unzlib,zlibSync} from 'fflate';
const signature=[137,80,78,71,13,10,26,10],MAX_PIXELS=4000000;
const fail=code=>{throw Error('QMENTUM_PRINT_PNG_'+code);};
const uint=(b,p)=>((b[p]*16777216)+(b[p+1]<<16)+(b[p+2]<<8)+b[p+3])>>>0;
const put=(b,p,n)=>{b[p]=n>>>24;b[p+1]=n>>>16;b[p+2]=n>>>8;b[p+3]=n;};
const table=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;table[n]=c>>>0;}
const crc=bytes=>{let c=0xffffffff;for(const b of bytes)c=table[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;};
const join=chunks=>{const out=new Uint8Array(chunks.reduce((n,b)=>n+b.length,0));let p=0;for(const b of chunks){out.set(b,p);p+=b.length;}return out;};
const chunk=(name,data)=>{const b=new Uint8Array(data.length+12);put(b,0,data.length);for(let i=0;i<4;i++)b[4+i]=name.charCodeAt(i);b.set(data,8);put(b,8+data.length,crc(b.subarray(4,8+data.length)));return b;};
function adler(bytes){let a=1,b=0;for(let i=0;i<bytes.length;i++){a+=bytes[i];b+=a;if(i%5552===5551){a%=65521;b%=65521;}}return(((b%65521)<<16)|(a%65521))>>>0;}
function paeth(a,b,c){const p=a+b-c,da=Math.abs(p-a),db=Math.abs(p-b),dc=Math.abs(p-c);return da<=db&&da<=dc?a:db<=dc?b:c;}
export function decodePrintPng(input){
 const bytes=new Uint8Array(input);if(bytes.length<45||bytes.length>2097152||!signature.every((n,i)=>bytes[i]===n))fail('INVALID');
 let width=0,height=0,channels=0,position=8,ended=false;const data=[];
 while(position+12<=bytes.length){const length=uint(bytes,position);if(length>2097152||position+12+length>bytes.length)fail('INVALID');const name=String.fromCharCode(...bytes.subarray(position+4,position+8)),body=bytes.subarray(position+8,position+8+length);if(crc(bytes.subarray(position+4,position+8+length))!==uint(bytes,position+8+length))fail('CRC_INVALID');
  if(name==='IHDR'){if(width||position!==8||length!==13)fail('INVALID');width=uint(body,0);height=uint(body,4);if(!width||!height||width>4096||height>4096||width*height>MAX_PIXELS)fail('DIMENSION_LIMIT');if(body[8]!==8||body[10]!==0||body[11]!==0||body[12]!==0)return null;channels=({0:1,2:3,6:4})[body[9]]||0;if(!channels)return null;}
  else if(name==='IDAT'){if(!width)fail('INVALID');data.push(body);}
  else if(name==='IEND'){if(length)fail('INVALID');ended=true;position+=12;break;}
  position+=length+12;
 }
 if(!ended||position!==bytes.length||!data.length)fail('INVALID');const compressed=join(data),stride=width*channels,expected=height*(stride+1),raw=new Uint8Array(expected);let received=0;
 try{const stream=new Unzlib(part=>{if(received+part.length>expected)fail('EXPANSION_LIMIT');raw.set(part,received);received+=part.length;});for(let p=0;p<compressed.length;p+=1024)stream.push(compressed.subarray(p,p+1024),p+1024>=compressed.length);}catch(e){if(/^QMENTUM_PRINT_PNG_/.test(e.message||''))throw e;fail('COMPRESSION_INVALID');}
 if(received!==expected||compressed.length<6||adler(raw)!==uint(compressed,compressed.length-4))fail('COMPRESSION_INVALID');
 const filtered=new Uint8Array(height*stride),rgba=new Uint8Array(width*height*4);
 for(let y=0;y<height;y++){const filter=raw[y*(stride+1)];if(filter>4)fail('FILTER_INVALID');for(let x=0;x<stride;x++){const i=y*stride+x,a=x>=channels?filtered[i-channels]:0,b=y?filtered[i-stride]:0,c=y&&x>=channels?filtered[i-stride-channels]:0,v=raw[y*(stride+1)+1+x];filtered[i]=(v+(filter===0?0:filter===1?a:filter===2?b:filter===3?(a+b)>>1:paeth(a,b,c)))&255;}
  for(let x=0;x<width;x++){const i=(y*width+x)*4,p=y*stride+x*channels;rgba[i]=filtered[p];rgba[i+1]=channels===1?filtered[p]:filtered[p+1];rgba[i+2]=channels===1?filtered[p]:filtered[p+2];rgba[i+3]=channels===4?filtered[p+3]:255;}
 }return{width,height,rgba};
}
export function encodePrintPng({width,height,rgba}){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0||width*height>MAX_PIXELS||rgba.length!==width*height*4)fail('DIMENSION_LIMIT');
 const header=new Uint8Array(13);put(header,0,width);put(header,4,height);header[8]=8;header[9]=2;const raw=new Uint8Array(height*(width*3+1));
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const p=(y*width+x)*4,q=y*(width*3+1)+1+x*3,alpha=rgba[p+3]/255;for(let c=0;c<3;c++)raw[q+c]=Math.round(rgba[p+c]*alpha+255*(1-alpha));}
 return join([new Uint8Array(signature),chunk('IHDR',header),chunk('IDAT',zlibSync(raw,{level:6})),chunk('IEND',new Uint8Array())]);
}
const rgb=(r,x,y)=>{const p=(y*r.width+x)*4,a=r.rgba[p+3]/255;return[r.rgba[p]*a+255*(1-a),r.rgba[p+1]*a+255*(1-a),r.rgba[p+2]*a+255*(1-a)];};
const gray=(pixel,low,high)=>pixel[0]>=low&&pixel[0]<=high&&Math.max(...pixel)-Math.min(...pixel)<=4;
function runs(length,predicate){const out=[];for(let n=0;n<length;n++){if(!predicate(n))continue;const start=n;while(n+1<length&&predicate(n+1))n++;out.push([start,n]);}return out;}
function ink(r,rect){let left=rect.x1,right=-1,top=rect.y1,bottom=-1;for(let y=rect.y0;y<rect.y1;y++)for(let x=rect.x0;x<rect.x1;x++)if(Math.max(...rgb(r,x,y))<170){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}return right<0?null:{x0:left,y0:top,x1:right+1,y1:bottom+1};}
function tableRows(r){
 const horizontal=runs(r.height,y=>{let n=0;for(let x=0;x<r.width;x++)if(gray(rgb(r,x,y),180,235))n++;return n/r.width>.85;}),bounds=[0,...horizontal.map(([a,b])=>Math.round((a+b)/2)),r.height-1].filter((v,i,a)=>!i||v>a[i-1]);
 const vertical=runs(r.width,x=>{if(x<r.width*.25||x>r.width*.75)return false;let n=0;for(let y=0;y<r.height;y++)if(gray(rgb(r,x,y),180,235))n++;return n/r.height>.85;});if(vertical.length!==1||vertical[0][1]-vertical[0][0]>3||bounds.length<3||bounds.length>67)return null;
 const divider=Math.round((vertical[0][0]+vertical[0][1])/2),rows=[];
 for(let i=1;i<bounds.length-1;i++){const y0=bounds[i]+1,y1=bounds[i+1];if(y1-y0<12||y1-y0>85)return null;const label=ink(r,{x0:1,x1:divider,y0,y1}),value=ink(r,{x0:divider+1,x1:r.width-1,y0,y1});if(!label||!value)return null;if(value.x0<divider+(r.width-divider)*.45){if(!rows.length&&i<=2)continue;return null;}if(value.x1<r.width*.85)return null;rows.push([label,value]);}
 return rows;
}
function cardRows(r){
 if(r.width/r.height<3||r.width<400)return null;
 const gaps=runs(r.height,y=>{let n=0;for(let x=0;x<r.width;x++)if(gray(rgb(r,x,y),235,250))n++;return n/r.width>.9;});if(!gaps.length)return null;if(gaps[0][0]!==0)gaps.unshift([-1,-1]);if(gaps[gaps.length-1][1]!==r.height-1)gaps.push([r.height,r.height]);
 const bands=[];for(let i=0;i<gaps.length-1;i++)if(gaps[i+1][0]-gaps[i][1]>20)bands.push({y0:gaps[i][1]+1,y1:gaps[i+1][0]});if(bands.length!==3)return null;
 const middle=bands[1],vertical=runs(r.width,x=>{let n=0;for(let y=middle.y0;y<middle.y1;y++)if(gray(rgb(r,x,y),235,250))n++;return n/(middle.y1-middle.y0)>.9;});if(!vertical.length)return null;if(vertical[0][0]!==0)vertical.unshift([-1,-1]);if(vertical[vertical.length-1][1]!==r.width-1)vertical.push([r.width,r.width]);
 const columns=[];for(let i=0;i<vertical.length-1;i++)if(vertical[i+1][0]-vertical[i][1]>35)columns.push({x0:vertical[i][1]+1,x1:vertical[i+1][0]});if(columns.length!==6)return null;
 const rows=[];for(let row=1;row<=2;row++)for(let col=0;col<6;col++){const cell={...bands[row],...columns[col]};if(row===2&&col>=4){if(ink(r,cell))return null;continue;}const split=Math.round((cell.y0+cell.y1)/2),label=ink(r,{...cell,y1:split}),value=ink(r,{...cell,y0:split});if(!label||!value)return null;rows.push([label,value]);}
 return rows;
}
function pack(r,rows){
 const pad=14,gap=12,maxHeight=Math.max(...rows.flat().map(b=>b.y1-b.y0)),line=maxHeight+16,width=Math.max(...rows.map(([a,b])=>a.x1-a.x0+gap+b.x1-b.x0))+pad*2,height=rows.length*line+pad*2,scale=2;
 if(width*height*scale*scale>MAX_PIXELS)return null;const out={width:width*scale,height:height*scale,rgba:new Uint8Array(width*height*scale*scale*4)};out.rgba.fill(255);
 for(let i=0;i<rows.length;i++){let left=pad;for(const box of rows[i]){const top=pad+i*line+Math.floor((maxHeight-(box.y1-box.y0))/2);for(let y=box.y0;y<box.y1;y++)for(let x=box.x0;x<box.x1;x++){const color=rgb(r,x,y);if(Math.max(...color)>=170)continue;for(let yy=0;yy<scale;yy++)for(let xx=0;xx<scale;xx++){const p=(((top+y-box.y0)*scale+yy)*out.width+(left+x-box.x0)*scale+xx)*4;out.rgba[p]=color[0];out.rgba[p+1]=color[1];out.rgba[p+2]=color[2];}}left+=box.x1-box.x0+gap;}}
 return encodePrintPng(out);
}
/** Lossless source bytes remain unchanged. Only verified grid layouts are
 * reflowed for OCR; unsupported layouts retain strict OCR/manual fallback. */
export function preparePrintRaster(input,kind,mimeType='image/png'){
 const bytes=new Uint8Array(input),fallback={bytes,mimeType,transformed:false};if(mimeType!=='image/png'||!['TECHNIQUES','INDICATORS'].includes(kind))return fallback;const raster=decodePrintPng(bytes);if(!raster)return fallback;
 const rows=kind==='TECHNIQUES'?tableRows(raster):cardRows(raster);if(!rows?.length)return fallback;const packed=pack(raster,rows);return packed?{bytes:packed,mimeType:'image/png',transformed:true,rows:rows.length,layout:kind==='TECHNIQUES'?'TECHNIQUES_ROWS':'INDICATOR_CARDS'}:fallback;
}
