import {createHash} from 'node:crypto';
import {copyFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';
import {prepareSecondaryDomainRelease} from './prepare-secondary-domain-release.mjs';
import {createDisabledManagementGatewayConfig, validateDisabledManagementGatewayConfig} from './lib/management-gateway-config-preparation.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source=async path=>readFile(resolve(root,path),'utf8');
const packageJson=JSON.parse(await source('package.json'));
const run=label=>{
  let args;
  if(label==='test:management')args=['scripts/test-management.mjs'];
  else if(label==='test:worker-platform')args=['--test','worker-management-auth/worker.test.js','tests/worker-management-auth-admission-state.test.js','tests/management-worker-platform.test.js'];
  else if(label==='test:domain'||label==='test:secondary-domain')args=packageJson.scripts[label].split(' ').slice(1);
  else if(label==='build')args=['node_modules/vite/bin/vite.js','build'];
  else throw new Error('PREPARATION_STAGE_INVALID');
  const result=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit',shell:false,env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
  return Object.freeze({stage:label,ok:!result.error&&result.status===0,code:result.error?'PROCESS_START_FAILED':result.status===0?'OK':'COMMAND_FAILED'});
};
const gateway=await source('apps-script-management-gateway/Gateway.gs');
const manifest=JSON.parse(await source('apps-script-management-gateway/appsscript.json'));
const wrangler=await source('worker-management-auth/wrangler.toml');
const envExample=await source('.env.example');
new vm.Script(gateway,{filename:'Gateway.gs'});
const names=[...gateway.matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map(m=>m[1]);
const duplicates=[...new Set(names.filter((name,index)=>names.indexOf(name)!==index))];
if(duplicates.length)throw new Error('GATEWAY_DUPLICATE_FUNCTIONS');
const required=['doPost','provarAssinaturaIamFaSinteticaV1','provarAssinaturaIamFbSinteticaV1','provarAssinaturaIamFcSinteticaV1','mgwDataOperation_'];
if(required.some(name=>names.filter(candidate=>candidate===name).length!==1))throw new Error('GATEWAY_FUNCTION_SET_INVALID');
const scopes=['https://www.googleapis.com/auth/identitytoolkit','https://www.googleapis.com/auth/iam',
  'https://www.googleapis.com/auth/script.external_request','https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/datastore'];
if(JSON.stringify(manifest.oauthScopes)!==JSON.stringify(scopes))throw new Error('GATEWAY_MANIFEST_SCOPES_INVALID');
for(const flag of ['MANAGEMENT_AUTH_ENABLED','MANAGEMENT_AUTH_FB_ENABLED','MANAGEMENT_AUTH_FC_ENABLED',
  'MANAGEMENT_DOMAIN_ENABLED','OCCURRENCE_SCORING_ENABLED','MANAGEMENT_AUTH_PILOT_ONLY','MANAGEMENT_AUTH_FC_PILOT_PROVISION','MANAGEMENT_FIRST_LOGIN_ENABLED','MANAGEMENT_GATEWAY_ENABLED'])
  if(!new RegExp('^'+flag+'\\s*=\\s*"false"\\s*$','m').test(wrangler))throw new Error('WORKER_DEFAULT_FLAG_NOT_OFF');
for(const flag of ['VITE_MANAGEMENT_FIREBASE_ENABLED','VITE_INDICATORS_FIREBASE_ENABLED','VITE_FIREBASE_PROJECT_AUTH_ENABLED',
  'VITE_FIREBASE_PROJECT_AUTH_AUTO_CONNECT_ENABLED','VITE_MANAGEMENT_FA_FIRST_LOGIN_ENABLED'])
  if(!new RegExp('^'+flag+'=false\\s*$','m').test(envExample))throw new Error('PWA_DEFAULT_FLAG_NOT_OFF');
for(const flag of ['VITE_MANAGEMENT_DATA_PROJECT','VITE_EVALUATION_DATA_PROJECT'])
  if(!new RegExp('^'+flag+'=FA\\s*$','m').test(envExample))throw new Error('DOMAIN_CUTOVER_DEFAULT_NOT_FA');
const safeConfig=createDisabledManagementGatewayConfig({actorEmail:'local-preparation@example.invalid',includeRuntimeOperations:true});
validateDisabledManagementGatewayConfig(safeConfig.config);
if(safeConfig.config.enabled!==false||Object.values(safeConfig.config.policy.enabledOperations).some(Boolean))throw new Error('GATEWAY_DISABLED_TEMPLATE_INVALID');
const checks=[];
for(const stage of ['test:management','test:worker-platform','test:domain','test:secondary-domain','build'])checks.push(run(stage));
const output=resolve(root,'.local-preview','management-auth-runtime');await mkdir(output,{recursive:true});
const bundlePath=resolve(output,'worker.js');
await build({entryPoints:[resolve(root,'worker-management-auth/worker.js')],outfile:bundlePath,bundle:true,format:'esm',platform:'node',target:'es2022',external:['node:*']});
await copyFile(resolve(root,'apps-script-management-gateway/Gateway.gs'),resolve(output,'Gateway.gs'));
await copyFile(resolve(root,'apps-script-management-gateway/appsscript.json'),resolve(output,'appsscript.json'));
await copyFile(resolve(root,'worker-management-auth/wrangler.toml'),resolve(output,'wrangler.toml'));
await writeFile(resolve(output,'gateway-config.disabled.template.json'),safeConfig.canonicalJson+'\n',{flag:'w'});
const files=['Gateway.gs','appsscript.json','wrangler.toml','worker.js','gateway-config.disabled.template.json'];
const hashes={};for(const name of files)hashes[name]=createHash('sha256').update(await readFile(resolve(output,name))).digest('hex');
const domainPackage=await prepareSecondaryDomainRelease(root);
const externallyMissing=['GATEWAY_SCRIPT_DEPLOYMENT_URL','GATEWAY_HMAC_SECRET_INSTALLATION','GATEWAY_SCRIPT_PROPERTIES',
  'FA_PROTECTED_IDENTITIES_UIDS','FA_COHORT_CLASSIFICATION','WORKER_REMOTE_DURABLE_OBJECT_NAMESPACE',
  'WORKER_SECRET_AND_POLICY_BINDINGS','WORKER_PILOT_UID_ALLOWLIST','PWA_PRODUCTION_ENDPOINT_CONFIGURATION','FB_FC_AUTH_USER_PROVISIONING',
  'FA_FIRESTORE_READ_IDENTITY_AND_PERMISSION_EVIDENCE'];
const report={schemaVersion:1,localPreparation:checks.every(result=>result.ok)?'PASS':'FAIL',checks,workerBundle:'PASS',gatewaySyntax:'PASS',
  gatewayFunctionCount:names.length,duplicateFunctions:0,oauthScopeCount:manifest.oauthScopes.length,
  domainPackage:{syntax:domainPackage.syntax,operationalFiles:domainPackage.operationalFiles,requiredCompositeIndexes:domainPackage.requiredCompositeIndexes,retirementEnabled:false},
  defaultFlags:'ALL_OFF',deploymentPerformed:false,externalReadiness:'NOT_RECHECKED',externalVerificationRequired:externallyMissing,
  artifactDirectory:'.local-preview/management-auth-runtime',sha256:hashes};
await writeFile(resolve(output,'preparation-report.json'),JSON.stringify(report,null,2)+'\n',{flag:'w'});
console.log(JSON.stringify({localPreparation:report.localPreparation,checks,workerBundle:report.workerBundle,
  externalReadiness:report.externalReadiness,missingCount:externallyMissing.length,deploymentPerformed:false}));
if(checks.some(result=>!result.ok))process.exitCode=1;
