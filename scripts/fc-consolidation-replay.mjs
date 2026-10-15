import{readFile,readdir}from'node:fs/promises';import{resolve}from'node:path';
import{openPrivateJson}from'./lib/windows-protected-json.js';import{harness}from'../tests/evaluation-fb-harness.js';
try{
 const dir=resolve(process.env.LOCALAPPDATA,'SAHMT','fa-consolidation'),files=await readdir(dir);
 const open=async name=>openPrivateJson(JSON.parse(await readFile(resolve(dir,name),'utf8')));
 const fc=await open(files.filter(name=>/^FC-\d{17}\.dpapi.json$/.test(name)).sort().at(-1));
 const fa=await open(files.filter(name=>/^cutover-\d+-final-plan.dpapi.json$/.test(name)).sort().at(-1));
 const profiles=await open(files.filter(name=>/^cutover-preflight-\d+\.dpapi.json$/.test(name)).sort().at(-1));
 const h=harness(),base='projects/sahmt-17a16/databases/(default)/documents/';
 for(const row of fa.plan.operations){const name=base+row.path;h.store.set(name,{name,fields:structuredClone(row.fields),updateTime:row.sourceUpdateTime});}
 for(const row of fc.input.source.documents){const name=base+row.path;h.store.set(name,{name,fields:structuredClone(row.fields),updateTime:row.updateTime});}
 for(const row of profiles.profiles)h.store.set(row.name,structuredClone(row));
 h.properties.set('SAHMT_V2_OCCURRENCE_SCORING_ENABLED','true');
 const claims=fc.input.source.documents.filter(row=>row.path.startsWith('occurrenceScoreClaims/'));
 const before=h.values('evaluationLedger').length;
 for(const claim of claims){const id=claim.path.split('/')[1];h.ctx.evaluationDeliverOccurrence_(id);h.ctx.evaluationDeliverOccurrence_(id);}
 const after=h.values('evaluationLedger').length;
 if(after!==before)throw Error('HISTORICAL_CREDIT_CHANGED');
 if(h.requests.some(row=>!row.url.includes('/sahmt-17a16/')))throw Error('SECONDARY_DATA_DEPENDENCY');
 console.log(JSON.stringify({code:'FC_PRIVATE_HISTORICAL_REPLAY_OK',claims:claims.length,ledgerBefore:before,ledgerAfter:after,newCredits:0,
  allRequestsMocked:true,productionWrites:0,allDataRequestsUseFA:true}));
}catch{console.error(JSON.stringify({code:'FC_PRIVATE_HISTORICAL_REPLAY_FAILED',productionWrites:0}));process.exitCode=1;}
