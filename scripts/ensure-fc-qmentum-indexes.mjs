import {readFile} from 'node:fs/promises';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';

const PROJECT='indicadores---sahmt',DATABASE='(default)';
const demand=(ok,code)=>{if(!ok)throw Error(code);};
async function call(token,url,method='GET',body){
 const response=await fetch(url,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error('FC_INDEX_HTTP_'+response.status);
 return response.json();
}
const canonical=index=>JSON.stringify({queryScope:index.queryScope,fields:index.fields.filter(field=>field.fieldPath!=='__name__').map(({fieldPath,order,arrayConfig})=>({fieldPath,order:order||null,arrayConfig:arrayConfig||null}))});
const group=index=>index.collectionGroup||index.name?.match(/collectionGroups\/([^/]+)\/indexes\//)?.[1]||null;
async function main(){
 const token=await firebaseCliAccountToken('anestesiahmtforms3@gmail.com');
 const billing=await call(token,'https://cloudbilling.googleapis.com/v1/projects/'+PROJECT+'/billingInfo');
 demand(billing.billingEnabled===false,'FC_INDEX_BILLING_ENABLED');
 const expected=JSON.parse(await readFile(new URL('../firestore.qmentum.indexes.json',import.meta.url),'utf8')).indexes;
 demand(expected.length===2&&expected.every(index=>['months','quarterlyAnalyses'].includes(index.collectionGroup)),'FC_INDEX_PLAN_INVALID');
 const root='https://firestore.googleapis.com/v1/projects/'+PROJECT+'/databases/'+encodeURIComponent(DATABASE);
 const live=await call(token,root+'/collectionGroups/-/indexes');
 const all=live.indexes||[],created=[];
 for(const spec of expected){
  const parent=root+'/collectionGroups/'+encodeURIComponent(spec.collectionGroup);
  const wanted=canonical(spec),found=all.find(item=>group(item)===spec.collectionGroup&&canonical(item)===wanted);
  if(found)continue;
  const operation=await call(token,parent+'/indexes','POST',{queryScope:spec.queryScope,fields:spec.fields});
  demand(typeof operation.name==='string'&&operation.name.includes('/operations/'),'FC_INDEX_OPERATION_INVALID');
  created.push({collectionGroup:spec.collectionGroup,operation:operation.name});
 }
 const check=await call(token,root+'/collectionGroups/-/indexes');
 const matching=expected.map(spec=>({spec,index:(check.indexes||[]).find(item=>group(item)===spec.collectionGroup&&canonical(item)===canonical(spec))}));
 const missing=matching.filter(item=>!item.index),building=matching.filter(item=>item.index&&item.index.state!=='READY');
 demand(missing.length===0,'FC_INDEX_POSTCHECK_PENDING');
 if(building.length){console.log(JSON.stringify({code:'FC_QMENTUM_INDEXES_BUILDING',project:PROJECT,expected:expected.length,created:created.length,building:building.length,states:building.map(item=>item.index.state),billingEnabled:false,deleted:0}));return;}
 console.log(JSON.stringify({code:'FC_QMENTUM_INDEXES_READY',project:PROJECT,expected:expected.length,created:created.length,existingIndexCount:all.length,totalIndexCount:check.indexes?.length||0,billingEnabled:false,deleted:0}));
}
main().catch(error=>{const code=/^FC_INDEX_[A-Z0-9_]+$/.test(error.message||'')?error.message:'FC_QMENTUM_INDEX_SETUP_FAILED';console.error(JSON.stringify({code,deleted:0}));process.exitCode=1;});
