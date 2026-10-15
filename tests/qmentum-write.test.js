import test from 'node:test';import assert from 'node:assert/strict';
import {prepareQmentumWrite} from '../src/qmentum-write.js';
import {emptyInputs,initialDefinitions,COUNT_KEYS} from '../src/qmentum-catalog.js';
const fixture=()=>({uid:'synthetic-user',operation:'SAVE_MONTH',profile:{uid:'synthetic-user',active:true,access:true},grant:{uid:'synthetic-user',active:true,role:'manager',units:['unit-a']},config:{enabled:true,definitionVersion:1},unit:{unitId:'unit-a',active:true},definitions:initialDefinitions(),now:new Date('2026-10-15T12:00:00Z'),payload:{unitId:'unit-a',year:2026,month:10,inputs:emptyInputs(),baseVersion:0,definitionVersion:1,referenceDate:'2026-10-15',action:'SAVE',reason:'',importHash:null}});
test('trusted validation calculates all results and fixes authorship, UID and version',()=>{
 const f=fixture();f.payload.inputs.counts.surgical=100;f.payload.inputs.counts.techniqueChanges=2;
 const r=prepareQmentumWrite(f);assert.equal(r.data.results.QM01.ratio,.02);assert.equal(r.data.createdBy,f.uid);assert.equal(r.version,1);assert.equal(Object.keys(r.data.results).length,18);
 assert.throws(()=>prepareQmentumWrite({...f,payload:{...f.payload,results:{QM01:{ratio:1}}}}),/INPUT_INVALID/);
});
test('every count and non applicable flag is validated before trusted writes',()=>{
 for(const key of COUNT_KEYS){const f=fixture();f.payload.inputs.counts[key]=-1;assert.throws(()=>prepareQmentumWrite(f),/COUNT_INVALID/);f.payload.inputs.counts[key]=1;f.payload.inputs.notApplicable=[key];assert.throws(()=>prepareQmentumWrite(f),/STATE_INVALID/);}
});
test('revoked identities, grants, configuration and other units cannot be written',()=>{
 for(const change of [f=>f.profile.active=false,f=>f.profile.access=false,f=>f.profile.uid='other',f=>f.grant.active=false,f=>f.grant.uid='other',f=>f.config.enabled=false,f=>f.grant.units=[],f=>f.unit.active=false]){const f=fixture();change(f);assert.throws(()=>prepareQmentumWrite(f),/PERMISSION_DENIED/);}
});
test('old versions and altered review inputs are rejected',()=>{
 const f=fixture(),first=prepareQmentumWrite(f).data;
 assert.throws(()=>prepareQmentumWrite({...f,current:first}),/VERSION_CONFLICT/);
 f.payload.baseVersion=1;f.payload.action='REVIEW';f.payload.inputs.counts.general=1;
 assert.throws(()=>prepareQmentumWrite({...f,current:first}),/SAVE_BEFORE_REVIEW/);
});
test('review refuses inconsistent arithmetic and closing refuses pending data',()=>{
 const f=fixture();f.payload.inputs.counts.surgical=1;f.payload.inputs.counts.techniqueChanges=2;
 const first=prepareQmentumWrite(f).data;f.payload.baseVersion=1;f.payload.action='REVIEW';
 assert.throws(()=>prepareQmentumWrite({...f,current:first}),/REVIEW_DENIED/);
 const clean=fixture(),draft=prepareQmentumWrite(clean).data;clean.payload.baseVersion=1;clean.payload.action='REVIEW';const reviewed=prepareQmentumWrite({...clean,current:draft}).data;
 clean.payload.baseVersion=2;clean.payload.action='CLOSE';assert.throws(()=>prepareQmentumWrite({...clean,current:reviewed}),/CLOSE_PENDING/);
});
test('definition publication requires manager, sequential version and valid institutional fields',()=>{
 const f=fixture(),defs={...initialDefinitions(),version:2};const request={...f,operation:'PUBLISH_DEFINITION',payload:{definitions:defs}};
 assert.equal(prepareQmentumWrite(request).version,2);
 assert.throws(()=>prepareQmentumWrite({...request,grant:{...f.grant,role:'collector'}}),/PERMISSION_DENIED/);
 assert.throws(()=>prepareQmentumWrite({...request,payload:{definitions:{...defs,version:3}}}),/VERSION_CONFLICT/);
});
test('invalid calendar days cannot be saved even when the month prefix matches',()=>{
 const f=fixture();f.payload.month=2;f.payload.referenceDate='2026-02-31';assert.throws(()=>prepareQmentumWrite(f),/INPUT_INVALID/);
});
