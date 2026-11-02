import {readFile,writeFile,mkdir} from 'node:fs/promises';

// The administrative drive.file grant cannot move a file created by Script API.
// Only that specific denial is delegated to the owner-executed installer.
export async function prepareFbScript({request,dir,folderId}){
 await mkdir(dir,{recursive:true});
 let state;try{state=JSON.parse(await readFile(dir+'/script-created.json','utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 if(!state){const created=await request('https://script.googleapis.com/v1/projects','POST',{title:'SAHMT — Desempenho FB exclusivo'});if(!created.scriptId)throw Error('FB_SCRIPT_CREATION_FAILED');state={scriptId:created.scriptId};await writeFile(dir+'/script-created.json',JSON.stringify(state));}
 if(!/^[A-Za-z0-9_-]+$/.test(state.scriptId||''))throw Error('FB_SCRIPT_ID_INVALID');
 const base='https://script.googleapis.com/v1/projects/'+state.scriptId;
 const content=JSON.parse(await readFile(dir+'/apps-script-bundle.json','utf8'));
 await request(base+'/content','PUT',content);
 const metadataUrl='https://www.googleapis.com/drive/v3/files/'+state.scriptId+'?fields=id,parents';
 const file=await request(metadataUrl);
 let folderMovement='VERIFIED';
 if(!file.parents?.includes(folderId)){
  try{await request('https://www.googleapis.com/drive/v3/files/'+state.scriptId+'?addParents='+folderId+(file.parents?.length?'&removeParents='+file.parents.join(','):''),'PATCH',{});}
  catch(e){if(e.status!==403||!e.reasons?.includes('appNotAuthorizedToFile'))throw e;folderMovement='OWNER_INSTALLER_REQUIRED';}
 }
 const verified=await request(metadataUrl);
 if(folderMovement==='VERIFIED'&&!verified.parents?.includes(folderId))throw Error('FB_SCRIPT_FOLDER_READBACK_FAILED');
 const live=await request(base+'/content');
 if(live.files?.length!==content.files.length||!content.files.every(f=>live.files.some(v=>v.name===f.name&&v.type===f.type&&v.source.replaceAll('\r\n','\n')===f.source.replaceAll('\r\n','\n'))))throw Error('FB_SCRIPT_CONTENT_READBACK_FAILED');
 const report={code:'FB_APPS_SCRIPT_PREPARED',scriptId:state.scriptId,folderId,executor:'anestesiahmtforms2@gmail.com',contentVerified:true,folderMovement,runtimeActivated:false,businessWrites:0,at:new Date().toISOString()};
 await writeFile(dir+'/apps-script-prepared.json',JSON.stringify(report,null,2));
 return report;
}
