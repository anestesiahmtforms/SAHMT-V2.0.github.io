import test from 'node:test';import assert from 'node:assert/strict';
import {imageTargetSize,documentSizeLabel} from '../src/document-image.js';
test('document images are reduced proportionally without upscaling',()=>{assert.deepEqual(imageTargetSize(4000,3000),{width:1600,height:1200});assert.deepEqual(imageTargetSize(800,1200),{width:800,height:1200});assert.deepEqual(imageTargetSize(3000,4000),{width:1200,height:1600});for(const x of [0,-1,Infinity,NaN])assert.throws(()=>imageTargetSize(x,100));});
test('readable size label',()=>{assert.equal(documentSizeLabel(1024),'1 KB');assert.equal(documentSizeLabel(1048576),'1,0 MB');});
