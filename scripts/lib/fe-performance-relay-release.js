import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {sealPrivateJson,openPrivateJson} from './windows-protected-json.js';
import {createFePerformanceReader} from '../../worker-fe-surveys/performance-read.js';
export const FE_PERFORMANCE_READ_URL='https://sahmt-fe-surveys.anestesiahmtforms5.workers.dev/internal/performance-read';
export const FE_RELAY_SECRET_PATH='.local-preview/fd-fixed-sync/fe-performance-read-secret.dpapi.json';
export async function feRelaySecret({create=false}={}){
 let protectedValue;try{protectedValue=JSON.parse(await readFile(FE_RELAY_SECRET_PATH,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;if(!create)throw Error('FE_RELAY_PAIRING_REQUIRED');}
 if(protectedValue){const value=await openPrivateJson(protectedValue);if(!/^[A-Za-z0-9_-]{43}$/.test(value.secret||''))throw Error('FE_RELAY_SECRET_INVALID');return value.secret;}
 const secret=randomBytes(32).toString('base64url');await mkdir('.local-preview/fd-fixed-sync',{recursive:true});await writeFile(FE_RELAY_SECRET_PATH,JSON.stringify(await sealPrivateJson({secret})),{flag:'wx'});return secret;
}
export async function smokeFeRelay({secret,fetchImpl=fetch,now=Date.now}={}){
 const cutoff=new Date(now()-5000).toISOString(),reader=createFePerformanceReader({endpoint:FE_PERFORMANCE_READ_URL,secret,fetchImpl,now});
 const response=await reader({path:'/fePerformanceRuntime/current',cutoff});
 if(!response.ok){await response.body?.cancel();throw Error('FE_RELAY_AUTHENTICATED_SMOKE_FAILED_'+response.status);}
 const value=await response.json(),fields=value?.fields;
 if(value?.name!=='projects/outros-48120/databases/(default)/documents/fePerformanceRuntime/current'||fields?.projectId?.stringValue!=='outros-48120'||fields?.schemaVersion?.integerValue!=='1'||Object.keys(fields).some(k=>!['schemaVersion','projectId','enabled','effectiveFrom'].includes(k)))throw Error('FE_RELAY_SMOKE_CONTRACT_INVALID');
 return {authenticated:true,readTime:cutoff,piiRead:false};
}
export function feRelayMetadata(settings,secret){
 if(!settings.bindings?.some(b=>b.name==='FE_SERVICE_ACCOUNT_JSON'&&b.type==='secret_text'))throw Error('FE_RELAY_SERVICE_BINDING_REQUIRED');
 const metadata={main_module:'index.js',compatibility_date:settings.compatibility_date,compatibility_flags:settings.compatibility_flags,keep_bindings:['secret_text'],bindings:[...settings.bindings.filter(b=>b.type!=='secret_text'&&b.name!=='FE_PERFORMANCE_READ_SECRET'),{type:'secret_text',name:'FE_PERFORMANCE_READ_SECRET',text:secret}]};
 for(const key of ['usage_model','logpush','placement','tags','tail_consumers','observability','limits'])if(settings[key]!==undefined)metadata[key]=settings[key];
 return metadata;
}
