/** Publishes a cutoff-pinned FG ledger snapshot to FK; this file never reads FB. */
function fgFkPerformanceRows_(cutoff, effectiveFrom, since) {
  const collection = 'fgPerformanceLedger';
  const prefix = 'projects/' + SAHMT_V2_CONFIG.projectId + '/databases/(default)/documents/' + collection + '/';
  const rows = [];
  let cursor = null;
  for (;;) {
    const query = {
      from:[{collectionId:collection}],
      where:{compositeFilter:{op:'AND',filters:[
        {fieldFilter:{field:{fieldPath:'createdAt'},op:'GREATER_THAN_OR_EQUAL',value:{timestampValue:new Date(since).toISOString()}}},
        {fieldFilter:{field:{fieldPath:'createdAt'},op:'LESS_THAN',value:{timestampValue:cutoff.toISOString()}}}
      ]}},
      orderBy:[{field:{fieldPath:'createdAt'},direction:'ASCENDING'},{field:{fieldPath:'__name__'},direction:'ASCENDING'}],
      limit:1000,
      ...(cursor?{startAt:{values:[{timestampValue:cursor.createdAtRaw},{referenceValue:cursor._name}],before:false}}:{})
    };
    const result = firestoreRequest_(firestoreDocumentsUrl_(':runQuery'), {method:'post',contentType:'application/json',
      payload:JSON.stringify({structuredQuery:query,readTime:cutoff.toISOString()})});
    if (!Array.isArray(result) || result.some(function(item) { return item.error || item.readTime && Date.parse(item.readTime)!==cutoff.getTime(); }))
      throw Error('FG_FK_SOURCE_QUERY_INCOMPLETE');
    const documents = result.filter(function(item) { return item.document; }).map(function(item) { return item.document; });
    if (documents.some(function(document) { return typeof document.name!=='string' || !document.name.startsWith(prefix) || document.name.slice(prefix.length).includes('/'); }))
      throw Error('FG_FK_SOURCE_SCOPE_DENIED');
    for (const document of documents) {
      const entry = evaluationDocument_(document);
      if (entry.sourceType!=='CHECKLIST' || entry.sourceProjectId!==SAHMT_V2_CONFIG.projectId ||
          typeof entry.uid!=='string' || !/^[A-Za-z0-9_.@+:%-]{1,128}$/.test(entry.uid) ||
          !Number.isFinite(entry.delta) || ![-1,1].includes(entry.delta) || entry.points!==entry.delta ||
          !(entry.createdAt instanceof Date) || entry.createdAt.getTime()<effectiveFrom.getTime() || entry.createdAt.getTime()<since || entry.createdAt>=cutoff)
        throw Error('FG_FK_SOURCE_ROW_INVALID');
      rows.push({id:entry.id,uid:entry.uid,category:'OPERATIONS',points:entry.delta,
        createdAt:entry.createdAt.getTime(),label:'Checklist'});
      if (rows.length>30000) throw Error('FG_FK_SOURCE_BATCH_LIMIT');
    }
    if (documents.length<1000) break;
    const last=documents[documents.length-1],rawTimestamp=last.fields&&last.fields.createdAt&&last.fields.createdAt.timestampValue;
    if(typeof rawTimestamp!=='string'||!last.name)throw Error('FG_FK_SOURCE_CURSOR_INVALID');
    cursor={createdAtRaw:rawTimestamp,_name:last.name};
  }
  return rows;
}

function fgPublishPerformanceToFk_(cutoff) {
  const runtime = evaluationGet_('fgPerformanceRuntime','state');
  if (!runtime || runtime.status!=='ACTIVE' || runtime.projectId!==SAHMT_V2_CONFIG.projectId ||
      runtime.rule!=='FG_DAILY_TEAM_ACKNOWLEDGEMENT_TRANSFER_V2' || !(runtime.activatedAt instanceof Date) ||
      !Number.isFinite(runtime.activatedAt.getTime()) || runtime.activatedAt>=cutoff)
    throw Error('FG_FK_SOURCE_RUNTIME_INVALID');
  const effectiveFrom = new Date(Math.max(runtime.activatedAt.getTime(),Date.parse('2026-12-01T03:00:00.000Z')));
  const properties = PropertiesService.getScriptProperties();
  const previous = Number(properties.getProperty('FK_FG_PERFORMANCE_LAST_PUSH') || 0);
  const since = Math.max(effectiveFrom.getTime(),previous);
  if (!Number.isSafeInteger(since) || since>=cutoff.getTime()) throw Error('FG_FK_SOURCE_CURSOR_INVALID');
  const rows = fgFkPerformanceRows_(cutoff,effectiveFrom,since);
  const result = fkPushPerformanceSourceSnapshot_('FG',cutoff.getTime(),effectiveFrom.getTime(),rows);
  properties.setProperty('FK_FG_PERFORMANCE_LAST_PUSH',String(cutoff.getTime()));
  return result;
}
