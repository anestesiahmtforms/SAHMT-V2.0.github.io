import test from 'node:test';
import assert from 'node:assert/strict';
import {assertFcModuleDeployment} from '../scripts/lib/fc-module-deployment.js';
import {cloudflareWorkerSource} from '../scripts/lib/cloudflare-worker-source.js';

async function multipart(value,name='worker.js',extra=false){
 const form=new FormData();form.append(name,value);
 if(extra)form.append('unexpected.js','unreviewed');
 const response=new Response(form);
 return {contentType:response.headers.get('Content-Type'),content:await response.text()};
}
test('worker comparison ignores changing transport boundaries',async()=>{
 const a=await multipart('export default{}'),b=await multipart('export default{}');
 assert.notEqual(a.contentType,b.contentType);
 assert.equal(await cloudflareWorkerSource(a),await cloudflareWorkerSource(b));
});
test('worker comparison detects actual source changes',async()=>{
 assert.notEqual(await cloudflareWorkerSource(await multipart('old')),await cloudflareWorkerSource(await multipart('changed')));
});
test('worker comparison rejects unexpected modules and content types',async()=>{
 await assert.rejects(cloudflareWorkerSource({contentType:'application/json',content:'{}'}),/SOURCE_FORMAT_INVALID/);
 await assert.rejects(cloudflareWorkerSource(await multipart('code','other.js')),/UNREVIEWED_MODULES/);
 await assert.rejects(cloudflareWorkerSource(await multipart('code','worker.js',true)),/UNREVIEWED_MODULES/);
});
test('worker comparison accepts a single uploaded module file',async()=>{
 const form=new FormData();form.append('worker.js',new Blob(['export default{}'],{type:'application/javascript+module'}),'worker.js');
 const response=new Response(form);
 assert.equal(await cloudflareWorkerSource({contentType:response.headers.get('Content-Type'),content:await response.text()}),'export default{}');
});

const before={deployments:[
 {deploymentId:'legacy',entryPoints:[{entryPointType:'WEB_APP'}]},
 {deploymentId:'fc-target',deploymentConfig:{scriptId:'script',versionNumber:45,description:'FC independent modules: QMENTUM and occurrences',manifestFileName:'appsscript'},entryPoints:[{entryPointType:'WEB_APP',webApp:{url:'target'}}]},
 {deploymentId:'fc-other',deploymentConfig:{scriptId:'script',versionNumber:45,description:'FC independent modules: QMENTUM and occurrences',manifestFileName:'appsscript'},entryPoints:[{entryPointType:'WEB_APP',webApp:{url:'other'}}]},
]};
const current={deployments:before.deployments.map(x=>structuredClone(x))};
current.deployments[1].deploymentConfig.versionNumber=46;

test('accepts advancing only the selected FC deployment',()=>{
 assert.equal(assertFcModuleDeployment({before,current,targetDeploymentId:'fc-target',versionNumber:46}),true);
});

test('rejects changes to another deployment or target configuration',()=>{
 const other=structuredClone(current);other.deployments[2].deploymentConfig.versionNumber=46;
 assert.throws(()=>assertFcModuleDeployment({before,current:other,targetDeploymentId:'fc-target',versionNumber:46}));
 const config=structuredClone(current);config.deployments[1].entryPoints[0].webApp.url='changed';
 assert.throws(()=>assertFcModuleDeployment({before,current:config,targetDeploymentId:'fc-target',versionNumber:46}));
});
