import {readFile,writeFile} from 'node:fs/promises';
import {openPrivateJson,sealPrivateJson} from './windows-protected-json.js';
export async function googleFbClient(){
 const path='.local-preview/.private/google-fb.dpapi.json';let saved=await openPrivateJson(JSON.parse(await readFile(path,'utf8')));
 if(saved.alias!=='FB'||saved.email!=='anestesiahmtforms2@gmail.com')throw Error('FB_GOOGLE_LOGIN_REQUIRED');
 const {getAuthorizedOAuth2Client}=await import('../../../../fc-isolation/tooling/node_modules/@google/clasp/build/src/auth/auth.js');
 const client=await getAuthorizedOAuth2Client({async load(){return saved.credentials;},async save(alias,credentials){if(alias!=='FB')throw Error('FB_OAUTH_ALIAS_INVALID');saved={...saved,credentials};await writeFile(path,JSON.stringify(await sealPrivateJson(saved)));}},'FB');
 const request=async(url,method='GET',data)=>{
  const u=new URL(url);
  const allowed=u.origin==='https://script.googleapis.com'&&/^\/v1\/projects(?:\/[A-Za-z0-9_-]+(?:\/content|\/versions|\/deployments(?:\/[A-Za-z0-9_-]+)?)?)?$/.test(u.pathname)&&['GET','POST','PUT'].includes(method)
   ||u.origin==='https://www.googleapis.com'&&u.pathname==='/oauth2/v2/userinfo'&&method==='GET'
   ||u.origin==='https://www.googleapis.com'&&/^\/drive\/v3\/files\/[A-Za-z0-9_-]+$/.test(u.pathname)&&['GET','PATCH'].includes(method);
  if(!allowed)throw Error('FB_ADMIN_ENDPOINT_DENIED');
  try{return (await client.request({url,method,...(data!==undefined?{data}:{}),retry:false})).data;}
  catch(e){const msg=String(e.response?.data?.error?.message||'');const error=Error(/User has not enabled the Apps Script API/i.test(msg)?'FB_APPS_SCRIPT_API_USER_DISABLED':'FB_ADMIN_HTTP_'+Number(e.response?.status||0));error.status=Number(e.response?.status||0);throw error;}
 };
 const identity=await request('https://www.googleapis.com/oauth2/v2/userinfo');
 if(identity.email!==saved.email||identity.verified_email!==true)throw Error('FB_GOOGLE_IDENTITY_MISMATCH');
 return {request,email:identity.email};
}
