import test from 'node:test';
import assert from 'node:assert/strict';
import {pdfPageLayout,PDF_ZOOM_STEPS,PDF_MAX_CANVAS_PIXELS} from '../src/diretrizes-pdf-layout.js';
test('Retina backing resolution increases without changing the displayed page width',()=>{
 const input={width:595,height:842,availableWidth:324};
 const normal=pdfPageLayout(input),retina=pdfPageLayout({...input,devicePixelRatio:3});
 assert.equal(retina.cssWidth,normal.cssWidth);assert.equal(retina.cssHeight,normal.cssHeight);
 assert.ok(retina.pixelWidth>=normal.pixelWidth*3);assert.ok(retina.pixelHeight>=normal.pixelHeight*3);
 assert.equal(retina.outputScale,3);
});
test('zoom enlarges the page but respects the existing four million pixel budget',()=>{
 for(const dimensions of [[595,842],[842,595],[100,10000],[10000,100]])for(const zoom of PDF_ZOOM_STEPS){
  const layout=pdfPageLayout({width:dimensions[0],height:dimensions[1],availableWidth:1000,zoom,devicePixelRatio:4});
  assert.ok(layout.pixelWidth*layout.pixelHeight<=PDF_MAX_CANVAS_PIXELS);
  assert.ok(layout.pixelWidth<=4096&&layout.pixelHeight<=4096);
 }
 const fit=pdfPageLayout({width:595,height:842,availableWidth:324}),zoomed=pdfPageLayout({width:595,height:842,availableWidth:324,zoom:3,devicePixelRatio:3});
 assert.equal(zoomed.cssWidth,fit.cssWidth*3);assert.ok(zoomed.pixelWidth>fit.pixelWidth);
});
test('invalid page dimensions and unsupported zoom are rejected',()=>{
 for(const patch of [{width:0},{height:NaN},{availableWidth:0},{zoom:4},{width:1,height:Number.MAX_VALUE}])assert.throws(()=>pdfPageLayout({width:595,height:842,availableWidth:324,...patch}),/READING_PDF_INVALID/);
 assert.equal(pdfPageLayout({width:595,height:842,availableWidth:324,devicePixelRatio:NaN}).outputScale,1);
});
