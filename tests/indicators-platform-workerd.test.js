import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {resolve} from 'node:path';

test('FD token exchange and profile reads use fetch options supported by workerd and reject redirects',async()=>{
 const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{format:'pem',type:'pkcs8'},publicKeyEncoding:{format:'pem',type:'spki'}});
 const credentials={project_id:'rotinas-8a617',client_email:'indicator-compiler@rotinas-8a617.iam.gserviceaccount.com',private_key:privateKey};
 const entry=`import {indicatorServiceToken} from './worker-indicators/auth.js';
 import {createIndicatorSources} from './worker-indicators/sources.js';
 export default {async fetch(request){
 const redirect=new URL(request.url).pathname==='/redirect';
 const fixtureFetch=async(url,options)=>{
  new Request(url,options);
  if(options.redirect!=='manual')throw Error('UNSAFE_REDIRECT');
  if(redirect)return new Response(null,{status:302,headers:{Location:'https://untrusted.invalid/'}});
  return url.includes('oauth2.googleapis.com')?Response.json({access_token:'synthetic-access-token',expires_in:3600}):Response.json({fields:{uid:{stringValue:'synthetic-user'}}});
 };
 const token=indicatorServiceToken({credentials:${JSON.stringify(credentials)},fetchImpl:fixtureFetch});
 try{const sources=createIndicatorSources({getAccessToken:token,fetchImpl:fixtureFetch});
 const profile=await sources.profile('FA','synthetic-user');return Response.json({uid:profile.uid});}
 catch(error){return Response.json({code:error.message},{status:503});}
 }};`;
 const bundle=await build({stdin:{contents:entry,resolveDir:resolve('.')},bundle:true,write:false,format:'esm',platform:'node',external:['node:crypto'],target:'es2022'});
 const mf=new Miniflare(convertV4MiniflareOptions({name:'indicator-fetch-contract',modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-13',compatibilityFlags:['nodejs_compat'],outboundService:async()=>assert.fail('No external requests permitted')}));
 try{
  const response=await mf.dispatchFetch('https://local.invalid/');
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{uid:'synthetic-user'});
  const redirect=await mf.dispatchFetch('https://local.invalid/redirect');
  assert.equal(redirect.status,503);assert.deepEqual(await redirect.json(),{code:'INDICATOR_SERVICE_AUTH_UNAVAILABLE'});
 }finally{await mf.dispose();}
});
