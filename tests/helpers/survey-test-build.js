import {build} from 'vite';
import {resolve} from 'node:path';
// Replace only the Google registry boundary in a separate test build. Production
// bundles never contain this synthetic provider or consult URL group parameters.
export async function surveyTestBuild(name) {
  const outDir=resolve('.local-preview/survey-browser-'+name);
  await build({configFile:'vite.climate.config.js',configLoader:'native',logLevel:'silent',build:{outDir},plugins:[{name:'synthetic-registry-test-only',enforce:'pre',transform(source,id){
    if(!id.endsWith('/climate/participant-group.js'))return;
    const start=source.indexOf('export async function identifyInstitutionalGroup()'),end=source.indexOf('export function mountParticipantGate(',start);
    if(start<0||end<0)throw Error('TEST_REGISTRY_BOUNDARY_MISSING');
    return source.slice(0,start)+"export async function identifyInstitutionalGroup(){const group=new URL(location.href).searchParams.get('testGroup')||'substitute';if(group==='invalid')throw Error('SYNTHETIC_MISSING');return group;}\n"+source.slice(end);
  }}]});
  return outDir;
}
