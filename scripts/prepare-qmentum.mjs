/** LOCAL ONLY: never imports Firebase, calls network APIs or writes cloud resources. */
import {readFile,writeFile,mkdir,copyFile,realpath} from 'node:fs/promises';
import {resolve,relative,dirname,isAbsolute,join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {initialDefinitions} from '../src/qmentum-catalog.js';
import {parseQmentumWorkbook,fileHash,prepareQmentumImport,workbookBackup} from '../src/qmentum-import.js';
import {quarterlyPlan} from '../src/qmentum-quarterly.js';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
export function bootstrapPlan(manifest) {
 if(!Array.isArray(manifest?.units)||!manifest.units.length||!Array.isArray(manifest.access)||!manifest.access.length)throw Error('QMENTUM_REAL_UNITS_AND_ACCESS_REQUIRED');
 const ids=new Set();const documents=[{path:'qmentumConfig/current',data:{enabled:false,definitionVersion:1}},{path:'qmentumDefinitions/1',data:initialDefinitions()}];
 for(const u of manifest.units){if(!/^[A-Za-z0-9_-]{1,80}$/.test(u.unitId||'')||ids.has(u.unitId)||u.verified!==true||typeof u.name!=='string'||!u.name.trim()||u.name.length>200||typeof u.sourceReference!=='string'||u.sourceReference.length<8)throw Error('QMENTUM_UNIT_CONFIRMATION_REQUIRED');ids.add(u.unitId);documents.push({path:`qmentumUnits/${u.unitId}`,data:{unitId:u.unitId,name:u.name.trim(),sourceReference:u.sourceReference,active:true}});}
 const users=new Set();for(const a of manifest.access){if(typeof a.uid!=='string'||!a.uid||a.uid.length>128||/[\/\s]/.test(a.uid)||users.has(a.uid)||a.verified!==true||!['collector','reviewer','manager'].includes(a.role)||!Array.isArray(a.units)||!a.units.length||a.units.length>20||new Set(a.units).size!==a.units.length||a.units.some(id=>!ids.has(id)))throw Error('QMENTUM_ACCESS_CONFIRMATION_REQUIRED');users.add(a.uid);documents.push({path:`qmentumAccess/${a.uid}`,data:{uid:a.uid,active:true,role:a.role,units:a.units}});}
 return {schemaVersion:1,code:'QMENTUM_BOOTSTRAP_PREVIEW_ONLY',projectId:'sahmt-17a16',databaseId:'(default)',enabled:false,documents,warning:'Não executado. Identidades e unidades devem ter conferência administrativa. Instalação depende de autorização específica.'};
}
export async function prepare({file,out,manifest,year=null,unitId=null}) {
 if(!out)throw Error('QMENTUM_OUTPUT_REQUIRED');const target=resolve(out);await mkdir(target,{recursive:true});const actual=await realpath(target),repo=await realpath(root),rel=relative(repo,actual);if(!rel||!rel.startsWith('..')&&!isAbsolute(rel))throw Error('QMENTUM_OUTPUT_MUST_BE_OUTSIDE_REPOSITORY');
 const report={schemaVersion:1,code:'QMENTUM_LOCAL_PACKAGE_READY',writesToCloud:0,historyImported:false,enabled:false};
 if(file){const bytes=await readFile(resolve(file)),hash=await fileHash(bytes),book=parseQmentumWorkbook(bytes),preview=prepareQmentumImport(book,{hash,year,unitId});await copyFile(resolve(file),join(actual,`source-${hash}.xlsx`));await writeFile(join(actual,'source-map.json'),JSON.stringify(workbookBackup(book,hash),null,2));await writeFile(join(actual,'import-preview.json'),JSON.stringify(preview,null,2));report.source={sha256:hash,sheets:preview.sourceSheetNames,monthsWithInputs:preview.months.filter(m=>m.hasInput).length,divergences:preview.divergences.length,year:preview.year,unitAssigned:unitId!==null};
  if(preview.year&&unitId){const rows=preview.months.filter(m=>m.hasInput).map(m=>({...m,year:preview.year,version:1})),jobs=quarterlyPlan({unitId,rows,now:Date.now(),hash:x=>createHash('sha256').update(x).digest('hex')});await writeFile(join(actual,'quarterly-dry-run.json'),JSON.stringify({code:'QMENTUM_QUARTERLY_PREVIEW_ONLY',externalCalls:0,jobs},null,2));report.quarterly={planned:jobs.length,noData:jobs.filter(j=>j.status==='NO_DATA').length,externalCalls:0};}
 }
 if(manifest){const plan=bootstrapPlan(JSON.parse(await readFile(resolve(manifest),'utf8')));await writeFile(join(actual,'bootstrap-private-preview.json'),JSON.stringify(plan,null,2));report.configuration={units:plan.documents.filter(d=>d.path.startsWith('qmentumUnits/')).length,grants:plan.documents.filter(d=>d.path.startsWith('qmentumAccess/')).length};}
 await writeFile(join(actual,'report.json'),JSON.stringify(report,null,2));return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{const args=process.argv.slice(2),options={};for(let i=0;i<args.length;i+=2){if(!['--file','--out','--manifest','--year','--unit'].includes(args[i])||!args[i+1])throw Error('QMENTUM_ARGUMENT_INVALID');options[args[i].slice(2)]=args[i+1];}const report=await prepare({...options,year:options.year?Number(options.year):null,unitId:options.unit||null});console.log(JSON.stringify(report));}catch(error){console.error(JSON.stringify({code:/^QMENTUM_[A-Z_]+$/.test(error.message)?error.message:'QMENTUM_LOCAL_PREPARATION_FAILED'}));process.exitCode=1;}}
