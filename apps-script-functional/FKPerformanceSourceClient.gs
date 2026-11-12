/** Copy this helper into an approved source Apps Script project to push FK rows. */
function fkPushPerformanceSourceSnapshot_(source, cutoff, effectiveFrom, rows) {
  if (['FG','FJ','FC','FE'].indexOf(source) < 0 || !Number.isSafeInteger(cutoff) ||
      cutoff < Date.parse('2026-12-01T03:00:00.000Z') || !Number.isSafeInteger(effectiveFrom) ||
      effectiveFrom < Date.parse('2026-12-01T03:00:00.000Z') || effectiveFrom >= cutoff ||
      !Array.isArray(rows) || rows.length > 30000)
    throw new Error('FK_SOURCE_BATCH_INVALID');
  var properties = PropertiesService.getScriptProperties();
  var secret = properties.getProperty('FK_SOURCE_HMAC_SECRET_' + source);
  var url = properties.getProperty('FK_APPS_SCRIPT_URL');
  if (!secret || secret.length < 32 || !url || !/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url))
    throw new Error('FK_SOURCE_PUSH_CONFIG_REQUIRED');
  function post(payload) {
    var body=JSON.stringify(payload),timestamp=String(Date.now()),nonce=Utilities.getUuid();
    var message=timestamp+'\n'+nonce+'\n'+body;
    var signature=Utilities.computeHmacSha256Signature(message,secret,Utilities.Charset.UTF_8)
      .map(function(value){return ('0'+((value+256)%256).toString(16)).slice(-2);}).join('');
    var response=UrlFetchApp.fetch(url,{method:'post',contentType:'application/json',muteHttpExceptions:true,
      payload:JSON.stringify({timestamp:timestamp,nonce:nonce,payload:body,signature:signature})});
    var result;try{result=JSON.parse(response.getContentText());}catch(_){throw new Error('FK_SOURCE_PUSH_RESPONSE_INVALID');}
    if(response.getResponseCode()<200||response.getResponseCode()>=300)return {code:result.code||'FK_SOURCE_PUSH_FAILED'};
    return result;
  }

  var chunks = [], current = [], currentBytes = 0;
  rows.forEach(function(row) {
    var size = Utilities.newBlob(JSON.stringify(row)).getBytes().length + 1;
    if (size > 300000) throw new Error('FK_SOURCE_ROW_TOO_LARGE');
    if (current.length >= 400 || currentBytes + size > 300000) {
      chunks.push(current); current = []; currentBytes = 0;
    }
    current.push(row); currentBytes += size;
  });
  if (current.length || !chunks.length) chunks.push(current);
  if (chunks.length > 100) throw new Error('FK_SOURCE_BATCH_LIMIT');

  var results = [];
  chunks.forEach(function(chunk, chunkIndex) {
    var payload = {action:'PERFORMANCE_SOURCE_PUSH',source:source,cutoff:cutoff,effectiveFrom:effectiveFrom,
      chunkIndex:chunkIndex,chunkCount:chunks.length,rows:chunk};
    var result=post(payload);
    if (result.code!=='FK_SOURCE_BATCH_SAVED')
      throw new Error('FK_SOURCE_PUSH_FAILED');
    results.push({source:source,cutoff:cutoff,chunkIndex:chunkIndex,rowCount:chunk.length});
  });
  var published=post({action:'PERFORMANCE_SOURCE_PUBLISH',source:source,cutoff:cutoff,effectiveFrom:effectiveFrom,
    chunkCount:chunks.length,rowCount:rows.length});
  if(published.code!=='FK_SOURCE_BATCH_PUBLISHED')throw new Error('FK_SOURCE_PUBLISH_FAILED');
  return {code:'FK_SOURCE_SNAPSHOT_PUSHED',source:source,cutoff:cutoff,chunks:results,published:true};
}
