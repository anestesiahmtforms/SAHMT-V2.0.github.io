import {mkdir,readdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';import vm from 'node:vm';
import {buildSecondaryDomainReleasePackage} from './lib/secondary-domain-release-package.js';
import {prepareIdentityCutoverRules} from './lib/identity-cutover-rules.js';
export async function prepareSecondaryDomainRelease(root,output=resolve(root,'.local-preview/secondary-domain-release')) {
 const plan=buildSecondaryDomainReleasePackage(JSON.parse(await readFile(resolve(root,'firestore.indexes.json'),'utf8')));
 await mkdir(resolve(output,'apps-script-operational'),{recursive:true});const hashes={};
 const files=(await readdir(resolve(root,'apps-script-v2'))).filter(name=>name.endsWith('.gs')||name==='appsscript.json').sort();
 const sources=[];for(const name of files){const value=await readFile(resolve(root,'apps-script-v2',name),'utf8');if(name.endsWith('.gs')){new vm.Script(value,{filename:name});sources.push(value);}await copyFile(resolve(root,'apps-script-v2',name),resolve(output,'apps-script-operational',name));hashes['apps-script-operational/'+name]=createHash('sha256').update(value).digest('hex');}
 new vm.Script(sources.join('\n'),{filename:'Operational-consolidated.gs'});
 for(const [name,value] of Object.entries({'firestore.identity-cutover.rules':prepareIdentityCutoverRules(await readFile(resolve(root,'firestore.rules'),'utf8')),'firestore.management-runtime.rules':await readFile(resolve(root,'firestore.management-runtime.rules'),'utf8'),'firestore.fb.required-indexes.json':JSON.stringify(plan.indexes,null,2)+'\n','release-manifest.json':JSON.stringify(plan.manifest,null,2)+'\n'})){await writeFile(resolve(output,name),value);hashes[name]=createHash('sha256').update(value).digest('hex');}
 const report={code:'SECONDARY_DOMAIN_LOCAL_PACKAGE_READY',operationalFiles:files.length,requiredCompositeIndexes:plan.indexes.indexes.length,syntax:'PASS',deploymentPerformed:false,retirementEnabled:false,sha256:hashes};
 await writeFile(resolve(output,'package-report.json'),JSON.stringify(report,null,2)+'\n');return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');const r=await prepareSecondaryDomainRelease(root);console.log(JSON.stringify({code:r.code,operationalFiles:r.operationalFiles,requiredCompositeIndexes:r.requiredCompositeIndexes,syntax:r.syntax,deploymentPerformed:false}));}
