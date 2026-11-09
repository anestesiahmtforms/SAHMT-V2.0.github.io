// Explicit operational rollback. Keeps awards, responses, UIDs and service keys.
import {targets,demand,google,cloudflare,report} from './lib/fd-fe-release.js';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {createFaCloudflareClient} from './lib/fa-cloudflare-client.js';
const station=process.argv[2];demand(station==='FE'&&targets[station]&&process.argv[3]==='--apply','Usage: rollback-fd-fe-performance.mjs FE --apply');
const target=targets[station],token=await firebaseCliAccountToken(target.email);
const url='https://firestore.googleapis.com/v1/projects/'+target.project+'/databases/(default)/documents/'+station.toLowerCase()+'PerformanceRuntime/current';
const before=await google(url,token);demand(before.fields?.projectId?.stringValue===target.project,'ROLLBACK_PROJECT_MISMATCH');
await google(url+'?updateMask.fieldPaths=enabled&currentDocument.updateTime='+encodeURIComponent(before.updateTime),token,{fields:{enabled:{booleanValue:false}}},'PATCH');
const central=await createFaCloudflareClient(),path='/workers/scripts/'+'sahmt-html-training'+'/settings';
const settings=await central.request(path),flag=station+'_STATION_FORWARD_ENABLED';
const form=new FormData();form.set('settings',new Blob([JSON.stringify({bindings:settings.bindings.filter(b=>b.type!=='secret_text').map(b=>b.name===flag?{...b,text:'false'}:b),keep_bindings:['secret_text']})],{type:'application/json'}));
await central.request(path,{method:'PATCH',body:form});
const after=await central.request(path);demand(after.bindings.some(b=>b.name===flag&&b.text==='false'),'ROLLBACK_FORWARD_FLAG_FAILED');
const result={station,disabled:true,pointsDeleted:0,responsesDeleted:0,centralRouteRestored:true,at:new Date().toISOString()};
await report('fd-fe-rollback-'+station.toLowerCase(),result);console.log(JSON.stringify(result));
