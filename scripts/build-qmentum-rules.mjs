import {readFile,writeFile} from 'node:fs/promises';
import {COUNT_KEYS,QMENTUM_IDS,QMENTUM_INDICATORS} from '../src/qmentum-catalog.js';
import {scopeQmentumFragment} from './lib/qmentum-rule-scope.js';
const args=process.argv.slice(2);
if(args.length&&!(args.length===4&&args[0]==='--base'&&args[2]==='--out'))throw Error('QMENTUM_RULE_ARGUMENT_INVALID');
const list=keys=>'['+keys.map(k=>`'${k}'`).join(',')+']';
const countGroups=Array.from({length:Math.ceil(COUNT_KEYS.length/8)},(_,i)=>COUNT_KEYS.slice(i*8,i*8+8));
const counts=countGroups.map((_,i)=>`qmFields${i}(d)`).join(' && ');
const fieldFunctions=countGroups.map((keys,i)=>`function qmFields${i}(d) { return ${keys.map(k=>`qmCount(d.counts.${k})`).join(' && ')}; }`).join('\n');
const rateChecks=QMENTUM_IDS.map(k=>`qmRate(d.informedRates.${k})`).join(' && ');
const defChecks=QMENTUM_INDICATORS.map(d=>`qmDefinitionItem(d.items.${d.id}, '${d.denominator}')`).join(' &&\n        ');
const resultChecks=QMENTUM_INDICATORS.map(d=>`qmResult(d, '${d.id}', '${d.numerator}', '${d.denominator}', ${d.rule==='complement'})`).join(' &&\n        ');
const closeChecks=QMENTUM_IDS.map(id=>`d.results.${id}.status in ['VALID','NOT_APPLICABLE']`).join(' && ');
const receiptChecks=[9,10,11].map(group=>`getAfter(/databases/$(database)/documents/qmentumUnits/$(unit)/months/$(period)/validation/$(string(d.version)+'_${group}')).data.snapshot == d`).join(' && ');
const resultGroups=Array.from({length:9},(_,group)=>`function qmResults${group}(d) { return ${QMENTUM_INDICATORS.slice(group*2,group*2+2).map(d=>`qmResult(d,'${d.id}','${d.numerator}','${d.denominator}',${d.rule==='complement'})`).join(' && ')}; }`).join('\n');
const inputKeys=['counts','notApplicable','origins','informedRates','legacyRates','attribution48','attribution30','uniqueEventProceduresConfirmed','techniqueUniverseConfirmed','comment'];
const keys=['schemaVersion','unitId','year','month','period','version','status','inputs','results','definitionVersion','referenceVersion','engineVersion','referenceDate','importHash','createdBy','createdAt','updatedBy','updatedAt','action','reason','reviewedBy'];
const fragment=`
    // QMENTUM: unit grants are provisioned by a trusted administrator, never by this client.
    function qmSigned() { return database == '(default)' && activeUser() && profile().uid == request.auth.uid; }
    function qmAccess() { return get(/databases/$(database)/documents/qmentumAccess/$(request.auth.uid)).data; }
    function qmEnabled() { return get(/databases/$(database)/documents/qmentumConfig/current).data.enabled == true; }
    function qmMember() { return qmSigned() && qmAccess().active == true && qmAccess().uid == request.auth.uid && qmAccess().role in ['collector','reviewer','manager'] && qmEnabled(); }
    function qmUnit(unit) { return qmMember() && unit in qmAccess().units && get(/databases/$(database)/documents/qmentumUnits/$(unit)).data.active == true; }
    function qmManager() { return qmMember() && qmAccess().role == 'manager'; }
    function qmReviewer(unit) { return qmUnit(unit) && qmAccess().role in ['reviewer','manager']; }
    function qmCount(n) { return n == null || n is int && n >= 0 && n <= 10000000; }
    function qmRate(n) { return n == null || n is number && n >= 0 && n <= 1; }
    function qmField(d,k) { return qmCount(d.counts[k]) && (!(k in d.notApplicable) || d.counts[k] == null); }
    ${fieldFunctions}
    function qmInputs(d) {
      return d.keys().hasOnly(${list(inputKeys)}) && d.keys().hasAll(${list(inputKeys)}) &&
        d.counts.keys().hasOnly(${list(COUNT_KEYS)}) && d.counts.keys().hasAll(${list(COUNT_KEYS)}) &&
        d.origins.keys().hasOnly(${list(COUNT_KEYS)}) && d.origins.keys().hasAll(${list(COUNT_KEYS)}) &&
        d.origins.values().toSet().hasOnly(['MANUAL','UNINFORMED','IMPORTED']) &&
        d.notApplicable is list && d.notApplicable.size() <= ${COUNT_KEYS.length} && d.notApplicable.hasOnly(${list(COUNT_KEYS)}) &&
        d.informedRates.keys().hasOnly(${list(QMENTUM_IDS)}) && d.informedRates.keys().hasAll(${list(QMENTUM_IDS)}) &&
        d.legacyRates is map && d.legacyRates.keys().hasOnly(${list(QMENTUM_IDS)}) &&
        d.attribution48 is bool && d.attribution30 is bool && d.uniqueEventProceduresConfirmed is bool && d.techniqueUniverseConfirmed is bool &&
        d.comment is string && d.comment.size() <= 2000;
    }
    function qmRates(d) { return ${rateChecks}; }
    function qmInputNumbers(d) { return ${COUNT_KEYS.slice(0,Math.ceil(COUNT_KEYS.length/2)).map(k=>`qmCount(d.counts.${k})`).join(' && ')}; }
    function qmAuditNumbers(d) { return ${COUNT_KEYS.slice(Math.ceil(COUNT_KEYS.length/2)).map(k=>`qmCount(d.counts.${k})`).join(' && ')}; }
    function qmDefinitionItem(d,population) {
      return d.keys().hasOnly(['approved','criterion','target','targetSource','targetValidated','populationKey']) &&
        d.approved is bool && d.targetValidated is bool && qmRate(d.target) &&
        d.criterion is string && d.criterion.size() <= 1500 && (!d.approved || d.criterion.size() >= 8) &&
        d.targetSource in ['NONE','WORKSHEET','INSTITUTION'] && d.populationKey == population && (!d.targetValidated || d.target != null);
    }
    function qmDefinition(d,version) {
      return d.keys().hasOnly(['version','validFrom','reason','referenceVersion','items','createdBy','createdAt']) &&
        d.version is int && d.version > 0 && string(d.version) == version && d.validFrom.matches('^[0-9]{4}-(0[1-9]|1[0-2])$') &&
        d.reason is string && d.reason.size() >= 8 && d.reason.size() <= 1000 && d.referenceVersion == 'references-2026-10-14' &&
        d.items.keys().hasOnly(${list(QMENTUM_IDS)}) && d.items.keys().hasAll(${list(QMENTUM_IDS)}) &&
        d.createdBy == request.auth.uid && d.createdAt == request.time &&
        ${[0,1,2].map(i=>`getAfter(/databases/$(database)/documents/qmentumDefinitions/$(version)/validation/${i}).data.snapshot == d`).join(' && ')};
    }
    ${[0,1,2].map(i=>`function qmDefinitionGroup${i}(d) { return ${QMENTUM_INDICATORS.slice(i*6,i*6+6).map(x=>`qmDefinitionItem(d.items.${x.id},'${x.denominator}')`).join(' && ')}; }`).join('\n')}
    function qmFollowup(i,id) {
      return id == 'QM15' ? i.counts.pending48 == 0 && i.counts.followed48 == i.counts.eligible48 && i.attribution48 :
        id == 'QM16' ? i.counts.pending30 == 0 && i.counts.followed30 == i.counts.eligible30 && i.attribution30 : true;
    }
    function qmFollowupInvalid(i,id) {
      return id == 'QM15' ? i.counts.followed48 != null && i.counts.pending48 != null && (i.counts.followed48+i.counts.pending48 != i.counts.eligible48 || i.counts.deaths48 > i.counts.followed48) :
        id == 'QM16' ? i.counts.followed30 != null && i.counts.pending30 != null && (i.counts.followed30+i.counts.pending30 != i.counts.eligible30 || i.counts.deaths30 > i.counts.followed30) : false;
    }
    function qmStatus(d,id,nKey,dKey) {
      let n=d.inputs.counts[nKey]; let den=d.inputs.counts[dKey];
      let cfg=get(/databases/$(database)/documents/qmentumDefinitions/$(string(d.definitionVersion))).data.items[id];
      return n != null && den != null && n > den ? 'INCONSISTENT' :
        nKey in d.inputs.notApplicable || dKey in d.inputs.notApplicable ? 'NOT_APPLICABLE' :
        n == null || den == null ? (d.inputs.informedRates[id] == null ? 'PENDING' : 'INFORMED') :
        den == 0 ? 'NOT_APPLICABLE' : qmFollowupInvalid(d.inputs,id) ? 'INCONSISTENT' :
        !qmFollowup(d.inputs,id) ? 'FOLLOWUP_PENDING' :
        id == 'QM14' && !d.inputs.uniqueEventProceduresConfirmed ? 'PROVISIONAL' :
        cfg.approved ? 'VALID' : 'PROVISIONAL';
    }
    function qmResult(d,id,nKey,dKey,complement) {
      let r=d.results[id]; let n=d.inputs.counts[nKey]; let den=d.inputs.counts[dKey];
      let status=qmStatus(d,id,nKey,dKey);
      let ratio=status == 'INFORMED' ? d.inputs.informedRates[id] :
        status in ['VALID','PROVISIONAL'] && n != null && den != null && den > 0 && (id != 'QM14' || d.inputs.uniqueEventProceduresConfirmed) ?
          (complement ? 1.0 - n * 1.0 / den : n * 1.0 / den) : null;
      return r.indicatorId == id && r.definitionVersion == d.definitionVersion && r.inputVersion == d.version &&
        r.N == n && r.D == den && r.status == status &&
        (!(nKey in d.inputs.notApplicable) || n == null) && (!(dKey in d.inputs.notApplicable) || den == null) && r.ratio == ratio;
    }
    ${resultGroups}
    function qmChildren(d,unit,period,group) {
      let base=(group-9)*3;
      return getAfter(/databases/$(database)/documents/qmentumUnits/$(unit)/months/$(period)/validation/$(string(d.version)+'_'+string(base))).data.snapshot == d &&
        getAfter(/databases/$(database)/documents/qmentumUnits/$(unit)/months/$(period)/validation/$(string(d.version)+'_'+string(base+1))).data.snapshot == d &&
        getAfter(/databases/$(database)/documents/qmentumUnits/$(unit)/months/$(period)/validation/$(string(d.version)+'_'+string(base+2))).data.snapshot == d;
    }
    function qmMonth(d,unit,period) {
      return d.keys().hasOnly(${list(keys)}) && d.keys().hasAll(${list(keys)}) && d.schemaVersion == 1 &&
        d.unitId == unit && d.period == period && d.year is int && d.year >= 1900 && d.year <= 2200 &&
        d.month is int && d.month >= 1 && d.month <= 12 && period == string(d.year)+'-'+(d.month < 10 ? '0' : '')+string(d.month) &&
        d.referenceDate is string && d.referenceDate.matches('^'+period+'-[0-9]{2}$') &&
        d.version is int && d.version >= 1 && d.definitionVersion is int && d.definitionVersion >= 1 &&
        get(/databases/$(database)/documents/qmentumDefinitions/$(string(d.definitionVersion))).data.validFrom <= period &&
        d.referenceVersion == 'references-2026-10-14' && d.engineVersion == 'qmentum-1' &&
        d.updatedBy == request.auth.uid && d.updatedAt == request.time &&
        d.reason is string && d.reason.size() <= 1000 &&
        (d.importHash == null || d.importHash is string && d.importHash.matches('^[a-f0-9]{64}$')) &&
        d.results.keys().hasOnly(${list(QMENTUM_IDS)}) && d.results.size() == 18 &&
        ${receiptChecks} &&
        getAfter(/databases/$(database)/documents/qmentumUnits/$(unit)/months/$(period)/history/$(string(d.version))).data == d;
    }
    function qmNew(d,unit) {
      return d.version == 1 && d.status == 'DRAFT' && d.createdAt == request.time && d.createdBy == request.auth.uid && d.reviewedBy == null &&
        (d.action == 'SAVE' && d.importHash == null || d.action == 'IMPORT' && qmManager() &&
        get(/databases/$(database)/documents/qmentumUnits/$(unit)/imports/$(d.importHash)).data.year == d.year &&
        get(/databases/$(database)/documents/qmentumUnits/$(unit)/imports/$(d.importHash)).data.status == 'STAGED');
    }
    function qmChange(d,old,unit) {
      return d.version == old.version+1 && d.createdAt == old.createdAt && d.createdBy == old.createdBy &&
        (d.definitionVersion == old.definitionVersion || d.action == 'REBASE' && d.definitionVersion == get(/databases/$(database)/documents/qmentumConfig/current).data.definitionVersion) && d.importHash == old.importHash &&
        (d.action == 'SAVE' && old.status != 'CLOSED' && d.status == 'DRAFT' && d.reviewedBy == null ||
         d.inputs == old.inputs && (
          d.action == 'REVIEW' && old.status == 'DRAFT' && d.status == 'REVIEWED' && qmReviewer(unit) && d.reviewedBy == request.auth.uid ||
          d.action == 'CLOSE' && old.status == 'REVIEWED' && d.status == 'CLOSED' && qmReviewer(unit) && d.reviewedBy == old.reviewedBy ||
          d.action == 'REOPEN' && old.status == 'CLOSED' && d.status == 'DRAFT' && qmManager() && d.reason.size() >= 8 && d.reviewedBy == null ||
          d.action == 'REBASE' && old.status == 'DRAFT' && d.status == 'DRAFT' && qmManager() && d.reason.size() >= 8 && d.reviewedBy == null));
    }
    match /qmentumAccess/{uid} { allow get: if qmSigned() && request.auth.uid == uid; allow list,write: if false; }
    match /qmentumConfig/current {
      allow get: if qmSigned() && qmAccess().active == true;
      allow update: if qmManager() && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['definitionVersion']) &&
        request.resource.data.definitionVersion == resource.data.definitionVersion+1 &&
        getAfter(/databases/$(database)/documents/qmentumDefinitions/$(string(request.resource.data.definitionVersion))).data.createdAt == request.time;
      allow create,delete,list: if false;
    }
    match /qmentumDefinitions/{version} {
      allow get: if qmMember(); allow list,update,delete: if false;
      allow create: if qmManager() && qmDefinition(request.resource.data,version) &&
        request.resource.data.version == get(/databases/$(database)/documents/qmentumConfig/current).data.definitionVersion+1 &&
        getAfter(/databases/$(database)/documents/qmentumConfig/current).data.definitionVersion == request.resource.data.version;
      match /validation/{group} {
        allow read,update,delete: if false;
        allow create: if qmManager() && group in ['0','1','2'] && request.resource.data.keys().hasOnly(['snapshot']) &&
          !exists(/databases/$(database)/documents/qmentumDefinitions/$(version)) &&
          request.resource.data.snapshot == getAfter(/databases/$(database)/documents/qmentumDefinitions/$(version)).data &&
          (group == '0' ? qmDefinitionGroup0(request.resource.data.snapshot) : group == '1' ? qmDefinitionGroup1(request.resource.data.snapshot) : qmDefinitionGroup2(request.resource.data.snapshot));
      }
    }
    match /qmentumUnits/{unit} {
      allow get: if qmMember() && unit in qmAccess().units; allow list,write: if false;
      match /months/{period} {
        allow get: if qmUnit(unit); allow list: if qmUnit(unit) && request.query.limit != null && request.query.limit <= 12;
        allow create: if qmUnit(unit) && qmNew(request.resource.data,unit) && qmMonth(request.resource.data,unit,period);
        allow update: if qmUnit(unit) && qmChange(request.resource.data,resource.data,unit) && qmMonth(request.resource.data,unit,period);
        allow delete: if false;
        match /history/{version} {
          allow get: if qmUnit(unit); allow list: if qmUnit(unit) && request.query.limit != null && request.query.limit <= 30;
          allow create: if qmUnit(unit) && request.resource.data.version == int(version) &&
            qmRates(request.resource.data.inputs) &&
            (request.resource.data.status != 'CLOSED' || ${closeChecks.replaceAll('d.results','request.resource.data.results')}) &&
            (request.resource.data.action != 'REVIEW' || ${QMENTUM_IDS.map(id=>`request.resource.data.results.${id}.status != 'INCONSISTENT'`).join(' && ')}) &&
            request.resource.data == getAfter(/databases/$(database)/documents/qmentumUnits/$(unit)/months/$(period)).data &&
            (!exists(/databases/$(database)/documents/qmentumUnits/$(unit)/months/$(period)) ? int(version)==1 :
              int(version) == get(/databases/$(database)/documents/qmentumUnits/$(unit)/months/$(period)).data.version+1);
          allow update,delete: if false;
        }
        // Twelve immutable receipts divide validation into bounded rule evaluations.
        // Every receipt must equal the month in the SAME atomic commit.
        match /validation/{receipt} {
          allow get,list,update,delete: if false;
          allow create: if qmUnit(unit) && request.resource.data.keys().hasOnly(['group','snapshot']) &&
            request.resource.data.group is int && request.resource.data.group >= 0 && request.resource.data.group < 12 &&
            receipt == string(request.resource.data.snapshot.version)+'_'+string(request.resource.data.group) &&
            request.resource.data.snapshot == getAfter(/databases/$(database)/documents/qmentumUnits/$(unit)/months/$(period)).data &&
            (!exists(/databases/$(database)/documents/qmentumUnits/$(unit)/months/$(period)) ? request.resource.data.snapshot.version == 1 :
              request.resource.data.snapshot.version == get(/databases/$(database)/documents/qmentumUnits/$(unit)/months/$(period)).data.version+1) &&
            (${Array.from({length:9},(_,i)=>`request.resource.data.group == ${i} ? qmResults${i}(request.resource.data.snapshot) :`).join(' ')}
              qmChildren(request.resource.data.snapshot,unit,period,request.resource.data.group) &&
              (request.resource.data.group == 9 ? qmInputs(request.resource.data.snapshot.inputs) :
              request.resource.data.group == 10 ? qmInputNumbers(request.resource.data.snapshot.inputs) :
              qmAuditNumbers(request.resource.data.snapshot.inputs)));
        }
      }
      match /imports/{hash} {
        allow get: if qmUnit(unit) && qmManager(); allow list,update,delete: if false;
        allow create: if qmUnit(unit) && qmManager() && request.resource.data.keys().hasOnly(['schemaVersion','hash','unitId','year','status','backupReference','chunkCount','createdBy','createdAt','sheetNames']) &&
          hash.matches('^[a-f0-9]{64}$') && request.resource.data.hash == hash && request.resource.data.schemaVersion == 1 &&
          request.resource.data.unitId == unit && request.resource.data.year is int && request.resource.data.year >= 1900 && request.resource.data.year <= 2200 &&
          request.resource.data.status == 'STAGED' && request.resource.data.createdBy == request.auth.uid && request.resource.data.createdAt == request.time &&
          request.resource.data.backupReference is string && request.resource.data.backupReference.size() <= 2000 &&
          request.resource.data.chunkCount is int && request.resource.data.chunkCount > 0 && request.resource.data.chunkCount <= 40;
        match /cells/{index} {
          allow get: if qmUnit(unit) && qmManager(); allow list,update,delete: if false;
          allow create: if qmUnit(unit) && qmManager() &&
            getAfter(/databases/$(database)/documents/qmentumUnits/$(unit)/imports/$(hash)).data.createdAt == request.time &&
            request.resource.data.keys().hasOnly(['cells','hash','index']) && request.resource.data.hash == hash &&
            request.resource.data.index == int(index) && int(index) >= 0 && int(index) < getAfter(/databases/$(database)/documents/qmentumUnits/$(unit)/imports/$(hash)).data.chunkCount &&
            request.resource.data.cells is list && request.resource.data.cells.size() <= 2000;
        }
      }
    }
`;
const base=(await readFile(args.length?args[1]:new URL('../firestore.rules',import.meta.url),'utf8')).replaceAll('\r\n','\n');
const position=base.lastIndexOf('\n  }\n}');
if(position<0||base.includes('match /qmentumAccess/'))throw Error('QMENTUM_RULE_BASE_INVALID');
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
const output=base.slice(0,position)+'\n// BEGIN QMENTUM_FA\n'+scopeQmentumFragment(fragment)+analysisRules+'\n// END QMENTUM_FA\n'+base.slice(position);
await writeFile(args.length?args[3]:new URL('../firestore.qmentum.rules',import.meta.url),output);
console.log('QMENTUM_RULES_PREPARED_LOCAL');
