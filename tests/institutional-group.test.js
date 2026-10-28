import test from 'node:test';import assert from 'node:assert/strict';
import {institutionalGroup,assignedInstitutionalGroup,institutionalAssignmentKey} from '../src/institutional-group.js';
import {resolveParticipantGroup} from '../climate/participant-group.js';
import {readFile} from 'node:fs/promises';
const identity={uid:'synthetic',email:'synthetic@example.invalid'};
const assignment={schemaVersion:1,identityStatus:'LINKED',...identity,memberCategories:['EFETIVO','ADMINISTRADOR']};
const user={...identity,emailVerified:true,providerData:[{providerId:'google.com'}]};
test('internal affiliation groups exclude role flags and reject ambiguous/missing identity bindings',async()=>{
 for(const [id,group]of [['EFETIVO','team'],['RESIDENTE_1','resident'],['RESIDENTE_2','resident'],['RESIDENTE_3','resident'],['SUBSTITUTO','substitute']])assert.equal(institutionalGroup([id,'ADMINISTRADOR','GESTOR']),group);
 for(const value of [null,[],['ADMINISTRADOR'],['GESTOR'],['EFETIVO','SUBSTITUTO'],['RESIDENTE_1','RESIDENTE_2'],['EFETIVO','EFETIVO'],['SECRETARIA']])assert.equal(institutionalGroup(value),null);
 for(const patch of [{uid:'other'},{email:'other@example.invalid'},{identityStatus:'PENDING_ACCOUNT'},{schemaVersion:2},{memberCategories:['ADMINISTRADOR']}])assert.equal(assignedInstitutionalGroup({...assignment,...patch},identity),null);
 assert.equal(await institutionalAssignmentKey(' SYNTHETIC@EXAMPLE.INVALID '),await institutionalAssignmentKey(identity.email));
});
test('FE classifier resolves registry group; rejects unverified/provider or missing bindings',async()=>{
 const readAssignment=async key=>{assert.equal(key,await institutionalAssignmentKey(user.email));return assignment;};
 assert.equal(await resolveParticipantGroup({user,readAssignment}),'team');
 for(const patch of [{emailVerified:false},{uid:'other'},{providerData:[{providerId:'password'}]},{email:'other@example.invalid'}])await assert.rejects(resolveParticipantGroup({user:{...user,...patch},readAssignment:async()=>assignment}));
 await assert.rejects(resolveParticipantGroup({user,readAssignment:async()=>null}));
 const source=await readFile('climate/participant-group.js','utf8');assert.match(source,/authStateReady/);assert.doesNotMatch(source,/signInWithPopup|signOut|setPersistence/);
});
