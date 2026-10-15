import {readFile} from 'node:fs/promises';import {resolve} from 'node:path';
const demand=(value,code)=>{if(!value)throw Error(code);};
export async function createConsolidationScriptClient({fetchImpl=fetch}={}){
 const session=JSON.parse(await readFile(resolve(process.env.USERPROFILE,'.clasprc.json'),'utf8')).tokens?.default;
 const target=JSON.parse(await readFile(resolve(process.env.USERPROFILE,'Documents','ChatGPT','FIRESTORE','apps-script-v2','.clasp.json'),'utf8'));
 demand(session?.refresh_token&&target.scriptId==='1ReIZEXaVspXDYFP3u5g4pJNPKVOsrafNWACmsPVIbgq85Zav9sjkR4bD','CONSOLIDATION_SCRIPT_SESSION_INVALID');
 let token=session.access_token;
 if(!token||session.expiry_date<Date.now()+60000){
  const response=await fetchImpl('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
   body:new URLSearchParams({client_id:session.client_id,client_secret:session.client_secret,refresh_token:session.refresh_token,grant_type:'refresh_token'}),
   redirect:'error',signal:AbortSignal.timeout(15000)});
  demand(response.ok,'CONSOLIDATION_SCRIPT_REAUTH_REQUIRED');token=(await response.json()).access_token;
 }
 const identity=await fetchImpl('https://www.googleapis.com/oauth2/v2/userinfo',{method:'GET',headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(15000)});
 demand(identity.ok,'CONSOLIDATION_SCRIPT_IDENTITY_UNAVAILABLE');const user=await identity.json();
 demand(user.email==='anestesiahmtforms@gmail.com'&&user.verified_email===true,'CONSOLIDATION_SCRIPT_IDENTITY_MISMATCH');
 const base='https://script.googleapis.com/v1/projects/'+target.scriptId;
 const request=async(path,method='GET',body)=>{
  const response=await fetchImpl(base+path,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},
   ...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(30000)});
  demand(response.ok,'CONSOLIDATION_SCRIPT_HTTP_'+response.status);return response.json();
 };
 return Object.freeze({readContent:()=>request('/content'),readDeployments:()=>request('/deployments'),
  updateContent:content=>request('/content','PUT',{files:content.files.map(({name,type,source})=>({name,type,source}))}),
  createVersion:()=>request('/versions','POST',{description:'FA consolidation: management and performance; source databases preserved'}),
  updateDeployment:(deployment,versionNumber)=>{
   demand(deployment?.deploymentId&&Number.isSafeInteger(versionNumber)&&versionNumber>0,'CONSOLIDATION_SCRIPT_DEPLOYMENT_INVALID');
   return request('/deployments/'+encodeURIComponent(deployment.deploymentId),'PUT',{deploymentConfig:{
    ...deployment.deploymentConfig,versionNumber,description:'FA consolidation: management and performance'}});
  }
 });
}
