import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const original=await readFile(new URL('../src/label-ai.js',import.meta.url),'utf8');
const endpoint='https://sahmt-fh-etiquetas.sahmt-fh-f7b8a88b.workers.dev/v1/labels/extract';
function fixture({switchDuringImage=false,denied=false,configured=endpoint}={}){
 const calls=[],auth={currentUser:{uid:'u',getIdToken:()=>assert.fail('FH must use a destination token')}};
 const source=original.split('\n').filter(l=>!l.startsWith('import ')).join('\n').replaceAll('export ','').replaceAll('import.meta.env','configuration').replace("import('firebase/app-check')",'Promise.resolve(appCheckSdk)');
 const c=vm.createContext({configuration:{VITE_LABEL_AI_ENDPOINT:configured},auth,app:{},appCheckReady:Promise.resolve({}),fhImageEndpoint:endpoint,operationalModuleEnabled:s=>s==='FH',getOperationalModuleIdToken:async(s,uid)=>{assert.equal(s,'FH');assert.equal(uid,'u');if(denied)throw Error('MODULE_ACCESS_DENIED');return 'synthetic-fh-id';},Blob,URL,AbortSignal,appCheckSdk:{getToken:async()=>({token:'synthetic-fa-attestation'})},document:{createElement:()=>({width:1,height:1,getContext:()=>({drawImage(){}})})},fetch:async(url,options)=>{calls.push({url,options});return Response.json({patientName:'Synthetic'});}});
 vm.runInContext(source,c);c.loadImage=async()=>{if(switchDuringImage)auth.currentUser=null;return {naturalWidth:10,naturalHeight:10};};c.imageDataUrl=async()=> 'data:image/jpeg;base64,synthetic';
 return {c,calls};
}
test('FH image client sends the own leased token and central App Check only to the fixed FH endpoint',async()=>{
 const f=fixture();await f.c.extractLabelWithAi(new Blob(['fixture'],{type:'image/jpeg'}));assert.equal(f.calls.length,1);assert.equal(f.calls[0].url,endpoint);assert.equal(f.calls[0].options.headers.Authorization,'Bearer synthetic-fh-id');assert.equal(f.calls[0].options.headers['X-Firebase-AppCheck'],'synthetic-fa-attestation');assert.equal(f.calls[0].options.cache,'no-store');
});
test('FH image client refuses a legacy endpoint, denied destination or logout during photo processing',async()=>{
 for(const options of [{configured:'https://sahmt-label-ai.anestesiahmtforms.workers.dev/v1/labels/extract'},{denied:true},{switchDuringImage:true}]){const f=fixture(options);await assert.rejects(f.c.extractLabelWithAi(new Blob(['fixture'],{type:'image/jpeg'})));assert.equal(f.calls.length,0);}
});
