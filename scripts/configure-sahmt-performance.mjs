// Dry-run by default. No credential is printed or persisted by this utility.
import {readFile} from 'node:fs/promises';
import {prepareSahmtConfiguration} from './lib/sahmt-performance-configuration.js';
import {indicatorServiceToken} from '../worker-indicators/auth.js';
import {createFirestoreStore} from '../worker-indicators/store.js';
const path=process.argv.find(value=>value.startsWith('--config='))?.slice(9);
if(!path)throw Error('Usage: node scripts/configure-sahmt-performance.mjs --config=PRIVATE_JSON [--apply] [--enable]');
const plan=prepareSahmtConfiguration(JSON.parse(await readFile(path,'utf8')));
console.log(JSON.stringify({code:'SAHMT_CONFIGURATION_PREPARED',generation:plan.generation,members:plan.members.length,enabled:process.argv.includes('--enable'),writes:plan.members.length+2}));
if(!process.argv.includes('--apply'))process.exit(0);
let credentials;try{credentials=JSON.parse(process.env.INDICATOR_SERVICE_ACCOUNT_JSON);}catch{throw Error('SAHMT_CONFIGURATION_CREDENTIAL_REQUIRED');}
const store=createFirestoreStore({getAccessToken:indicatorServiceToken({credentials})});
// Pause publication first. Retain the preceding private configuration in FD
// before replacing mappings; the backup is not exported to the local filesystem.
const before=await store.get('sahmtPerformanceRuntime','current'),previous=await store.list('sahmtPerformanceMembers',[],501);
await store.transaction(async tx=>{
 const current=await tx.get('sahmtPerformanceRuntime','current');if(JSON.stringify(current)!==JSON.stringify(before))throw Error('SAHMT_CONFIGURATION_DRIFT');
 tx.create('sahmtPerformanceConfigurationHistory',crypto.randomUUID(),{previousRuntime:before,previousMembers:previous,changedAt:Date.now(),nextGeneration:plan.generation});
 tx.set('sahmtPerformanceRuntime','current',plan.runtime);
});
const changes=[...plan.members,...previous.filter(old=>!plan.members.some(row=>row.uid===old.uid)).map(old=>({...old,active:false,access:false,directoryGeneration:plan.generation}))];
for(let index=0;index<changes.length;index+=100)await store.transaction(async tx=>{
 const current=await tx.get('sahmtPerformanceRuntime','current');if(current?.generation!==plan.generation||current.enabled!==false)throw Error('SAHMT_CONFIGURATION_DRIFT');
 for(const member of changes.slice(index,index+100))tx.set('sahmtPerformanceMembers',member.uid,member);
});
await store.transaction(async tx=>{
 const current=await tx.get('sahmtPerformanceRuntime','current');if(current?.generation!==plan.generation||current.enabled!==false)throw Error('SAHMT_CONFIGURATION_DRIFT');
 tx.set('sahmtPerformanceRuntime','current',{...plan.runtime,enabled:process.argv.includes('--enable')});
});
const after=await store.get('sahmtPerformanceRuntime','current');if(after?.generation!==plan.generation||after.enabled!==process.argv.includes('--enable'))throw Error('SAHMT_CONFIGURATION_READBACK_FAILED');
console.log(JSON.stringify({code:'SAHMT_CONFIGURATION_CONFIRMED',generation:after.generation,enabled:after.enabled}));
