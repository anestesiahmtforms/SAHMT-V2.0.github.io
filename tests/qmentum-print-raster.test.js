import test from 'node:test';import assert from 'node:assert/strict';import {zlibSync} from 'fflate';
import {decodePrintPng,encodePrintPng,preparePrintRaster} from '../src/qmentum-print-raster.js';
const crc=bytes=>{let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;}return(c^0xffffffff)>>>0;};
function png(width,height,rgba){const chunk=(type,data)=>{const t=Buffer.from(type),b=Buffer.alloc(12+data.length);b.writeUInt32BE(data.length);t.copy(b,4);Buffer.from(data).copy(b,8);b.writeUInt32BE(crc(Buffer.concat([t,Buffer.from(data)])),8+data.length);return b;},head=Buffer.alloc(13);head.writeUInt32BE(width);head.writeUInt32BE(height,4);head[8]=8;head[9]=6;const raw=Buffer.alloc(height*(width*4+1));for(let y=0;y<height;y++)Buffer.from(rgba.slice(y*width*4,(y+1)*width*4)).copy(raw,y*(width*4+1)+1);return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('IDAT',zlibSync(raw)),chunk('IEND',new Uint8Array())]);}
function canvas(width,height,color=255){const rgba=new Uint8Array(width*height*4);for(let i=0;i<rgba.length;i+=4){rgba[i]=rgba[i+1]=rgba[i+2]=color;rgba[i+3]=255;}return{width,height,rgba};}
function box(c,x,y,w,h,value=0){for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++){const i=(yy*c.width+xx)*4;c.rgba[i]=c.rgba[i+1]=c.rgba[i+2]=value;}}
test('PNG decoder preserves known pixels and encoder roundtrips bounded RGB rasters',()=>{
 const pixels=new Uint8Array([255,0,0,255,0,128,255,255]),decoded=decodePrintPng(png(2,1,pixels));assert.equal(decoded.width,2);assert.deepEqual([...decoded.rgba],[255,0,0,255,0,128,255,255]);const encoded=encodePrintPng(decoded);assert.deepEqual([...decodePrintPng(encoded).rgba],[255,0,0,255,0,128,255,255]);
});
test('invalid CRC, oversized dimensions and malformed compression fail before image layout is used',()=>{
 const c=canvas(2,2),bad=png(c.width,c.height,c.rgba);bad[20]^=1;assert.throws(()=>decodePrintPng(bad),/PNG/);const huge=png(10000,1,new Uint8Array(40000));assert.throws(()=>decodePrintPng(huge),/LIMIT/);assert.throws(()=>decodePrintPng(new Uint8Array([137,80,78,71,13,10,26,10])),/PNG/);
});
test('technique grid reflows each complete row without a separate aligned quantity column',()=>{
 const c=canvas(300,151);for(const y of [0,30,60,90,120,150])box(c,0,y,300,1,217);box(c,180,0,1,151,217);
 [30,65,45,85,50].forEach((w,i)=>{box(c,8,i*30+9,w,12);box(c,260,i*30+10,15,10);});
 const source=png(c.width,c.height,c.rgba),copy=Buffer.from(source),prepared=preparePrintRaster(source,'TECHNIQUES','image/png');assert.equal(prepared.transformed,true);assert.equal(prepared.rows,4);assert.equal(prepared.layout,'TECHNIQUES_ROWS');assert.ok(decodePrintPng(prepared.bytes).width<600);assert.deepEqual(source,copy);
});
test('indicator grid reads only the ten event/DM cards and omits Total de registros',()=>{
 const c=canvas(600,187,243),xs=[0,101,202,303,404,505];box(c,0,6,95,55,255);box(c,15,16,55,9);box(c,40,40,15,12);
 for(let row=0;row<2;row++)for(let col=0;col<(row?4:6);col++){const x=xs[col],y=68+row*61;box(c,x,y,95,55,255);box(c,x+8,y+7,40+col*3,10);box(c,x+40,y+35,12,12);}
 const result=preparePrintRaster(png(c.width,c.height,c.rgba),'INDICATORS','image/png');assert.equal(result.transformed,true);assert.equal(result.rows,10);assert.equal(result.layout,'INDICATOR_CARDS');
});
test('a top banner never turns the left-aligned quantity header into a data row',()=>{
 const c=canvas(300,157);box(c,0,0,300,6,0);for(const y of [6,36,66,96,126,156])box(c,0,y,300,1,217);box(c,180,6,1,151,217);
 box(c,8,15,40,12);box(c,190,15,70,12);for(let i=1;i<=4;i++){box(c,8,6+i*30+9,50+i*5,12);box(c,260,6+i*30+10,15,10);}
 const result=preparePrintRaster(png(c.width,c.height,c.rgba),'TECHNIQUES','image/png');assert.equal(result.transformed,true);assert.equal(result.rows,4);
});
test('unknown layouts and JPEGs remain untouched for strict OCR/manual fallback',()=>{
 const c=canvas(100,100),original=png(c.width,c.height,c.rgba);assert.equal(preparePrintRaster(original,'TECHNIQUES','image/png').transformed,false);const jpeg=new Uint8Array([255,216,255,1,2,3,4,5]);assert.deepEqual(preparePrintRaster(jpeg,'INDICATORS','image/jpeg').bytes,jpeg);
});
