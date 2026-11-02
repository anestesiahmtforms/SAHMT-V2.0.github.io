import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {openPrivateJson,sealPrivateJson} from './windows-protected-json.js';
export const FA_SCRIPT='1ReIZEXaVspXDYFP3u5g4pJNPKVOsrafNWACmsPVIbgq85Zav9sjkR4bD';
export async function googleFaPerformanceClient(){
 const file=resolve('../../fc-isolation/.private/google-fa.dpapi.json');let saved=await openPrivateJson(JSON.parse(await readFile(file,'utf8')));
 if(saved.alias!=='FA'||saved.email!=='anestesiahmtforms@gmail.com')throw Error('FA_GOOGLE_IDENTITY_INVALID');
 const {getAuthorizedOAuth2Client}=await import('../../../'+ '../fc-isolation/tooling/node_modules/@google/clasp/build/src/auth/auth.js');
 const client=await getAuthorizedOAuth2Client({async load(){return saved.credentials;},async save(alias,credentials){if(alias!=='FA')throw Error('FA_ALIAS_INVALID');saved={...saved,credentials};await writeFile(file,JSON.stringify(await sealPrivateJson(saved)));}},'FA');
 const request=async(url,method='GET',data)=>{try{return(await client.request({url,method,...(data===undefined?{}:{data}),retry:false})).data;}catch(e){throw Error('FA_GOOGLE_HTTP_'+Number(e.response?.status||0));}};
 const identity=await request('https://www.googleapis.com/oauth2/v2/userinfo');if(identity.email!==saved.email||identity.verified_email!==true)throw Error('FA_GOOGLE_IDENTITY_MISMATCH');return {request};
}
