import {googleFbClient} from './lib/google-fb-client.js';
import {prepareFbScript} from './lib/prepare-fb-script.js';
const folderId='1SiIvED7gjlsA0tA5SqGAUE3U3jCHRuSj',dir='.local-preview/fb-performance';
const {request}=await googleFbClient();
const folder=await request('https://www.googleapis.com/drive/v3/files/'+folderId+'?fields=id,mimeType,capabilities');
if(folder.id!==folderId||folder.mimeType!=='application/vnd.google-apps.folder'||folder.capabilities?.canAddChildren!==true)throw Error('FB_DRIVE_FOLDER_NOT_WRITABLE');
console.log(JSON.stringify(await prepareFbScript({request,dir,folderId})));
