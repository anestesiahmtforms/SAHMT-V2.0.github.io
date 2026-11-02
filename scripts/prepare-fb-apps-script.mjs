import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {googleFbClient} from './lib/google-fb-client.js';
const folderId='1SiIvED7gjlsA0tA5SqGAUE3U3jCHRuSj',dir='.local-preview/fb-performance';
const {request}=await googleFbClient();
const folder=await request('https://www.googleapis.com/drive/v3/files/'+folderId+'?fields=id,mimeType,capabilities');
if(folder.id!==folderId||folder.mimeType!=='application/vnd.google-apps.folder'||folder.capabilities?.canAddChildren!==true)throw Error('FB_DRIVE_FOLDER_NOT_WRITABLE');
await mkdir(dir,{recursive:true});
let state;try{state=JSON.parse(await readFile(dir+'/script-created.json','utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
if(!state){const created=await request('https://script.googleapis.com/v1/projects','POST',{title:'SAHMT — Desempenho FB exclusivo'});if(!created.scriptId)throw Error('FB_SCRIPT_CREATION_FAILED');state={scriptId:created.scriptId};await writeFile(dir+'/script-created.json',JSON.stringify(state));}
const base='https://script.googleapis.com/v1/projects/'+state.scriptId;
const content=JSON.parse(await readFile(dir+'/apps-script-bundle.json','utf8'));
await request(base+'/content','PUT',content);
const file=await request('https://www.googleapis.com/drive/v3/files/'+state.scriptId+'?fields=id,parents');
if(!file.parents?.includes(folderId))await request('https://www.googleapis.com/drive/v3/files/'+state.scriptId+'?addParents='+folderId+(file.parents?.length?'&removeParents='+file.parents.join(','):''),'PATCH',{});
const verified=await request('https://www.googleapis.com/drive/v3/files/'+state.scriptId+'?fields=id,parents');if(!verified.parents?.includes(folderId))throw Error('FB_SCRIPT_FOLDER_READBACK_FAILED');
const live=await request(base+'/content');if(!content.files.every(f=>live.files.some(v=>v.name===f.name&&v.type===f.type&&v.source.replaceAll('\r\n','\n')===f.source.replaceAll('\r\n','\n'))))throw Error('FB_SCRIPT_CONTENT_READBACK_FAILED');
const report={code:'FB_APPS_SCRIPT_PREPARED',scriptId:state.scriptId,folderId,executor:'anestesiahmtforms2@gmail.com',contentVerified:true,runtimeActivated:false,triggers:0,businessWrites:0,at:new Date().toISOString()};
await writeFile(dir+'/apps-script-prepared.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
