import {build} from 'vite';
import {resolve} from 'node:path';
// Replace only the app session bridge boundary in a separate test build. Production
// bundles never contain this synthetic provider or consult URL group parameters.
export async function surveyTestBuild(name) {
  const outDir=resolve('.local-preview/survey-browser-'+name);
  await build({configFile:'vite.climate.config.js',configLoader:'native',logLevel:'silent',build:{outDir},plugins:[{name:'synthetic-registry-test-only',enforce:'pre',transform(source,id){
    if(id.endsWith('/climate/transport.js')||id.endsWith('/climate/stress-transport.js')){
     const climate=id.endsWith('/climate/transport.js'),start=source.indexOf(climate?'export async function sendSubmission(':'export async function send(');
     if(start<0)throw Error('TEST_SUBMISSION_BOUNDARY_MISSING');
     return source.slice(0,start)+(climate?"export async function sendSubmission(payload,commentToken,signal){const r=await fetch(COMMIT_URL,{method:'POST',credentials:'omit',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json'},body:JSON.stringify(commitBody(payload,commentToken)),signal});if(!r.ok)throw Error(r.status===403?'NOT_ACCEPTED':'UNAVAILABLE');return {accepted:true,alreadyResponded:false};}":"export async function send(payload,signal){const r=await fetch(COMMIT_URL,{method:'POST',credentials:'omit',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json'},body:JSON.stringify(commitBody(payload)),signal});if(!r.ok)throw Error(r.status===403?'NOT_ACCEPTED':'UNAVAILABLE');return {accepted:true,alreadyResponded:false};}");
    }
    if(!id.endsWith('/climate/participant-group.js'))return;
    const start=source.indexOf('export const identifyInstitutionalGroup='),end=source.indexOf('export function mountParticipantGate(',start);
    if(start<0||end<0)throw Error('TEST_REGISTRY_BOUNDARY_MISSING');
    return source.slice(0,start)+"export async function identifyInstitutionalGroup(){const group=new URL(location.href).searchParams.get('testGroup')||'substitute';if(group==='invalid')throw Error('SYNTHETIC_MISSING');return {group,alreadyResponded:false};}\n"+source.slice(end);
  }}]});
  return outDir;
}
