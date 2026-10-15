import {readFile,writeFile} from 'node:fs/promises';
import {scopeQmentumFragment} from './lib/qmentum-rule-scope.js';
import {pruneUnusedScheduleRuleHelpers} from './lib/firestore-rules-unused-helpers.js';
const args=process.argv.slice(2);
if(args.length&&!(args.length===4&&args[0]==='--base'&&args[2]==='--out'))throw Error('QMENTUM_RULE_ARGUMENT_INVALID');
const fragment=`
    function qmSigned() { return database == '(default)' && activeUser() && profile().uid == request.auth.uid; }
    function qmAccess() { return get(/databases/$(database)/documents/qmentumAccess/$(request.auth.uid)).data; }
    function qmEnabled() { return get(/databases/$(database)/documents/qmentumConfig/current).data.enabled == true; }
    function qmMember() { let a=qmAccess();return qmSigned() && a.uid == request.auth.uid && a.active == true && a.role in ['collector','reviewer','manager'] && qmEnabled(); }
    function qmUnit(unit) { return qmMember() && unit in qmAccess().units && get(/databases/$(database)/documents/qmentumUnits/$(unit)).data.active == true; }
    function qmManager() { return qmMember() && qmAccess().role == 'manager'; }
    match /qmentumAccess/{uid} { allow get: if qmSigned() && request.auth.uid == uid; allow list,write: if false; }
    match /qmentumConfig/current { allow get: if qmSigned() && qmAccess().active == true && qmAccess().uid == request.auth.uid;allow list,write: if false; }
    match /qmentumDefinitions/{version} { allow get: if qmMember();allow list,write: if false; }
    match /qmentumUnits/{unit} {
      allow get: if qmMember() && unit in qmAccess().units;allow list,write: if false;
      match /months/{period} {
        allow get: if qmUnit(unit);allow list: if qmUnit(unit) && request.query.limit != null && request.query.limit <= 12;allow write: if false;
        match /history/{version} { allow get: if qmUnit(unit);allow list: if qmUnit(unit) && request.query.limit != null && request.query.limit <= 30;allow write: if false; }
      }
      match /imports/{hash} {
        allow get: if qmUnit(unit) && qmAccess().role == 'manager'; allow list,update,delete: if false;
        allow create: if qmUnit(unit) && qmAccess().role == 'manager' && request.resource.data.keys().hasOnly(['schemaVersion','hash','unitId','year','status','backupReference','chunkCount','createdBy','createdAt','sheetNames']) &&
          hash.matches('^[a-f0-9]{64}$') && request.resource.data.hash == hash && request.resource.data.schemaVersion == 1 &&
          request.resource.data.unitId == unit && request.resource.data.year is int && request.resource.data.year >= 1900 && request.resource.data.year <= 2200 &&
          request.resource.data.status == 'STAGED' && request.resource.data.createdBy == request.auth.uid && request.resource.data.createdAt == request.time &&
          request.resource.data.backupReference is string && request.resource.data.backupReference.size() <= 2000 &&
          request.resource.data.chunkCount is int && request.resource.data.chunkCount > 0 && request.resource.data.chunkCount <= 40;
        match /cells/{index} {
          allow get: if qmUnit(unit) && qmAccess().role == 'manager'; allow list,update,delete: if false;
          allow create: if qmUnit(unit) && qmAccess().role == 'manager' &&
            getAfter(/databases/$(database)/documents/qmentumUnits/$(unit)/imports/$(hash)).data.createdAt == request.time &&
            request.resource.data.keys().hasOnly(['cells','hash','index']) && request.resource.data.hash == hash &&
            request.resource.data.index == int(index) && int(index) >= 0 && int(index) < getAfter(/databases/$(database)/documents/qmentumUnits/$(unit)/imports/$(hash)).data.chunkCount &&
            request.resource.data.cells is list && request.resource.data.cells.size() <= 2000;
        }
      }

    }
`;
let base=pruneUnusedScheduleRuleHelpers((await readFile(args.length?args[1]:new URL('../firestore.rules',import.meta.url),'utf8')).replaceAll('\r\n','\n')).source;
const begin='// BEGIN QMENTUM_FA',end='// END QMENTUM_FA';
if(base.includes(begin)||base.includes(end)){
 if(base.split(begin).length!==2||base.split(end).length!==2||base.indexOf(end)<base.indexOf(begin))throw Error('QMENTUM_RULE_MARKERS_INVALID');
 base=base.slice(0,base.indexOf(begin))+base.slice(base.indexOf(end)+end.length);
}
const position=base.lastIndexOf('\n  }\n}');
if(position<0||/\bmatch\s+\/qmentum/.test(base))throw Error('QMENTUM_RULE_BASE_INVALID');
const analysisRules=`
    match /qmentumUnits/{unit}/quarterlyAnalyses/{id} {
      allow get,list: if activeUser() && profile().uid == request.auth.uid &&
        get(/databases/$(database)/documents/qmentumConfig/current).data.enabled == true &&
        get(/databases/$(database)/documents/qmentumAccess/$(request.auth.uid)).data.active == true &&
        get(/databases/$(database)/documents/qmentumAccess/$(request.auth.uid)).data.uid == request.auth.uid &&
        unit in get(/databases/$(database)/documents/qmentumAccess/$(request.auth.uid)).data.units &&
        (request.method == 'get' || request.query.limit != null && request.query.limit <= 40);
      allow write: if false;
    }
    match /qmentumQuarterlyJobs/{id} { allow read,write: if false; }
    match /qmentumEvidence/{id} { allow read,write: if false; }
    match /qmentumImprovementActions/{id} { allow read,write: if false; }
    match /qmentumAnalysisReviewRequests/{id} {
      function qmAnalysisReviewer(unit) {
        let grant=get(/databases/$(database)/documents/qmentumAccess/$(request.auth.uid)).data;
        return activeUser() && profile().uid == request.auth.uid && grant.active == true && grant.uid == request.auth.uid &&
          grant.role in ['reviewer','manager'] && unit in grant.units &&
          get(/databases/$(database)/documents/qmentumConfig/current).data.enabled == true;
      }
      allow get: if activeUser() && (resource == null || resource.data.actorUid == request.auth.uid);
      allow list,update,delete: if false;
      allow create: if request.resource.data.keys().hasOnly(['unitId','analysisId','signature','reason','actorUid','status','createdAt']) &&
        qmAnalysisReviewer(request.resource.data.unitId) &&
        request.resource.data.analysisId.matches('^[a-f0-9]{64}$') && request.resource.data.signature.matches('^[a-f0-9]{64}$') &&
        id == request.resource.data.analysisId+'_'+request.auth.uid && request.resource.data.actorUid == request.auth.uid &&
        request.resource.data.status == 'PENDING' && request.resource.data.createdAt == request.time &&
        request.resource.data.reason is string && request.resource.data.reason.size() >= 8 && request.resource.data.reason.size() <= 1000 &&
        get(/databases/$(database)/documents/qmentumUnits/$(request.resource.data.unitId)/quarterlyAnalyses/$(request.resource.data.analysisId)).data.signature == request.resource.data.signature;
    }
`;
const participationMember=`
      function participant(unit) {
        let grant=get(/databases/$(database)/documents/qmentumAccess/$(request.auth.uid)).data;
        return activeUser() && profile().uid == request.auth.uid && grant.active == true && grant.uid == request.auth.uid &&
          unit in grant.units && grant.role in ['collector','reviewer','manager'] &&
          get(/databases/$(database)/documents/qmentumUnits/$(unit)).data.active == true &&
          get(/databases/$(database)/documents/qmentumConfig/current).data.enabled == true;
      }
      function manager() { return get(/databases/$(database)/documents/qmentumAccess/$(request.auth.uid)).data.role == 'manager'; }
`;
const participationRules=`
    match /qmentumParticipations/{id} {${participationMember}
      function approvedAnalysis(d) {
        let a=get(/databases/$(database)/documents/qmentumUnits/$(d.unitId)/quarterlyAnalyses/$(d.analysisId)).data;
        return a.status == 'REVIEWED' && a.reviewed == true && a.signature == d.signature;
      }
      allow get: if activeUser() && (resource == null || participant(resource.data.unitId) && (resource.data.actorUid == request.auth.uid || manager()));
      allow list: if request.query.limit != null && request.query.limit <= 100 && participant(resource.data.unitId) && (resource.data.actorUid == request.auth.uid || manager());
      allow update,delete: if false;
      allow create: if request.resource.data.keys().hasOnly(['unitId','analysisId','signature','actorUid','modality','suggestion','status','createdAt']) &&
        participant(request.resource.data.unitId) && request.resource.data.actorUid == request.auth.uid && request.resource.data.status == 'PENDING' && request.resource.data.createdAt == request.time &&
        request.resource.data.analysisId.matches('^[a-f0-9]{64}$') && request.resource.data.signature.matches('^[a-f0-9]{64}$') &&
        request.resource.data.modality in ['ACKNOWLEDGEMENT','SUGGESTION'] &&
        id == request.resource.data.analysisId+'_'+request.auth.uid+'_'+request.resource.data.modality && approvedAnalysis(request.resource.data) &&
        request.resource.data.suggestion is string && (request.resource.data.modality == 'ACKNOWLEDGEMENT' ? request.resource.data.suggestion == '' : request.resource.data.suggestion.size() >= 8 && request.resource.data.suggestion.size() <= 2000);
    }
    match /qmentumParticipationReviews/{id} {${participationMember}
      function reviewTarget(d) {
        let p=get(/databases/$(database)/documents/qmentumParticipations/$(id)).data;
        return p.unitId == d.unitId && p.modality == 'SUGGESTION' && p.actorUid != request.auth.uid && p.status == 'AWAITING_APPROVAL';
      }
      allow get: if activeUser() && (resource == null || participant(resource.data.unitId) && manager());
      allow list,update,delete: if false;
      allow create: if request.resource.data.keys().hasOnly(['participationId','unitId','actorUid','decision','reason','status','createdAt']) &&
        participant(request.resource.data.unitId) && manager() && request.resource.data.actorUid == request.auth.uid && request.resource.data.participationId == id &&
        request.resource.data.decision in ['APPROVE','REJECT'] && request.resource.data.reason is string && request.resource.data.reason.size() >= 8 && request.resource.data.reason.size() <= 1000 &&
        request.resource.data.status == 'PENDING' && request.resource.data.createdAt == request.time && reviewTarget(request.resource.data);
    }
`;
const participationBlocks=participationRules.split('    match /qmentumParticipationReviews/');
if(participationBlocks.length!==2)throw Error('QMENTUM_PARTICIPATION_SCOPE_INVALID');
const uniqueParticipation=participationBlocks[0].replaceAll('participant(', 'qmParticipationMember(').replaceAll('manager(', 'qmParticipationManager(')+'    match /qmentumParticipationReviews/'+participationBlocks[1].replaceAll('participant(', 'qmReviewMember(').replaceAll('manager(', 'qmReviewManager(');
const commandRules=`
    match /qmentumWriteRequests/{id} {
      function allowed(d) {
        let a=get(/databases/$(database)/documents/qmentumAccess/$(request.auth.uid)).data;
        return database == '(default)' && activeUser() && profile().uid == request.auth.uid && a.uid == request.auth.uid && a.active == true && a.role in ['collector','reviewer','manager'] &&
          get(/databases/$(database)/documents/qmentumConfig/current).data.enabled == true &&
          (d.operation == 'PUBLISH_DEFINITION' && a.role == 'manager' || d.operation == 'SAVE_MONTH' && d.payload.unitId in a.units &&
            get(/databases/$(database)/documents/qmentumUnits/$(d.payload.unitId)).data.active == true);
      }
      allow get: if activeUser() && (resource == null || resource.data.actorUid == request.auth.uid);
      allow list,update,delete: if false;
      allow create: if request.resource.data.keys().hasOnly(['actorUid','payloadHash','operation','payload','status','createdAt']) &&
        request.resource.data.actorUid == request.auth.uid && request.resource.data.payloadHash.matches('^[a-f0-9]{64}$') &&
        id == request.auth.uid+'_'+request.resource.data.payloadHash && request.resource.data.payload is map &&
        request.resource.data.status == 'PENDING' && request.resource.data.createdAt == request.time && allowed(request.resource.data);
    }
`;
const output=base.slice(0,position)+'\n// BEGIN QMENTUM_FA\n'+scopeQmentumFragment(fragment)+analysisRules+uniqueParticipation+commandRules+'\n// END QMENTUM_FA\n'+base.slice(position);
await writeFile(args.length?args[3]:new URL('../firestore.qmentum.rules',import.meta.url),output);
console.log('QMENTUM_RULES_PREPARED_LOCAL');
