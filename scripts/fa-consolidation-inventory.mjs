import {mkdir,writeFile,readFile,lstat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createPrivateJsonProtector,openPrivateJson} from './lib/windows-protected-json.js';
import {captureFaConsolidationSnapshot} from './lib/fa-consolidation-capture.js';
import {FA_CONSOLIDATION_COLLECTIONS,FA_PROJECT,FB_PROJECT,prepareFaConsolidationPlan,faConsolidationReport} from './lib/fa-consolidation-plan.js';
import {snapshotDigest} from './lib/management-split-plan.js';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';

// Explicit read-only command. No apply switch, no generic URLs, no Auth export,
// no production configuration changes. Private snapshots never enter the repo.
export async function runConsolidationInventory(){
 const args=process.argv.slice(2),resume=args.length===2&&args[0]==='--resume'&&/^\d{17}$/.test(args[1])?args[1]:null;
 if(args.length&&!resume)throw Error('CONSOLIDATION_INVENTORY_ARGUMENTS_INVALID');
 const privateBase=process.env.LOCALAPPDATA;
 if(!privateBase)throw Error('CONSOLIDATION_PRIVATE_DIRECTORY_UNAVAILABLE');
 const directory=resolve(privateBase,'SAHMT','fa-consolidation');
 await mkdir(directory,{recursive:true});
 if((await lstat(directory)).isSymbolicLink())throw Error('CONSOLIDATION_PRIVATE_LINK_FORBIDDEN');
 const protector=await createPrivateJsonProtector();
 const proof=protector.seal({code:'LOCAL_PROTECTION_PROBE'});
 if((await openPrivateJson(proof)).code!=='LOCAL_PROTECTION_PROBE')throw Error('CONSOLIDATION_PROTECTION_FAILED');
 const expected=[{alias:'FB',projectId:FB_PROJECT,email:'anestesiahmtforms2@gmail.com'},
  {alias:'FA',projectId:FA_PROJECT,email:'anestesiahmtforms@gmail.com'}];
 const tokens=new Map();
 for(const item of expected){
  try{tokens.set(item.alias,await firebaseCliAccountToken(item.email));}
  catch(error){throw Error('CONSOLIDATION_'+item.alias+'_'+(error.message?.match(/^CLI_ACCOUNT_[A-Z_]+$/)?error.message:'SESSION_FAILED'));}
 }
 // Shared histories need a per-document classification before their capture is
 // used in the copy plan. This first pass inventories exclusive domain roots.
 const scope=FA_CONSOLIDATION_COLLECTIONS.filter(x=>!['auditLogs','notifications','notificationGroups'].includes(x));
 const stamp=resume||new Date().toISOString().replace(/[^0-9]/g,'');
 const previous=resume?await openPrivateJson(JSON.parse(await readFile(resolve(directory,stamp+'-FB.dpapi.json'),'utf8'))):null;
 const readTime=previous?.snapshot?.readTime||new Date(Date.now()-30000).toISOString();
 if(Date.now()-Date.parse(readTime)>50*60*1000)throw Error('CONSOLIDATION_CAPTURE_TOO_OLD_TO_RESUME');
 const captures={};
 for(const item of expected){
  if(item.alias==='FB'&&previous){captures.FB=previous;continue;}
  try{captures[item.alias]=await captureFaConsolidationSnapshot({projectId:item.projectId,scope,readTime,
   accessToken:tokens.get(item.alias),fetchImpl:fetch,maxDocuments:3000,maxRequests:6000,maxBytes:40*1024*1024,includeRootInventory:true});}
  catch(error){throw Error('CONSOLIDATION_'+item.alias+'_'+(error.message?.match(/^CONSOLIDATION_[A-Z0-9_]+$/)?error.message.slice(14):'READ_FAILED'));}
  const file=resolve(directory,stamp+'-'+item.alias+'.dpapi.json'),envelope=protector.seal(captures[item.alias]);
  await writeFile(file,JSON.stringify(envelope),{flag:'wx',mode:0o600});
  const reopened=await openPrivateJson(JSON.parse(await readFile(file,'utf8')));
  if(snapshotDigest(reopened)!==snapshotDigest(captures[item.alias]))throw Error('CONSOLIDATION_BACKUP_VERIFY_FAILED');
 }
 const plan=prepareFaConsolidationPlan({source:captures.FB.snapshot,destination:captures.FA.snapshot,scope});
 await writeFile(resolve(directory,stamp+'-plan.dpapi.json'),JSON.stringify(protector.seal(plan)),{flag:'wx',mode:0o600});
 const byCollection=alias=>Object.fromEntries(scope.map(name=>[name,captures[alias].snapshot.documents.filter(d=>d.path.split('/')[0]===name).length]));
 const excludedInfrastructure=['managementAuthorizationFences','managementAuthorizationLeases','managementRuntime'];
 const unclassifiedSourceRoots=(captures.FB.rootInventory?.collections||[]).filter(name=>!scope.includes(name)&&!excludedInfrastructure.includes(name));
 const report={...faConsolidationReport(plan),readTime,backupRoundTripVerified:true,
  sourceRequests:captures.FB.requests,destinationRequests:captures.FA.requests,collections:{FB:byCollection('FB'),FA:byCollection('FA')},
  excludedSharedCollections:['auditLogs','notifications','notificationGroups'],unclassifiedSourceRoots,
  excludedInfrastructure,inventoryComplete:captures.FB.rootInventory?.complete===true&&unclassifiedSourceRoots.length===0,
  dataWrites:0,rulesChanges:0,iamChanges:0};
 await writeFile(resolve(directory,stamp+'-report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{console.log(JSON.stringify(await runConsolidationInventory()));}
 catch(error){console.error(JSON.stringify({code:/^CONSOLIDATION_[A-Z0-9_]+$/.test(error?.message||'')?error.message:'CONSOLIDATION_INVENTORY_FAILED',dataWrites:0}));process.exitCode=1;}
}
