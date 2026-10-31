import test from 'node:test';
import assert from 'node:assert/strict';
import {planAppPublication,prepareAppPublication,assertAppPublicationCurrent} from '../scripts/lib/app-publication.js';
import {build} from 'esbuild';
const old='8ca87a6e2382bf26ad15c6ca1e0b334cd25e378d',next='a'.repeat(40),release=1793453478943;
const legacy={schema:1,appVersion:'V2.2',targets:{FA:release,FB:release}};
const metadata={...legacy,sourceRevision:old};
const input={metadata,deployedRevision:old,sourceRevision:next,comparison:'ahead',now:release+100};

test('a new successful publication advances V2.2 once and retries reuse the published version and release',()=>{
 assert.deepEqual(planAppPublication(input),{schema:1,appVersion:'V2.3',sourceRevision:next,release:release+100});
 assert.equal(planAppPublication({...input,metadata:legacy}).appVersion,'V2.3');
 assert.equal(planAppPublication({...input,metadata:{...metadata,appVersion:'V2.9'}}).appVersion,'V2.10');
 assert.deepEqual(planAppPublication({...input,sourceRevision:old,comparison:'identical'}),{schema:1,appVersion:'V2.2',sourceRevision:old,release});
 assert.equal(planAppPublication({...input,now:release-1}).release,release+1);
});

test('stale, unproven or diverged publication state never assigns a new version',()=>{
 for(const change of [{deployedRevision:next},{comparison:'behind'},{comparison:'diverged'},{metadata:{...legacy,appVersion:'V2.3'}},{metadata:{...metadata,targets:{FA:release,FB:release-1}}},{metadata:{...metadata,appVersion:'bad'}},{sourceRevision:'not-a-sha'}])assert.throws(()=>planAppPublication({...input,...change}));
});

function remote({meta=metadata,compare='ahead',failedFirst=false,deployed=old}={}){
 const calls=[];return {calls,fetchImpl:async(url,options)=>{
  const u=new URL(url);calls.push({url,options});
  if(u.pathname.endsWith('/deployments'))return Response.json([...(failedFirst?[{id:3,sha:'b'.repeat(40),environment:'github-pages'}]:[]),{id:2,sha:deployed,environment:'github-pages'}]);
  if(u.pathname.endsWith('/3/statuses'))return Response.json([{state:'failure'}]);
  if(u.pathname.endsWith('/2/statuses'))return Response.json([{state:'success'}]);
  if(u.pathname.includes('/compare/'))return Response.json({status:compare});
  if(u.pathname.endsWith('/tools/app-release.json')){assert.equal(options.headers.Authorization,undefined);return Response.json(meta);}
  assert.fail('Unexpected URL '+url);
 }};
}

test('only successful deployments count; preparation is read-only and fixed to the app repository',async()=>{
 const fixture=remote({failedFirst:true});const plan=await prepareAppPublication({sourceRevision:next,repository:'anestesiahmtforms/SAHMT-V2.0.github.io',token:'fixture-token',fetchImpl:fixture.fetchImpl,now:release+100});
 assert.equal(plan.appVersion,'V2.3');assert.ok(fixture.calls.every(call=>!call.options.method||call.options.method==='GET'));
 assert.ok(fixture.calls.filter(call=>new URL(call.url).hostname==='api.github.com').every(call=>call.options.headers.Authorization==='Bearer fixture-token'));
 await assert.rejects(prepareAppPublication({sourceRevision:next,repository:'other/repo',fetchImpl:()=>assert.fail('foreign repository')}));
});

test('preparation fails closed on mismatched CDN metadata and unavailable source state',async()=>{
 const stale=remote({meta:{...metadata,sourceRevision:next}});
 await assert.rejects(prepareAppPublication({sourceRevision:next,repository:'anestesiahmtforms/SAHMT-V2.0.github.io',fetchImpl:stale.fetchImpl,now:release+100}),/PUBLICATION/);
 await assert.rejects(prepareAppPublication({sourceRevision:next,repository:'anestesiahmtforms/SAHMT-V2.0.github.io',fetchImpl:async()=>new Response('{}',{status:503}),now:release+100}),/PUBLICATION/);
});

test('the version embedded by the build is the same value written in actual device receipts',async()=>{
 const result=await build({stdin:{contents:"export {APP_VERSION} from './src/app-version.js';export {createTargetedAppUpdates} from './src/app-updates-targeted.js';",resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'browser',define:{'import.meta.env':JSON.stringify({VITE_APP_VERSION:'V2.23',VITE_APP_RELEASE:'123'})}});
 const module=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64')),records=[];
 assert.equal(module.APP_VERSION,'V2.23');
 const controller=module.createTargetedAppUpdates({target:'FA',release:123,deviceId:'fixture',platform:'Android',displayMode:'standalone',record:value=>records.push(value),enforce:()=>{}});
 controller.setSession({status:'signed-in',user:{uid:'fixture'},profile:{uid:'fixture'},offline:false});await new Promise(setImmediate);
 assert.equal(records[0].appVersion,'V2.23');assert.equal(records[0].loadedRelease,123);
});

test('a deploy-only retry cannot publish an obsolete artifact after another revision has advanced production',async()=>{
 const plan=planAppPublication(input),options={repository:'anestesiahmtforms/SAHMT-V2.0.github.io'};
 await assert.doesNotReject(assertAppPublicationCurrent({...options,plan,fetchImpl:remote().fetchImpl}));
 const published={schema:1,sourceRevision:next,appVersion:'V2.3',targets:{FA:plan.release,FB:plan.release}};
 await assert.doesNotReject(assertAppPublicationCurrent({...options,plan,fetchImpl:remote({meta:published,deployed:next}).fetchImpl}));
 const other='b'.repeat(40),newer={...published,sourceRevision:other};
 await assert.rejects(assertAppPublicationCurrent({...options,plan,fetchImpl:remote({meta:newer,deployed:other,compare:'behind'}).fetchImpl}),/PUBLICATION/);
 await assert.rejects(assertAppPublicationCurrent({...options,plan,fetchImpl:remote({meta:newer,deployed:other,compare:'ahead'}).fetchImpl}),/PUBLICATION/);
});
