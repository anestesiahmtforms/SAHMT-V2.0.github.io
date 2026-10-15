const demand=(value,code)=>{if(!value)throw Error(code);};
/** Add only the occurrence domain to a backed-up FA ruleset. Never replace
 * the identity, management retirement gates or unrelated operational rules. */
export function prepareOccurrenceFaRules(faSource,fcSource){
 demand(typeof faSource==='string'&&typeof fcSource==='string'&&!faSource.includes('match /occurrenceReports/'), 'OCCURRENCE_FA_RULES_INPUT_INVALID');
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
 return fa.slice(0,position)+block+fa.slice(position);
}
export function prepareOccurrenceSourceRules(source){
 demand(typeof source==='string'&&source.includes('function canWrite()')&&!source.includes('occurrenceSourceOpen_'),'OCCURRENCE_SOURCE_RULES_INPUT_INVALID');
 const helper="function occurrenceSourceOpen_() { let path = /databases/$(database)/documents/occurrenceRuntime/faConsolidation; return !exists(path) || get(path).data.retired != true; }\n    ";
 return source.replace('function signedFromFa()',helper+'function signedFromFa()')
  .replaceAll("database == '(default)' && request.auth != null","occurrenceSourceOpen_() && database == '(default)' && request.auth != null")
  .replace('function canWrite() { return signedFromFa()', 'function canWrite() { return occurrenceSourceOpen_() && signedFromFa()');
}
