// Exact source adapters fail closed when the inspected upstream declaration changes.
export function adaptFcPerformanceDeclaration(name,source){
 const replace=(before,after)=>{if(source.split(before).length!==2)throw Error('FC_SOURCE_ADAPTER_MISMATCH_'+name);source=source.replace(before,after);};
 if(['evaluationGet_','evaluationGetProjected_','evaluationQuery_'].includes(name)){
  const opening=source.indexOf('{');if(opening<0)throw Error('FC_SOURCE_ADAPTER_MISMATCH_'+name);
  source=source.slice(0,opening+1)+'\n  collectionId = fcPerformanceCollection_(collectionId);'+source.slice(opening+1);
 }
 if(name==='evaluationRunTransaction_')replace('const planned = callback(started.transaction);','fcPerformanceAssertRuntimeTransaction_(started.transaction);\n      const planned = callback(started.transaction);');
 if(name==='firestoreRequest_')replace('function firestoreRequest_(url, options) {','function firestoreRequest_(url, options) {\n  fcAssertFirestoreDestination_(url, options);');
 if(name==='evaluationDeliverOccurrence_')replace("const claim = evaluationGet_('occurrenceScoreClaims', reportId, transaction);\r\n    if (expectedUid", "const claim = evaluationGet_('occurrenceScoreClaims', reportId, transaction);\r\n    fcPerformanceAssertNewSource_(claim, transaction);\r\n    if (expectedUid");
 if(name==='qmProcessParticipation_')replace("if(id!==p.analysisId+", "fcPerformanceAssertNewSource_(p,tx);\n    if(id!==p.analysisId+");
 if(name==='evaluationApplyAwards_')replace('changes.forEach(function (input) {','changes.forEach(function (input) {\n    fcPerformanceAssertAward_(input);');
 return source;
}
