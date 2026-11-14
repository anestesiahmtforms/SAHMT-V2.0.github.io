// Upload FK's standalone Apps Script source and update only its existing Worker-linked deployment.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const scriptId='1j2gEzrWUxS5ktin4e38LG_ocLG2bHeP_vHl0lIua2aYA-pX1n2iz5hQr';
const owner='anestesiahmtaula@gmail.com';
const api='https://script.googleapis.com/v1/projects/'+scriptId;
const apply=process.argv.includes('--apply');
const demand=(ok,code)=>{if(!ok)throw Error(code);};

async function request(url,token,{method='GET',body}={}){
  const response=await fetch(url,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(30000)});
  const value=await response.json().catch(()=>({}));
  if(!response.ok)throw Error('APPS_SCRIPT_API_'+response.status);
  return value;
}
async function tokenForOwner(){
  const path=resolve(process.env.USERPROFILE||'C:/Users/HYPER-IA','.clasprc.json');
  const credentials=JSON.parse(await readFile(path,'utf8')).tokens?.default;
  demand(credentials?.client_id&&credentials?.client_secret&&credentials?.refresh_token,'CLASP_SESSION_UNAVAILABLE');
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({client_id:credentials.client_id,client_secret:credentials.client_secret,
      refresh_token:credentials.refresh_token,grant_type:'refresh_token'}),redirect:'error',signal:AbortSignal.timeout(20000)});
  const value=await response.json().catch(()=>({}));
  demand(response.ok&&value.access_token,'CLASP_SESSION_REFRESH_FAILED');
  const identity=await request('https://www.googleapis.com/oauth2/v2/userinfo',value.access_token);
  demand(identity.email===owner&&identity.verified_email===true,'APPS_SCRIPT_OWNER_MISMATCH');
  return value.access_token;
}

try{
  const token=await tokenForOwner();
  const [project,content,deployments,localSource,localManifest,workerConfig]=await Promise.all([
    request(api,token),request(api+'/content',token),request(api+'/deployments',token),
    readFile(new URL('../apps-script-functional/Gateway.gs',import.meta.url),'utf8'),
    readFile(new URL('../apps-script-functional/appsscript.json',import.meta.url),'utf8'),
    readFile(new URL('../worker-functional-auth/wrangler.toml',import.meta.url),'utf8')
  ]);
  demand(project.scriptId===scriptId&&project.title==='SAHMT Funcional FK','APPS_SCRIPT_PROJECT_MISMATCH');
  const deployedUrl=workerConfig.match(/^APPS_SCRIPT_URL\s*=\s*"([^"]+)"/m)?.[1];
  demand(deployedUrl,'FK_WORKER_SCRIPT_URL_MISSING');
  const candidates=(deployments.deployments||[]).filter(item=>item.entryPoints?.some(entry=>
    entry.entryPointType==='WEB_APP'&&entry.webApp?.url===deployedUrl));
  demand(candidates.length===1,'FK_WEB_APP_DEPLOYMENT_AMBIGUOUS');
  const deployment=candidates[0],config=deployment.deploymentConfig||{};
  demand(config.scriptId===scriptId&&Number.isInteger(config.versionNumber)&&config.manifestFileName,
    'FK_WEB_APP_DEPLOYMENT_INVALID');
  const code=content.files?.find(file=>file.name==='Gateway'&&file.type==='SERVER_JS');
  const manifest=content.files?.find(file=>file.name==='appsscript'&&file.type==='JSON');
  demand(code&&manifest&&content.files.length===2,'FK_APPS_SCRIPT_FILES_UNEXPECTED');
  const desired=localSource.replace(/^\uFEFF/,'').replaceAll('\r\n','\n').trimEnd();
  const current=String(code.source||'').replaceAll('\r\n','\n').trimEnd();
  const manifestText=localManifest.replace(/^\uFEFF/,'').replaceAll('\r\n','\n').trimEnd();
  const currentManifest=String(manifest.source||'').replaceAll('\r\n','\n').trimEnd();
  const summary={scriptId,projectTitle:project.title,owner,workerUrlMatched:true,deploymentId:deployment.deploymentId,
    liveVersion:config.versionNumber,sourceAlreadyCurrent:current===desired,manifestAlreadyCurrent:currentManifest===manifestText,
    customLoginCodeStillPresent:/AUTH_SESSION|signInWithCustomToken|createFkCustomToken_/.test(current)};
  if(!apply){
    console.log(JSON.stringify({code:summary.sourceAlreadyCurrent?'FK_APPS_SCRIPT_CURRENT':'FK_APPS_SCRIPT_UPDATE_REQUIRED',...summary}));
  }else{
    await request(api+'/content',token,{method:'PUT',body:{scriptId,files:[
      {name:'appsscript',type:'JSON',source:manifestText},{name:'Gateway',type:'SERVER_JS',source:desired}
    ]}});
    const version=await request(api+'/versions',token,{method:'POST',body:{description:'FK: mensagens individuais de valorização profissional'}});
    demand(Number.isInteger(version.versionNumber)&&version.versionNumber>config.versionNumber,'FK_APPS_SCRIPT_VERSION_INVALID');
    const deploymentConfig={scriptId,versionNumber:version.versionNumber,manifestFileName:config.manifestFileName,
      description:config.description||'SAHMT Funcional FK - snapshots e pesquisas'};
    const updated=await request(api+'/deployments/'+encodeURIComponent(deployment.deploymentId),token,
      {method:'PUT',body:{deploymentConfig}});
    demand(updated.deploymentConfig?.versionNumber===version.versionNumber&&updated.entryPoints?.some(entry=>
      entry.entryPointType==='WEB_APP'&&entry.webApp?.url===deployedUrl),'FK_APPS_SCRIPT_DEPLOYMENT_READBACK_FAILED');
    console.log(JSON.stringify({code:'FK_APPS_SCRIPT_DEPLOYED',...summary,newVersion:version.versionNumber,
      sameWebAppUrl:true,firestoreProject:'sahmt-funcional-fk'}));
  }
}catch(error){
  console.error(/^[A-Z_0-9]+$/.test(error.message)?error.message:'FK_APPS_SCRIPT_RELEASE_FAILED');process.exitCode=1;
}
