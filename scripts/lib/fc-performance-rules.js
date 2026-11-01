const begin='    // BEGIN_FC_PERFORMANCE_V1',end='    // END_FC_PERFORMANCE_V1';
const block=`
${begin}
    function fcPerformanceMember_() {
      return activeUser() && request.auth.token.aud == 'indicadores---sahmt' &&
        request.auth.token.iss == 'https://securetoken.google.com/indicadores---sahmt';
    }
    function fcPerformanceOwnRecord_() {
      return fcPerformanceMember_() && resource.data.uid == request.auth.uid && resource.data.category == 'PERFORMANCE';
    }
    match /fcPerformanceRuntime/state {
      allow get: if fcPerformanceMember_();
      allow list, create, update, delete: if false;
    }
    match /fcPerformanceReference/team {
      allow get: if fcPerformanceMember_();
      allow list, create, update, delete: if false;
    }
    match /fcPerformanceSummaries/{uid} {
      allow get: if fcPerformanceMember_() && uid == request.auth.uid && (resource == null || resource.data.uid == uid);
      allow list, create, update, delete: if false;
    }
    match /fcPerformanceAwards/{id} {
      allow get: if fcPerformanceOwnRecord_();
      allow list: if fcPerformanceOwnRecord_() && request.query.limit != null && request.query.limit <= 200;
      allow create, update, delete: if false;
    }
    match /fcPerformanceLedger/{id} {
      allow get: if fcPerformanceOwnRecord_();
      allow list: if fcPerformanceOwnRecord_() && request.query.limit != null && request.query.limit <= 200;
      allow create, update, delete: if false;
    }
    match /fcPerformanceSourceReceipts/{id} {
      allow read, write: if false;
    }
${end}
`;
export function buildFcPerformanceRules(input){
 if(typeof input!=='string')throw Error('FC_PERFORMANCE_RULE_BASE_INVALID');
 let source=input.replace(/\r\n/g,'\n');
 if(!source.includes("rules_version = '2'")||!source.includes('service cloud.firestore')||!source.includes('match /databases/{database}/documents'))throw Error('FC_PERFORMANCE_RULE_BASE_INVALID');
 const old=/\n    \/\/ BEGIN_FC_PERFORMANCE_V1[\s\S]*?    \/\/ END_FC_PERFORMANCE_V1\n/;
 source=source.replace(old,'');
 if(/match \/fcPerformance[A-Za-z]*\//.test(source))throw Error('FC_PERFORMANCE_RULE_CONFLICT');
 const closing=source.lastIndexOf('  }\n}');if(closing<0||source.slice(closing).trim()!=='}\n}')throw Error('FC_PERFORMANCE_RULE_BASE_INVALID');
 return source.slice(0,closing)+block+source.slice(closing);
}
