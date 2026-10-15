import {readFile,writeFile} from 'node:fs/promises';import {resolve} from 'node:path';
import {openPrivateJson} from './lib/windows-protected-json.js';
import {restoreTypedSnapshotInEmulator} from './lib/fa-consolidation-restore.js';
try{
 const stamp=process.argv[2];if(process.argv.length!==3||!/^\d{17}$/.test(stamp))throw Error('CONSOLIDATION_RESTORE_STAMP_INVALID');
 const directory=resolve(process.env.LOCALAPPDATA,'SAHMT','fa-consolidation');
 const capture=await openPrivateJson(JSON.parse(await readFile(resolve(directory,stamp+'-FB.dpapi.json'),'utf8')));
 const result=await restoreTypedSnapshotInEmulator({snapshot:capture.snapshot});
 await writeFile(resolve(directory,stamp+'-restore-report.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify(result));
}catch(error){console.error(JSON.stringify({code:/^CONSOLIDATION_[A-Z_]+$/.test(error.message||'')?error.message:'CONSOLIDATION_RESTORE_FAILED',productionWrites:0}));process.exitCode=1;}
