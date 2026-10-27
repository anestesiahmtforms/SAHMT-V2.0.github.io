import test from 'node:test';import assert from 'node:assert/strict';
import {MEMBER_CATEGORIES,buildMemberCategoryRoster,normalizeMemberCategories,memberMatchesCategory,mergeMemberCategoryAssignments,memberCategoryCounts} from '../src/member-categories.js';
import {planMemberCategoryDocuments,MEMBER_CATEGORY_PROJECTS} from '../scripts/lib/member-category-plan.js';
import {addMemberCategoryRules} from '../scripts/lib/member-category-rules.js';
const roster=()=>({...Object.fromEntries(Object.keys(MEMBER_CATEGORIES).map(k=>[k,[]])),EFETIVO:['Member@Example.test'],RESIDENTE_1:['resident@example.test'],ADMINISTRADOR:['member@example.test']});
test('affiliation and administrator membership coexist without permission grants',()=>{
 const rows=buildMemberCategoryRoster(roster());assert.deepEqual(rows[0],{email:'member@example.test',memberCategories:['EFETIVO','ADMINISTRADOR']});
 assert.equal(memberMatchesCategory({...rows[0],permissions:{}},'ADMINISTRADOR'),true);assert.equal(rows[0].permissions,undefined);
 assert.throws(()=>normalizeMemberCategories(['EFETIVO','RESIDENTE_1']),/CONFLICT/);assert.throws(()=>normalizeMemberCategories(['ADMINISTRADOR','ADMINISTRADOR']),/INVALID/);
});
test('duplicate emails within a group and unknown category IDs are rejected',()=>{
 const input=roster();input.EFETIVO.push('MEMBER@example.test');assert.throws(()=>buildMemberCategoryRoster(input));
 assert.throws(()=>buildMemberCategoryRoster({...roster(),unknown:[]}));assert.throws(()=>normalizeMemberCategories(['admin']));
});
test('all five projects receive the same category model; absent accounts remain pending',()=>{
 const accounts=Object.fromEntries(Object.keys(MEMBER_CATEGORY_PROJECTS).map(k=>[k,[{email:'member@example.test',uid:'same-uid'}]]));
 const plan=planMemberCategoryDocuments(roster(),accounts);assert.equal(plan.totalMembers,2);assert.equal(plan.counts.GESTOR,0);
 for(const project of Object.values(plan.projects)){
  assert.equal(project.linked,1);assert.deepEqual(project.pending,['resident@example.test']);assert.equal(project.documents.length,9);
  assert.ok(project.documents.every(x=>/^(userCategories|userCategoryDefinitions)\//.test(x.path)));
  assert.ok(project.documents.every(x=>!x.path.includes('@')));assert.equal(project.documents[0].data.uid,'same-uid');
 }
});
test('UID conflicts and ambiguous auth records fail closed before writing',()=>{
 assert.throws(()=>planMemberCategoryDocuments(roster(),{FA:[{email:'member@example.test',uid:'one'}],FB:[{email:'member@example.test',uid:'two'}]}),/UID_MISMATCH/);
 assert.throws(()=>planMemberCategoryDocuments(roster(),{FA:[{email:'member@example.test',uid:'one'},{email:'member@example.test',uid:'one'}]}),/AMBIGUOUS/);
});
test('rule insertion is scoped and idempotent; existing rules are preserved',()=>{
 const source="rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /users/{uid} { allow read: if true; allow write: if false; } } }";
 const patched=addMemberCategoryRules(source);assert.ok(patched.includes('allow read: if true'));assert.equal(addMemberCategoryRules(patched),patched);
 assert.ok(patched.includes('allow write: if false'));assert.ok(patched.includes('resource.data.uid == request.auth.uid'));
});
test('the admin view joins by UID and matching email, preserving operational role and permissions',()=>{
 const permissions={admin:false},profile={uid:'one',email:'member@example.test',role:'residente',permissions};
 const assignments=[{schemaVersion:1,identityStatus:'LINKED',uid:'one',email:'member@example.test',memberCategories:['RESIDENTE_1','GESTOR']}];
 const [joined]=mergeMemberCategoryAssignments([profile],assignments);assert.deepEqual(joined.memberCategories,['RESIDENTE_1','GESTOR']);assert.equal(joined.permissions,permissions);assert.equal(joined.role,'residente');assert.equal(profile.memberCategories,undefined);
 assert.deepEqual(mergeMemberCategoryAssignments([{...profile,email:'other@example.test'}],assignments)[0].memberCategories,[]);
 assert.throws(()=>mergeMemberCategoryAssignments([profile],[...assignments,...assignments]),/AMBIGUOUS/);
 assert.equal(memberCategoryCounts(assignments).GESTOR,1);assert.equal(memberCategoryCounts(assignments).ADMINISTRADOR,0);
});
