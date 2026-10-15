const demand=(value,code)=>{if(!value)throw Error(code);};
/** Performance entries include the occurrence/report link. Cross-user detail
 * therefore needs explicit audit access, including pre-migration entries.
 * Aggregate totals and governance remain independently readable. */
export function prepareOccurrenceLedgerPrivacyRules(source){
 demand(typeof source==='string','OCCURRENCE_LEDGER_RULES_INPUT_INVALID');
 if(source.includes('function evaluationPrivateDetail(data)'))return source;
 const helper=`
    function evaluationPrivateDetail(data) {
      return activeUser() && (data.uid == request.auth.uid || (isAdmin() &&
        (data.category == 'GOVERNANCE' || (profile().permissions.keys().hasAny(['occurrencesAuditRead']) && profile().permissions.occurrencesAuditRead == true))));
    }
`;
 demand(source.includes('    match /evaluationActivities/'),'OCCURRENCE_LEDGER_RULES_SOURCE_CHANGED');
 let result=source.replace('    match /evaluationActivities/',helper+'    match /evaluationActivities/');
 for(const collection of ['evaluationAwards','evaluationLedger']){
  const expression=new RegExp('(match /'+collection+'/\\{id\\} \\{[^}]*?)evaluationOwn\\(resource.data\\)');
  demand(expression.test(result),'OCCURRENCE_LEDGER_RULES_SOURCE_CHANGED');
  result=result.replace(expression,'$1evaluationPrivateDetail(resource.data)');
 }
 return result;
}
/** Collection validators stay in one exact two-segment scope. Every allow
 * explicitly checks the collection, so unrelated roots/subcollections receive
 * no new access. This avoids rebuilding the oversized global helper scope. */
export function localizeOccurrenceFaRules(source){
 if(source.includes('match /{occurrenceCollection}/{reportId}'))return source;
 const start=source.indexOf('    // BEGIN OCCURRENCES_FA_V1'),end=source.indexOf('    // END OCCURRENCES_FA_V1');
 const matches=source.indexOf('    match /occurrenceCatalogs/current',start);
 demand(start>=0&&end>matches&&matches>start,'OCCURRENCE_SCOPE_SOURCE_CHANGED');
 const helpers=source.slice(start+'    // BEGIN OCCURRENCES_FA_V1'.length,matches);
 const block=`    // BEGIN OCCURRENCES_FA_V1
    match /{occurrenceCollection}/{reportId} {${helpers}
      allow get: if (occurrenceCollection == 'occurrenceCatalogs' && reportId == 'current' && occurrence_canCatalog()) ||
        (occurrenceCollection == 'occurrenceReports' && occurrence_canReadReport(reportId)) ||
        (occurrenceCollection in ['occurrenceAudit','occurrenceScoreClaims'] && occurrence_canReadPrivate(reportId));
      allow list: if request.query.limit != null && request.query.limit <= 50 &&
        ((occurrenceCollection == 'occurrenceReports' && occurrence_canRead()) ||
         (occurrenceCollection in ['occurrenceAudit','occurrenceScoreClaims'] && occurrence_canAudit()));
      allow create: if occurrence_canWrite() &&
        ((occurrenceCollection == 'occurrenceReports' && !exists(occurrence_reportPath(reportId)) && occurrence_validReport(reportId, request.resource.data)) ||
         (occurrenceCollection == 'occurrenceAudit' && !exists(occurrence_auditPath(reportId)) && occurrence_validAudit(reportId, request.resource.data)) ||
         (occurrenceCollection == 'occurrenceScoreClaims' && !exists(occurrence_scorePath(reportId)) && occurrence_validScoreClaim(reportId, request.resource.data))) &&
        occurrence_pairedAfter(reportId);
      allow update, delete: if false;
    }
`;
 return source.slice(0,start)+block+source.slice(end);
}
/** Add only the occurrence domain to a backed-up FA ruleset. Never replace
 * the identity, management retirement gates or unrelated operational rules. */
export function prepareOccurrenceFaRules(faSource,fcSource){
 demand(typeof faSource==='string'&&typeof fcSource==='string'&&!faSource.includes('BEGIN OCCURRENCES_FA_V1')&&!faSource.includes('match /occurrenceReports/'), 'OCCURRENCE_FA_RULES_INPUT_INVALID');
 let source=fcSource.replaceAll('\r\n','\n');
 const start=source.indexOf('    function signedFromFa()'),end=source.indexOf('    // Preserve the existing bounded read probe');
 demand(start>0&&end>start,'OCCURRENCE_FA_RULES_SOURCE_CHANGED');source=source.slice(start,end);
 source=source.replace(/function signedFromFa\(\) \{[\s\S]*?\n    \}/,
  "function signedFromFa() { return database == '(default)' && activeUser() && profile().uid == request.auth.uid && occurrenceDomainActive_(); }");
 for(const [name,body]of Object.entries({canCatalog:'signedFromFa()',canWrite:'signedFromFa()',
  canRead:"signedFromFa() && profile().permissions.keys().hasAny(['occurrencesRead']) && profile().permissions.occurrencesRead == true",
  canAudit:"signedFromFa() && profile().permissions.keys().hasAny(['occurrencesAuditRead']) && profile().permissions.occurrencesAuditRead == true"})){
  const expression=new RegExp('function '+name+'\\(\\) \\{[^}]+\\}');demand(expression.test(source),'OCCURRENCE_FA_RULES_SOURCE_CHANGED');
  source=source.replace(expression,'function '+name+'() { return '+body+'; }');
 }
 const names=[...source.matchAll(/function (\w+)\(/g)].map(match=>match[1]);
 for(const name of names)source=source.replace(new RegExp('\\b'+name+'\\b','g'),'occurrence_'+name);
 source=source.replaceAll("'source','sourceId','uid'","'source','sourceId','originProjectId','uid'")
  .replace('data.sourceId == reportId && data.uid == request.auth.uid',"data.sourceId == reportId && data.originProjectId == 'sahmt-17a16' && data.uid == request.auth.uid");
 demand(!source.includes('sahmtOccurrences')&&source.includes('data.originProjectId'),'OCCURRENCE_FA_RULES_CLAIMS_REMAIN');
 const block=`\n    // BEGIN OCCURRENCES_FA_V1\n    function occurrenceDomainActive_() {
      let path = /databases/$(database)/documents/occurrenceRuntime/faConsolidation;
      return exists(path) && get(path).data.status == 'ACTIVE';
    }\n${source}    // END OCCURRENCES_FA_V1\n`;
 const fa=faSource.replaceAll('\r\n','\n'),position=fa.lastIndexOf('\n  }\n}');
 demand(position>0,'OCCURRENCE_FA_RULES_ROOT_INVALID');
 return localizeOccurrenceFaRules(prepareOccurrenceLedgerPrivacyRules(fa.slice(0,position)+block+fa.slice(position)));
}
export function prepareOccurrenceSourceRules(source){
 demand(typeof source==='string'&&source.includes('function canWrite()')&&!source.includes('occurrenceSourceOpen_'),'OCCURRENCE_SOURCE_RULES_INPUT_INVALID');
 const helper="function occurrenceSourceOpen_() { let path = /databases/$(database)/documents/occurrenceRuntime/faConsolidation; return !exists(path) || get(path).data.retired != true; }\n    ";
 return source.replace('function signedFromFa()',helper+'function signedFromFa()')
  .replaceAll("database == '(default)' && request.auth != null","occurrenceSourceOpen_() && database == '(default)' && request.auth != null")
  .replace('function canWrite() { return signedFromFa()', 'function canWrite() { return occurrenceSourceOpen_() && signedFromFa()');
}
