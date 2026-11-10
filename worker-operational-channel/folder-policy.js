import {assertFolderReadable} from '../server/folder-read-policy.js';
function decodeFields(fields){
 const list=fields.disabled?.arrayValue;
 if(!list||typeof list!=='object')throw Error('POLICY_INVALID');
 const values=list.values??[];
 if(!Array.isArray(values)||values.some(value=>typeof value.stringValue!=='string'))throw Error('POLICY_INVALID');
 return {schemaVersion:Number(fields.schemaVersion?.integerValue),revision:Number(fields.revision?.integerValue),disabled:values.map(value=>value.stringValue)};
}
import {channelError} from '../src/provisional-channel-contract.js';
const folders={checklists:['operacao/checklist'],stations:['operacao/checklist'],labels:['operacao/etiquetas'],events:['operacao/eventos'],eventCatalogs:['operacao/eventos'],contacts:['operacao/pessoas'],eventMembers:['operacao/pessoas'],vacations:['operacao/escala/ferias'],scheduleDays:['operacao/escala','operacao/eventos','operacao/escala/ferias'],scheduleReleases:['operacao/escala','operacao/eventos','operacao/escala/ferias']};
export function channelReadFolders(body){
 if(['authorize','watch'].includes(body.action))return [];
 if(['bootstrap','recover'].includes(body.action))return [...new Set(Object.values(folders).flat())];
 if(body.action==='source'){const [kind,id]=String(body.path||'').split('/');if(kind==='users')return [];if(kind==='appConfig'&&id==='labelStaff')return ['operacao/etiquetas'];return folders[kind]||['operacao'];}
 return folders[body.collection]||['operacao'];
}
export function createChannelFolderCheck({fetchImpl=fetch,bearer,appCheckToken,body}){
 const ids=channelReadFolders(body);
 return async()=>{
  if(!ids.length)return;
  try{
   const response=await fetchImpl('https://firestore.googleapis.com/v1/projects/sahmt-17a16/databases/(default)/documents/runtimePolicy/folders',{headers:{Authorization:bearer,...(appCheckToken?{'X-Firebase-AppCheck':appCheckToken}:{})},redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(5000)});
   if(response.status===404){await response.body?.cancel();return;}
   if(!response.ok)throw Error('POLICY_UNAVAILABLE');
   const policy=decodeFields((await response.json()).fields||{});
   for(const id of ids)assertFolderReadable(policy,id);
  }catch(error){throw channelError(error.code==='FOLDER_DISABLED'?'CHANNEL_FOLDER_DISABLED':'CHANNEL_FOLDER_POLICY_UNAVAILABLE',error.code==='FOLDER_DISABLED'?403:503);}
 };
}
