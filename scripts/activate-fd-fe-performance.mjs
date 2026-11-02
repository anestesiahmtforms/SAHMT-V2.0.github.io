import {readFile} from 'node:fs/promises';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {targets,demand,google,protect,report} from './lib/fd-fe-release.js';
import {encodeFields,decodeFields} from '../worker-training/firestore.js';
const station=process.argv[2],target=targets[station];demand(target,'RELEASE_STATION_INVALID');
const cutover=JSON.parse(await readFile('docs/superpowers/reports/2026-11-01-'+station.toLowerCase()+'-cutover.json','utf8'));
demand(cutover.station===station&&cutover.originalModulePreserved===true,'RELEASE_CUTOVER_REQUIRED');
const token=await firebaseCliAccountToken(target.email);
demand((await google('https://cloudbilling.googleapis.com/v1/projects/'+target.project+'/billingInfo',token)).billingEnabled===false,'RELEASE_BILLING_MUST_BE_DISABLED');
const root='https://firestore.googleapis.com/v1/projects/'+target.project+'/databases/(default)/documents';
const path=station.toLowerCase()+'PerformanceRuntime/current',name='projects/'+target.project+'/databases/(default)/documents/'+path;
const previous=await google(root+'/'+path,token,undefined,'GET',true);
if(previous){
 const existing=decodeFields(previous.fields||{});
 demand(existing.enabled===true&&existing.projectId===target.project&&existing.automaticFbSync===false&&existing.historyImported===0,'RELEASE_RUNTIME_EXISTS');
 console.log(JSON.stringify({station,alreadyActive:true,effectiveFrom:existing.effectiveFrom}));
}else{
 await protect(station+'-runtime-before',{document:previous});
 // A short future cutoff drains old in-flight requests. Existing participation is never imported.
 const effectiveFrom=new Date(Date.now()+60000).toISOString();
 const config={schemaVersion:1,projectId:target.project,station,enabled:true,effectiveFrom,automaticFbSync:false,historyImported:0,mode:station+'_ONLY'};
 await google(root+':commit',token,{writes:[{update:{name,fields:encodeFields(config)},currentDocument:{exists:false}}]});
 const saved=decodeFields((await google(root+'/'+path,token)).fields);
 demand(JSON.stringify(saved)===JSON.stringify(config)||Object.entries(config).every(([k,v])=>saved[k]===v),'RELEASE_RUNTIME_READBACK_FAILED');
 const result={...config,configuredAt:new Date().toISOString(),approval:'User explicitly authorized immediate production activation on 2026-11-01',billingEnabled:false,pointsCreatedByActivation:0};
 await report('2026-11-01-'+station.toLowerCase()+'-performance-active',result);console.log(JSON.stringify(result));
}
