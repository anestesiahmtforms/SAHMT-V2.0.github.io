import {readFile,open,lstat,rename,unlink,readdir} from 'node:fs/promises';
import {resolve,basename,dirname} from 'node:path';
import {randomBytes} from 'node:crypto';
import {snapshotDigest} from './management-split-plan.js';
import {validateManagementCaptureQuarterHead} from './management-capture-quarter-head.js';

const demand=(ok,code)=>{if(!ok)throw Error(code);};
const PATH='quarter-head-FA.json';
async function paths(directory) {
  demand(typeof directory==='string'&&resolve(directory)===directory
    &&basename(directory)==='management-split'&&basename(dirname(directory))==='.local-preview',
    'QUARTER_HEAD_DIRECTORY_INVALID');
  for(const target of [dirname(directory),directory]) {
    const info=await lstat(target);
    demand(info.isDirectory()&&!info.isSymbolicLink(),'QUARTER_HEAD_PATH_LINK_FORBIDDEN');
  }
  return {headPath:resolve(directory,PATH),lockPath:resolve(directory,'backup-read-FA.lock')};
}
async function load(path) {
  let info;
  try{info=await lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}
  demand(info.isFile()&&!info.isSymbolicLink()&&info.size<=65536,'QUARTER_HEAD_FILE_INVALID');
  try{return JSON.parse(await readFile(path,'utf8'));}catch{throw Error('QUARTER_HEAD_FILE_INVALID');}
}
async function ownedLock(lockPath,descriptor) {
  demand(descriptor&&typeof descriptor.stat==='function','QUARTER_HEAD_CAPTURE_LOCK_REQUIRED');
  const [opened,present]=await Promise.all([descriptor.stat(),lstat(lockPath)]);
  demand(present.isFile()&&!present.isSymbolicLink()&&opened.isFile()
    &&opened.dev===present.dev&&opened.ino===present.ino,'QUARTER_HEAD_CAPTURE_LOCK_REQUIRED');
}
export async function readManagementCaptureQuarterHead({directory}={}) {
  return load((await paths(directory)).headPath);
}
/** All writers must hold the same exclusive capture lock. This is a CAS
 * precondition plus atomic replacement under that lock, not a filesystem
 * transaction that can protect against writers which disregard the lock. */
export async function persistManagementCaptureQuarterHead({directory,lockDescriptor,head,
  expectedHeadSha256,plan,signal}={}) {
  const {headPath,lockPath}=await paths(directory);
  await ownedLock(lockPath,lockDescriptor);
  const next=validateManagementCaptureQuarterHead({head,expectedHeadSha256:head?.headSha256,plan});
  const checkCurrent=async()=>{
    if(signal?.aborted)throw Error('QUARTER_HEAD_WRITE_ABORTED');
    const current=await load(headPath);
    if(current===null) {
      demand(expectedHeadSha256===null&&next.revision===1&&next.previousHeadSha256===null,
        'QUARTER_HEAD_CAS_MISMATCH');
    } else {
      validateManagementCaptureQuarterHead({head:current,expectedHeadSha256,plan});
      if(current.headSha256===next.headSha256)return false;
      demand(next.revision===current.revision+1&&next.previousHeadSha256===current.headSha256
        &&next.sequenceId===current.sequenceId&&next.readTime===current.readTime
        &&next.createdAt===current.createdAt&&Date.parse(next.updatedAt)>=Date.parse(current.updatedAt)
        &&next.batchNumber>=current.batchNumber&&next.batchNumber<=current.batchNumber+1
        &&Object.keys(current.counters).every(key=>next.counters[key]>=current.counters[key])
        &&JSON.stringify(next.runHistory.slice(0,current.runHistory.length))===JSON.stringify(current.runHistory)
        &&(next.batchNumber!==current.batchNumber||next.activeRunId===current.activeRunId
          &&next.activeCheckpointFile===current.activeCheckpointFile),
        'QUARTER_HEAD_CAS_MISMATCH');
    }
    return true;
  };
  if(!(await checkCurrent()))return next;
  const temporary=headPath+'.'+randomBytes(8).toString('hex')+'.tmp';
  try{
    const handle=await open(temporary,'wx',0o600);
    try{await handle.writeFile(JSON.stringify(next,null,2)+'\n',signal?{signal}:{});await handle.sync();}
    finally{await handle.close();}
    await ownedLock(lockPath,lockDescriptor);
    await checkCurrent();
    await rename(temporary,headPath);
  }finally{
    try{await unlink(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  return next;
}

/** Local inventory only. Every matching protected checkpoint is decrypted in
 * memory; sources from older full captures are excluded after inspection.
 * Ambiguous/unreadable/link entries fail closed. Never log returned packets. */
export async function listManagementCaptureQuarterCheckpoints({directory,openPrivateJson}={}) {
  await paths(directory);
  demand(typeof openPrivateJson==='function','QUARTER_CHECKPOINT_OPENER_REQUIRED');
  const inventory=[];
  for(const checkpointFile of (await readdir(directory)).sort()) {
    if(!/^capture-FA-[0-9]{1,32}-latest\.dpapi\.json$/.test(checkpointFile))continue;
    const path=resolve(directory,checkpointFile),info=await lstat(path);
    demand(info.isFile()&&!info.isSymbolicLink()&&info.size<=20*1024*1024,
      'QUARTER_CHECKPOINT_INVENTORY_UNREADABLE_REQUIRES_REVIEW');
    let packet;
    try{packet=await openPrivateJson(JSON.parse(await readFile(path,'utf8')));}
    catch{throw Error('QUARTER_CHECKPOINT_INVENTORY_UNREADABLE_REQUIRES_REVIEW');}
    if(packet?.kind!=='FIRESTORE_QUARTER_CHECKPOINT')continue;
    demand(packet.schemaVersion===1&&packet.projectId==='sahmt-17a16'&&packet.quarterPlan?.planSha256
      &&packet.coreState?.batch?.number,'QUARTER_CHECKPOINT_INVENTORY_UNREADABLE_REQUIRES_REVIEW');
    inventory.push({checkpointFile,coreStateSha256:snapshotDigest(packet.coreState),
      planSha256:packet.quarterPlan.planSha256,readTime:packet.coreState.readTime,batchNumber:packet.coreState.batch.number});
  }
  return inventory;
}
