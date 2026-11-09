import {targets,unprotect,report,demand} from './lib/fd-fe-release.js';
import {indicatorServiceToken} from '../worker-indicators/auth.js';
import {feServiceToken} from '../worker-fe-surveys/auth.js';
import {createFirestoreStore as fdStore} from '../worker-indicators/store.js';
import {createFirestoreStore as feStore} from '../worker-training/firestore.js';
const result={at:new Date().toISOString(),stations:[],businessWrites:0};
for(const [station,target]of Object.entries(targets)){
 const credentials=await unprotect(station+'-service-key'),getAccessToken=(station==='FD'?indicatorServiceToken:feServiceToken)({credentials});
 const store=(station==='FD'?fdStore:feStore)({projectId:target.project,getAccessToken});
 const runtime=await store.transaction(tx=>tx.get((station==='FD'?'sahmt':'fe')+'PerformanceRuntime','current'));
 demand(runtime?.enabled===true&&runtime.projectId===target.project&&(station==='FD'||Date.parse(runtime.effectiveFrom)<=Date.now()&&runtime.automaticFbSync===false),'RELEASE_LIVE_RUNTIME_INVALID');
 const urls=station==='FD'?['https://sahmt-indicators.anestesiahmtforms4.workers.dev/v1/indicators']:['https://sahmt-fe-surveys.anestesiahmtforms5.workers.dev/v1/institutional-surveys','https://sahmt-html-training.anestesiahmtforms.workers.dev/v1/institutional-surveys'];
 const guards=[];
 for(const url of urls){const r=await fetch(url,{method:'POST',headers:{Origin:'https://anestesiahmtforms.github.io','Content-Type':'application/json'},body:JSON.stringify({action:station==='FD'?'GET_SAHMT_PERFORMANCE':'GET_PERFORMANCE',input:{}}),signal:AbortSignal.timeout(25000)});await r.body?.cancel();demand(r.status===401,'RELEASE_AUTH_GUARD_FAILED');guards.push({url,unauthenticatedStatus:r.status});}
 const sources=station==='FD'?{publishedBatch:(await store.get('sahmtPerformanceReference','current'))?.batchId||null}:await Promise.all(['climate','stress','epidemiological'].map(async kind=>({survey:kind,status:(await store.get(kind+'Cycles','2026'))?.status||'absent'})));
 result.stations.push({station,projectId:target.project,runtime,transactionReadVerified:true,guards,sources});
}
await report('2026-11-01-fd-fe-live-verification',result);console.log(JSON.stringify(result));
