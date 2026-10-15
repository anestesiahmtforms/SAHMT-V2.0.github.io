import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';import {createHash,createHmac} from 'node:crypto';
import {emptyInputs,initialDefinitions} from '../src/qmentum-catalog.js';import {qmentumCanonical} from '../src/qmentum-write.js';
const code=await readFile(new URL('../apps-script-v2/QmentumCore.gs',import.meta.url),'utf8')+'\n'+await readFile(new URL('../apps-script-v2/QmentumWrite.gs',import.meta.url),'utf8');
const uid='synthetic-user',key='S'.repeat(43),hash=s=>createHash('sha256').update(s).digest('hex');
function fixture(){
 const payload={unitId:'unit-a',year:2026,month:10,inputs:emptyInputs(),baseVersion:0,definitionVersion:1,referenceDate:'2026-10-15',action:'SAVE',reason:'',importHash:null};payload.inputs.counts.surgical=100;payload.inputs.counts.techniqueChanges=2;
 const operation='SAVE_MONTH',digest=hash(qmentumCanonical({operation,payload})),id=uid+'_'+digest;
 const docs=new Map([['qmentumWriteRequests/'+id,{actorUid:uid,payloadHash:digest,operation,payload,status:'PENDING',createdAt:new Date()}],['users/'+uid,{uid,active:true,access:true}],['qmentumAccess/'+uid,{uid,active:true,role:'manager',units:['unit-a']}],['qmentumConfig/current',{enabled:true,definitionVersion:1}],['qmentumUnits/unit-a',{unitId:'unit-a',active:true}],['qmentumDefinitions/1',initialDefinitions()]]);
 let clock=1,reads=0,commits=0,beforeCommit=null;const versions=new Map([...docs.keys()].map(path=>[path,'t1'])),props=new Map([['QMENTUM_WRITE_ENABLED','true'],['SAHMT_OPERATIONAL_PUSH_HMAC_SECRET',key]]);
 const properties={getProperty:k=>props.get(k)||null,setProperty:(k,v)=>props.set(k,v),deleteProperty:k=>props.delete(k),getProperties:()=>Object.fromEntries(props)};
 const context={Date,console,SAHMT_V2_CONFIG:{projectId:'sahmt-17a16',databaseId:'(default)'},sahmtV2Properties_:()=>properties,sha256Hex_:hash,LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},Utilities:{Charset:{UTF_8:'UTF-8'},computeHmacSha256Signature:(value,secret)=>[...createHmac('sha256',secret).update(value).digest()],base64EncodeWebSafe:value=>Buffer.from(value).toString('base64url'),base64DecodeWebSafe:value=>[...Buffer.from(value,'base64url')],newBlob:bytes=>({getDataAsString:()=>Buffer.from(bytes).toString('utf8')})},ospJson_:value=>value,ospEqual_:(a,b)=>a===b,
  qmServerGet_:path=>{reads++;const value=docs.get(path);return value?{...structuredClone(value),id:path.split('/').pop(),_name:path,_updateTime:versions.get(path)}:null;},qmServerClean_:d=>Object.fromEntries(Object.entries(d).filter(([k])=>!k.startsWith('_'))),
  qmServerWrite_:(path,data,old)=>({update:{path,data},currentDocument:old?{updateTime:old._updateTime}:{exists:false}}),
  qmServerCommit_:writes=>{beforeCommit?.();for(const w of writes){const path=w.verify||w.update.path;if(w.currentDocument.exists===false?docs.has(path):versions.get(path)!==w.currentDocument.updateTime){const e=Error('synthetic conflict');e.status=409;throw e;}}
   commits++;clock++;for(const w of writes)if(w.update){docs.set(w.update.path,structuredClone(w.update.data));versions.set(w.update.path,'t'+clock);}}
 };vm.createContext(context);vm.runInContext(code,context);
 const call=({nonce='a'.repeat(32),expires=false,tamper=false,actor=uid,commandId=id}={})=>{const now=Date.now(),value={v:1,aud:'sahmt-qmentum-write',id:commandId,uid:actor,nonce,issuedAt:now-(expires?61000:0),expiresAt:now+(expires?-1000:60000)},payload=Buffer.from(JSON.stringify(value)).toString('base64url');const result=context.qmWriteHttp_({postData:{contents:JSON.stringify({payload,mac:tamper?'0'.repeat(64):createHmac('sha256',key).update('SAHMT_QMENTUM_WRITE_V1\n'+payload).digest('hex')})}});if(!result.payload)return result;assert.equal(result.mac,createHmac('sha256',key).update('SAHMT_QMENTUM_WRITE_V1\n'+result.payload).digest('hex'));return JSON.parse(Buffer.from(result.payload,'base64url'));};
 const configure=({enabled=true,nonce='c'.repeat(32),wrongDomain=false}={})=>{const now=Date.now(),payload=Buffer.from(JSON.stringify({v:1,aud:'sahmt-qmentum-config',nonce,enabled,issuedAt:now,expiresAt:now+60000})).toString('base64url');const result=context.qmWriteConfigureHttp_({postData:{contents:JSON.stringify({payload,mac:createHmac('sha256',key).update((wrongDomain?'SAHMT_QMENTUM_WRITE_V1':'SAHMT_QMENTUM_CONFIG_V1')+'\n'+payload).digest('hex')})}});if(!result.payload)return result;assert.equal(result.mac,createHmac('sha256',key).update('SAHMT_QMENTUM_CONFIG_V1\n'+result.payload).digest('hex'));return JSON.parse(Buffer.from(result.payload,'base64url'));};
 return{docs,props,call,configure,id,versions,serverConfig:context.SAHMT_V2_CONFIG,metrics:()=>({reads,commits}),beforeCommit:fn=>{beforeCommit=fn;}};
}
test('real Apps Script processor validates source and atomically writes month, immutable history and receipt',()=>{
 const f=fixture(),r=f.call();assert.equal(r.code,'QMENTUM_WRITE_CONFIRMED');assert.equal(r.version,1);assert.equal(f.docs.get('qmentumUnits/unit-a/months/2026-10').results.QM01.ratio,.02);assert.equal(f.docs.get('qmentumUnits/unit-a/months/2026-10/history/1').createdBy,uid);assert.equal(f.docs.get('qmentumWriteRequests/'+f.id).status,'CONFIRMED');assert.equal(f.metrics().commits,1);
 assert.equal(f.call({nonce:'b'.repeat(32)}).code,'QMENTUM_WRITE_CONFIRMED');assert.equal(f.metrics().commits,1);
 assert.equal(f.call().code,'QMENTUM_REPLAY_DENIED');assert.equal(f.metrics().commits,1);
});
test('bad HMAC, expiration and disabled transport never read Firestore',()=>{
 for(const options of [{tamper:true},{expires:true}]){const f=fixture();assert.notEqual(f.call(options).code,'QMENTUM_WRITE_CONFIRMED');assert.equal(f.metrics().reads,0);}
 const f=fixture();f.props.set('QMENTUM_WRITE_ENABLED','false');assert.equal(f.call().code,'QMENTUM_WRITE_DISABLED');assert.equal(f.metrics().reads,0);
});
test('authorization revoked between read and commit prevents every data write',()=>{
 const f=fixture();f.beforeCommit(()=>{f.docs.get('users/'+uid).active=false;f.versions.set('users/'+uid,'changed');});assert.equal(f.call().code,'QMENTUM_VERSION_CONFLICT');assert.equal(f.docs.has('qmentumUnits/unit-a/months/2026-10'),false);assert.equal(f.docs.get('qmentumWriteRequests/'+f.id).status,'PENDING');assert.equal(f.metrics().commits,0);
});
test('mismatched UID and a definition not effective for this month fail closed',()=>{
 const f=fixture();assert.notEqual(f.call({actor:'other'}).code,'QMENTUM_WRITE_CONFIRMED');assert.equal(f.metrics().commits,0);
 const g=fixture();g.docs.get('qmentumDefinitions/1').validFrom='2027-01';assert.equal(g.call().code,'QMENTUM_DEFINITION_NOT_EFFECTIVE');assert.equal(g.metrics().commits,0);
});
test('operator transport configuration has separate signature domain, replay guard and disabled-module precondition',()=>{
 const f=fixture();f.props.set('QMENTUM_WRITE_ENABLED','false');
 assert.equal(f.configure({wrongDomain:true}).code,'QMENTUM_CONFIG_DENIED');assert.equal(f.props.get('QMENTUM_WRITE_ENABLED'),'false');
 assert.equal(f.configure().code,'QMENTUM_CONFIG_DENIED','cannot enable transport while module is active');
 f.docs.get('qmentumConfig/current').enabled=false;
 assert.equal(f.configure().code,'QMENTUM_WRITE_TRANSPORT_ENABLED');assert.equal(f.props.get('QMENTUM_WRITE_ENABLED'),'true');
 assert.equal(f.configure().code,'QMENTUM_CONFIG_DENIED');
 assert.equal(f.configure({enabled:false,nonce:'d'.repeat(32)}).code,'QMENTUM_WRITE_TRANSPORT_DISABLED');
 assert.equal(f.metrics().commits,0);
});
test('two different commands based on the same month version cannot overwrite each other',()=>{
 const f=fixture(),second=structuredClone(f.docs.get('qmentumWriteRequests/'+f.id));second.payload.inputs.comment='Second simultaneous command';
 second.payloadHash=hash(qmentumCanonical({operation:second.operation,payload:second.payload}));const secondId=uid+'_'+second.payloadHash;f.docs.set('qmentumWriteRequests/'+secondId,second);f.versions.set('qmentumWriteRequests/'+secondId,'t1');
 assert.equal(f.call().code,'QMENTUM_WRITE_CONFIRMED');assert.equal(f.call({nonce:'e'.repeat(32),commandId:secondId}).code,'QMENTUM_VERSION_CONFLICT');assert.equal(f.metrics().commits,1);assert.equal(f.docs.get('qmentumUnits/unit-a/months/2026-10').inputs.comment,'');
});
test('a server configured for another project refuses before reading any project',()=>{
 const f=fixture();f.serverConfig.projectId='sahmt-gestao-5ae66';assert.equal(f.call().code,'QMENTUM_FA_REQUIRED');assert.equal(f.metrics().reads,0);assert.equal(f.metrics().commits,0);
});
