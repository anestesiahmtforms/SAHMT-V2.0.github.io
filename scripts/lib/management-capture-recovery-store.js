import {readFile,open,lstat,realpath,rename,unlink,link} from 'node:fs/promises';
import {resolve,basename,dirname,relative,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {snapshotDigest} from './management-split-plan.js';
import {unpackRecoveryCore,getRecoveryCorePackAttestation} from './management-capture-recovery-core-codec.js';

export const MANAGEMENT_CAPTURE_RECOVERY_FILES=Object.freeze({
  coordinator:'recovery-coordinator-FA.lock',journal:'capture-recovery-FA-rec1-journal.dpapi.json',
  checkpoint:'capture-recovery-FA-rec1-latest.dpapi.json',capture:'capture-recovery-FA-rec1.dpapi.json',
  receipt:'capture-recovery-FA-rec1-receipt.json'});
const demand=(ok,code)=>{if(!ok)throw Error(code);};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino;
function plainJson(value) {
  let nodes=0;const seen=new Set();
  const visit=(v,depth)=>{
    demand(++nodes<=1500000&&depth<=100,'RECOVERY_STORE_JSON_LIMIT');
    if(v===null||typeof v==='string'||typeof v==='boolean')return;
    if(typeof v==='number'){demand(Number.isFinite(v),'RECOVERY_STORE_JSON_INVALID');return;}
    demand(v&&typeof v==='object'&&!seen.has(v),'RECOVERY_STORE_JSON_INVALID');
    const array=Array.isArray(v),proto=Object.getPrototypeOf(v),keys=Reflect.ownKeys(v);
    demand(array?proto===Array.prototype:proto===Object.prototype||proto===null,'RECOVERY_STORE_JSON_INVALID');
    if(array)demand(keys.length===v.length+1&&keys.at(-1)==='length','RECOVERY_STORE_JSON_INVALID');
    seen.add(v);
    for(const key of keys){if(array&&key==='length')continue;const d=Object.getOwnPropertyDescriptor(v,key);
      demand(typeof key==='string'&&d.enumerable&&Object.hasOwn(d,'value'),'RECOVERY_STORE_JSON_INVALID');visit(d.value,depth+1);}
    seen.delete(v);
  };visit(value,0);return JSON.parse(JSON.stringify(value));
}
function journalBudget(value,trustedPrior=null) {
  const b=value.budget;
  demand(b&&b.schemaVersion===1&&b.kind==='MANAGEMENT_FA_CAPTURE_RECOVERY_BUDGET'
    &&b.namespace==='FA-rec1'&&b.projectId==='sahmt-17a16'&&b.planSha256===value.planSha256
    &&Array.isArray(b.reservations)&&Array.isArray(value.reservations)&&b.reservations.length===value.reservations.length
    &&b.maximumRecoveryOperationReserve===3000&&b.maximumCumulativeCaptureReserve===6000
    &&b.predecessorReservedReads===1342&&b.predecessorPausedRequiresReview===true
    &&b.renewalClearsPause===false&&value.automaticResume===false,'RECOVERY_JOURNAL_BUDGET_INVALID');
  const {budgetSha256,...body}=b;
  demand(sha(budgetSha256)&&snapshotDigest(body)===budgetSha256,'RECOVERY_JOURNAL_BUDGET_INVALID');
  if(value.binding!==null)demand(b.readTime===value.binding.readTime&&b.startedAt===value.binding.startedAt
    &&b.deadlineAt===value.binding.deadlineAt,'RECOVERY_JOURNAL_BUDGET_INVALID');
  if(trustedPrior?.budget?.budgetSha256===budgetSha256){
    demand(JSON.stringify(value.reservations)===JSON.stringify(trustedPrior.reservations),
      'RECOVERY_JOURNAL_BUDGET_INVALID');return b;
  }
  let total=0;
  for(const [i,row]of b.reservations.entries()) {
    const outer=value.reservations[i];
    demand(row.ordinal===i+1&&row.attempt===i+1&&row.maximumReads===(row.operation==='listDocuments'?25:1)
      &&['listDocuments','listCollectionIds'].includes(row.operation)&&sha(row.requestSha256)
      &&outer.projectId==='sahmt-17a16'&&outer.databaseId==='(default)'
      &&['attempt','operation','readTime','requestSha256','maximumReads','reservedAt'].every(k=>outer[k]===row[k]),
      'RECOVERY_JOURNAL_BUDGET_INVALID');
    total+=row.maximumReads;
    demand(row.recoveryReservedReads===total&&row.cumulativeReservedReads===1342+total,'RECOVERY_JOURNAL_BUDGET_INVALID');
  }
  demand(total===b.recoveryReservedReads&&b.cumulativeReservedReads===1342+total&&total<=3000
    &&b.cumulativeReservedReads<=6000&&b.pausedRequiresReview===['COMPLETE','INCOMPLETE'].includes(b.status),
    'RECOVERY_JOURNAL_BUDGET_INVALID');
  return b;
}
/** A separate coordinator and protected CAS journal. It never changes the
 * predecessor lock/head/checkpoint/policy and has no credential/network path.
 * All writers must hold this same coordinator; readback confirms local bytes,
 * not a transaction against writers which disregard the coordinator. */
export async function createManagementCaptureRecoveryStore({directory,protector,openProtected}={}) {
  demand(typeof directory==='string'&&resolve(directory)===directory
    &&basename(directory)==='management-split'&&basename(dirname(directory))==='.local-preview',
    'RECOVERY_STORE_DIRECTORY_INVALID');
  demand(protector&&typeof protector.seal==='function'&&typeof openProtected==='function',
    'RECOVERY_STORE_PROTECTION_REQUIRED');
  const root=dirname(dirname(directory)),files=MANAGEMENT_CAPTURE_RECOVERY_FILES;
  let directoryPins=null;
  async function paths(){
    for(const p of [root,dirname(directory),directory]){const st=await lstat(p);
      demand(st.isDirectory()&&!st.isSymbolicLink(),'RECOVERY_STORE_PATH_LINK_FORBIDDEN');}
    demand(relative(await realpath(root),await realpath(directory))===join('.local-preview','management-split'),
      'RECOVERY_STORE_DIRECTORY_INVALID');
    demand((await readFile(resolve(root,'.gitignore'),'utf8')).split(/\r?\n/).includes('.local-preview/'),
      'RECOVERY_STORE_NOT_IGNORED');
  }
  await paths();directoryPins=await Promise.all([root,dirname(directory),directory].map(async p=>({path:p,stat:await lstat(p)})));
  let descriptor=null,retained=false,closed=false,tail=Promise.resolve(),failure=null,journalCache=null;
  const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
  const path=name=>resolve(directory,name);
  const serial=operation=>{const result=tail.then(operation);tail=result.catch(()=>{});return result;};
  async function owned(){demand(!failure,'RECOVERY_STORE_INVALIDATED_REQUIRES_REVIEW');await Promise.all(directoryPins.map(async pin=>{const st=await lstat(pin.path);
    demand(st.isDirectory()&&!st.isSymbolicLink()&&same(st,pin.stat),'RECOVERY_STORE_PATH_LINK_FORBIDDEN');}));
    demand(descriptor&&!closed,'RECOVERY_STORE_COORDINATOR_REQUIRED');
    const [opened,present]=await Promise.all([descriptor.stat(),lstat(path(files.coordinator))]);
    demand(opened.isFile()&&present.isFile()&&!present.isSymbolicLink()&&same(opened,present),
      'RECOVERY_STORE_COORDINATOR_CHANGED');}
  async function read(name,{optional=false,maximum=72*1024*1024}={}){
    let st;try{st=await lstat(path(name));}catch(e){if(optional&&e.code==='ENOENT')return null;throw e;}
    demand(st.isFile()&&!st.isSymbolicLink()&&st.size>0&&st.size<=maximum,'RECOVERY_STORE_FILE_INVALID');
    const bytes=await readFile(path(name));
    const after=await lstat(path(name));demand(after.isFile()&&!after.isSymbolicLink()&&same(st,after)
      &&bytes.length===st.size&&after.size===st.size,'RECOVERY_STORE_FILE_CHANGED');
    let json;try{json=JSON.parse(bytes.toString('utf8'));}catch{throw Error('RECOVERY_STORE_FILE_INVALID');}
    return {json,sha256:hash(bytes)};
  }
  async function decoded(name,optional=false){const item=await read(name,{optional});if(!item)return null;
    if(name===files.journal){demand(journalCache&&item.sha256===journalCache.ciphertextSha256,
      'RECOVERY_JOURNAL_EXTERNAL_CHANGE_REQUIRES_REVIEW');return journalCache;}
    return {value:plainJson(await openProtected(item.json)),ciphertextSha256:item.sha256};}
  async function writeProtected(name,value,{exclusive=false,signal,beforePublish,verifiedJson=false}={}){
    await owned();if(signal?.aborted)throw Error('RECOVERY_STORE_ABORTED');
    const stable=verifiedJson?value:plainJson(value),valueSha256=snapshotDigest(stable),envelope=protector.seal(stable);
    demand(envelope?.schemaVersion===2&&envelope.protection==='AES256_GCM_WITH_WINDOWS_DPAPI_CURRENT_USER',
      'RECOVERY_STORE_PROTECTED_OUTPUT_REQUIRED');
    const bytes=Buffer.from(JSON.stringify(envelope)+'\n');demand(bytes.length<=72*1024*1024,'RECOVERY_STORE_BYTE_LIMIT');
    const temporary=name+'.'+randomUUID()+'.tmp.dpapi.json';let created=false,published=false,ownedFile=null;
    try{
      const handle=await open(path(temporary),'wx',0o600);created=true;
      try{ownedFile=await handle.stat();await handle.writeFile(bytes,signal?{signal}:{});await handle.sync();}
      finally{await handle.close();}
      const saved=await decoded(temporary);demand(saved.ciphertextSha256===hash(bytes)
        &&snapshotDigest(saved.value)===valueSha256,'RECOVERY_STORE_ROUNDTRIP_MISMATCH');
      await owned();if(signal?.aborted)throw Error('RECOVERY_STORE_ABORTED');
      if(beforePublish)await beforePublish();
      if(exclusive)await link(path(temporary),path(name));else await rename(path(temporary),path(name));
      published=true;
      const final=await read(name);demand(final.sha256===hash(bytes),
        'RECOVERY_STORE_ROUNDTRIP_MISMATCH');
      await owned();if(signal?.aborted)throw Error('RECOVERY_STORE_ABORTED');
      if(name===files.journal)journalCache=Object.freeze({value:freeze(stable),valueSha256,ciphertextSha256:final.sha256});
      return {valueSha256,ciphertextSha256:final.sha256};
    }catch(e){retained=true;failure=e;journalCache=null;
      // Replacement journals/checkpoints remain available for manual review.
      if(exclusive&&published){try{const st=await lstat(path(name));if(same(st,ownedFile))await unlink(path(name));}
        catch(cleanup){if(cleanup.code!=='ENOENT')throw cleanup;}}
      throw e;
    }finally{
      if(created){try{const st=await lstat(path(temporary));if(same(st,ownedFile))await unlink(path(temporary));}
        catch(e){if(e.code!=='ENOENT')throw e;}}
    }
  }
  return Object.freeze({files,
    async acquire(){demand(!descriptor&&!closed,'RECOVERY_STORE_ALREADY_ACQUIRED');await paths();
      try{descriptor=await open(path(files.coordinator),'wx',0o600);}
      catch(e){if(e.code==='EEXIST')throw Error('RECOVERY_COORDINATOR_PRESENT_REQUIRES_REVIEW');throw e;}
      try{await descriptor.writeFile(JSON.stringify({schemaVersion:1,namespace:'FA-rec1',implicitResume:false})+'\n');await descriptor.sync();
        await owned();for(const name of [files.journal,files.checkpoint,files.capture,files.receipt])
          demand(await read(name,{optional:true})===null,'RECOVERY_NAMESPACE_ALREADY_USED_REQUIRES_REVIEW');}
      catch(e){retained=true;failure=e;throw e;}
    },
    readJournal(){return serial(async()=>{await owned();return decoded(files.journal,true);});},
    persistJournal(value,{expectedSha256,signal}={}){return serial(async()=>{
      // Inspect a data descriptor before cloning; accessors never mint evidence.
      const coreDescriptor=value&&typeof value==='object'?Object.getOwnPropertyDescriptor(value,'coreCheckpoint'):null;
      const packAttestation=coreDescriptor&&Object.hasOwn(coreDescriptor,'value')
        ?getRecoveryCorePackAttestation(coreDescriptor.value):null;
      value=plainJson(value);await owned();let priorCiphertextSha256=null;const check=async()=>{const current=await decoded(files.journal,true);
        priorCiphertextSha256=current?.ciphertextSha256??null;journalBudget(value,current?.value??null);
        if(value.coreCheckpoint!==null&&value.coreCheckpoint!==undefined){
          let core;
          if(packAttestation){
            demand(snapshotDigest(value.coreCheckpoint)===packAttestation.packetSha256
              &&value.coreCheckpoint.rawCoreSha256===packAttestation.rawCoreSha256,
              'RECOVERY_JOURNAL_PACK_ATTESTATION_MISMATCH');
            core=packAttestation.summary;
          }else core=unpackRecoveryCore(value.coreCheckpoint);
          demand(value.coreCheckpoint.rawCoreSha256===value.checkpointSha256&&core.projectId==='sahmt-17a16'
            &&core.readTime===value.binding?.readTime&&core.totalReservedReads<=value.budget.recoveryReservedReads,
            'RECOVERY_JOURNAL_CORE_CONTEXT_INVALID');
        }
        demand(current?current.valueSha256===expectedSha256:expectedSha256===null,'RECOVERY_JOURNAL_CAS_MISMATCH');
        if(current){const prior=current.value,oldBudget=prior.budget,nextBudget=value.budget;
          demand(nextBudget.recoveryReservedReads>=oldBudget.recoveryReservedReads
            &&nextBudget.cumulativeReservedReads>=oldBudget.cumulativeReservedReads
            &&nextBudget.reservations.length>=oldBudget.reservations.length
            &&nextBudget.reservations.length<=oldBudget.reservations.length+1
            &&JSON.stringify(nextBudget.reservations.slice(0,oldBudget.reservations.length))===JSON.stringify(oldBudget.reservations)
            &&['predecessorPolicySha256','sourceAuthorizationSha256','reportAuthorization','dailyReadLimit','quotaDayStart',
              'appTrafficReserve','metricLagReserve','preparedAt'].every(k=>JSON.stringify(nextBudget[k])===JSON.stringify(oldBudget[k]))
            &&(!oldBudget.pausedRequiresReview||nextBudget.pausedRequiresReview===true),
            'RECOVERY_JOURNAL_BUDGET_ROLLBACK_FORBIDDEN');
          demand(value.revision===prior.revision+1&&value.previousJournalSha256===expectedSha256
            &&value.planSha256===prior.planSha256&&snapshotDigest(value.predecessor)===snapshotDigest(prior.predecessor)
            &&(prior.binding===null||snapshotDigest(value.binding)===snapshotDigest(prior.binding))
            &&Array.isArray(value.reservations)&&value.reservations.length>=prior.reservations.length
            &&JSON.stringify(value.reservations.slice(0,prior.reservations.length))===JSON.stringify(prior.reservations)
            &&value.dispatchAttempts>=prior.dispatchAttempts
            &&(!prior.pausedRequiresReview||value.pausedRequiresReview===true)
            &&(!['COMPLETE','INCOMPLETE'].includes(prior.status)||value.status==='INCOMPLETE'),
            'RECOVERY_JOURNAL_TRANSITION_INVALID');
        }else demand(value.revision===1&&value.previousJournalSha256===null&&value.status==='PREPARED'&&value.binding===null
          &&Array.isArray(value.reservations)&&value.reservations.length===0&&value.dispatchAttempts===0,
          'RECOVERY_JOURNAL_TRANSITION_INVALID');};
      await check();demand(value?.schemaVersion===1&&value.namespace==='FA-rec1'&&sha(value.planSha256)
        &&['PREPARED','IN_PROGRESS','COMPLETE','INCOMPLETE'].includes(value.status),'RECOVERY_JOURNAL_INVALID');
      return writeProtected(files.journal,value,{signal,verifiedJson:true,beforePublish:async()=>{const current=await read(files.journal,{optional:true});
        demand((current?.sha256??null)===priorCiphertextSha256,'RECOVERY_JOURNAL_CAS_MISMATCH');}});
    });},
    persistCheckpoint(packet,{signal}={}){return serial(async()=>{
      demand(packet?.schemaVersion===1&&packet.kind==='FIRESTORE_RECOVERY_CHECKPOINT'&&packet.projectId==='sahmt-17a16'
        &&packet.namespace==='FA-rec1'&&sha(packet.planSha256)&&packet.coreState,'RECOVERY_CHECKPOINT_INVALID');
      return writeProtected(files.checkpoint,packet,{signal});
    });},
    publishCapture(packet){return serial(async()=>{
      demand(packet?.schemaVersion===1&&packet.kind==='FIRESTORE_RECOVERY_CAPTURE'&&packet.projectId==='sahmt-17a16'
        &&packet.namespace==='FA-rec1'&&packet.status==='COMPLETE'&&packet.snapshot&&packet.receipt,'RECOVERY_COMPLETE_PACKET_REQUIRED');
      return writeProtected(files.capture,packet,{exclusive:true});
    });},
    publishReceipt(receipt){return serial(async()=>{
      await owned();demand(receipt?.schemaVersion===1&&receipt.namespace==='FA-rec1'&&receipt.status==='COMPLETE'
        &&receipt.firestoreWritesIssued===0&&receipt.automaticResume===false,'RECOVERY_RECEIPT_INVALID');
      const bytes=Buffer.from(JSON.stringify(plainJson(receipt),null,2)+'\n');
      demand(bytes.length<=65536,'RECOVERY_RECEIPT_INVALID');let handle,created=false,ownedFile;
      try{handle=await open(path(files.receipt),'wx',0o600);created=true;ownedFile=await handle.stat();await handle.writeFile(bytes);await handle.sync();
        await handle.close();handle=null;const stored=await read(files.receipt,{maximum:65536});
        demand(stored.sha256===hash(bytes),'RECOVERY_RECEIPT_ROUNDTRIP_MISMATCH');await owned();return stored.sha256;}
      catch(e){retained=true;failure=e;if(handle)await handle.close();if(created){const st=await lstat(path(files.receipt));
        if(same(st,ownedFile))await unlink(path(files.receipt));}throw e;}
    });},
    drain(){return tail;},
    retain(){retained=true;},
    async close({release=false}={}){await tail;if(!descriptor||closed)return {lockRetained:retained};
      if(release&&!retained&&!failure){await owned();await unlink(path(files.coordinator));}
      else retained=true;await descriptor.close();closed=true;return {lockRetained:retained};},
  });
}
