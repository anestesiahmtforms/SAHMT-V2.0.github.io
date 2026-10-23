import test from 'node:test';
import assert from 'node:assert/strict';
import {assertFcModuleDeployment} from '../scripts/lib/fc-module-deployment.js';

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
