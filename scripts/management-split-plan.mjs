import {readFile, mkdir, writeFile,lstat,realpath} from 'node:fs/promises';
import {resolve, relative, isAbsolute} from 'node:path';
import {prepareSplitPlan} from './lib/management-split-plan.js';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Simulação local: node scripts/management-split-plan.mjs --backup SNAPSHOT.json --manifest MANIFEST.json --out .local-preview/management-split/plan.json [--destination SNAPSHOT_FB.json]');
  process.exit(0);
}
try {
  const options = {};
  for (let index=0; index<args.length; index+=2) {
    const name=args[index];
    if (!['--backup','--manifest','--out','--destination'].includes(name) || options[name] || !args[index+1] || args[index+1].startsWith('--')) throw new Error('INVALID_ARGUMENTS');
    options[name]=args[index+1];
  }
  if (!options['--backup'] || !options['--manifest'] || !options['--out']) throw new Error('REQUIRED_ARGUMENTS_MISSING');
  const privateRoot=resolve('.local-preview'), output=resolve(options['--out']);
  const relativeOutput=relative(privateRoot,output);
  if (!relativeOutput || relativeOutput==='..' || relativeOutput.startsWith('..\\') || relativeOutput.startsWith('../') || isAbsolute(relativeOutput)) throw new Error('OUTPUT_MUST_BE_IN_LOCAL_PREVIEW');
  try { await promisify(execFile)('git',['check-ignore','--quiet','--no-index',output]); }
  catch { throw new Error('OUTPUT_MUST_BE_GIT_IGNORED'); }
  const {dirname}=await import('node:path');
  // Reject junctions/symlinks before creating any directory or output file.
  let parent=dirname(output);
  while(parent!==dirname(privateRoot)) {
    try { if((await lstat(parent)).isSymbolicLink()) throw new Error('OUTPUT_LINK_FORBIDDEN'); }
    catch(error) { if(error.code!=='ENOENT') throw error; }
    if(parent===privateRoot) break;
    parent=dirname(parent);
  }
  const parse = async path => JSON.parse((await readFile(resolve(path),'utf8')).replace(/^\uFEFF/,''));
  const [backup,manifest,destination]=await Promise.all([parse(options['--backup']),parse(options['--manifest']), options['--destination'] ? parse(options['--destination']) : null]);
  const plan=prepareSplitPlan(backup,manifest,destination);
  await mkdir(dirname(output),{recursive:true});
  const actualRoot=await realpath(privateRoot),actualParent=await realpath(dirname(output));
  const resolvedRelative=relative(actualRoot,actualParent);
  if(resolvedRelative==='..' || resolvedRelative.startsWith('..\\') || resolvedRelative.startsWith('../') || isAbsolute(resolvedRelative)) throw new Error('OUTPUT_MUST_BE_IN_LOCAL_PREVIEW');
  // Never overwrite a previous review/audit file.
  await writeFile(output,JSON.stringify(plan,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({mode:plan.mode,productionAuthorized:false,readyForReview:plan.readyForReview,counts:plan.counts,blockerCount:plan.blockers.length,planSha256:plan.planSha256}));
  if (!plan.readyForReview) process.exitCode=2;
} catch(error) {
  // Private snapshot contents and paths are not included in diagnostic output.
  const safeCode=/^[A-Z_]+$/.test(error.message) ? error.message : ['EEXIST','ENOENT','EACCES'].includes(error.code) ? error.code : 'PLAN_INPUT_OR_OUTPUT_FAILED';
  console.error(JSON.stringify({error:safeCode,productionAuthorized:false}));
  process.exitCode=1;
}
