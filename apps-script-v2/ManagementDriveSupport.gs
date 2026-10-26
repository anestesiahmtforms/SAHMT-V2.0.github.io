// Shared authenticated Drive transport used by document/question maintenance. No PDF reader, conversion or timer.
function managementDriveError_(code) { throw new Error(code); }
function managementDriveRequest_(url,options) {
  if(!/^https:\/\/www\.googleapis\.com\/(?:upload\/)?drive\/v[23]\//.test(url))managementDriveError_('MANAGEMENT_DRIVE_ENDPOINT_INVALID');
  const opts=Object.assign({method:'get'},options||{});opts.headers=Object.assign({Authorization:'Bearer '+ScriptApp.getOAuthToken()},opts.headers||{});
  opts.muteHttpExceptions=true;opts.followRedirects=false;
  const r=UrlFetchApp.fetch(url,opts),status=r.getResponseCode();
  if(status<200||status>=300)managementDriveError_('MANAGEMENT_DRIVE_DRIVE_HTTP_'+status);
  return r;
}
function managementDriveJson_(url,options) { const r=managementDriveRequest_(url,options);return JSON.parse(r.getContentText()||'{}'); }
function managementDrivePermissions_(id) {
  const entries=[],seen={};let page='';
  do {
    const result=managementDriveJson_('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(id)+'/permissions?pageSize=100&fields=nextPageToken,permissions(id,type,role,emailAddress,domain,view,permissionDetails)'+(page?'&pageToken='+encodeURIComponent(page):''));
    if(!Array.isArray(result.permissions))managementDriveError_('MANAGEMENT_DRIVE_PERMISSIONS_INVALID');
    entries.push.apply(entries,result.permissions);page=result.nextPageToken||'';
    if(entries.length>1000||page&&seen[page])managementDriveError_('MANAGEMENT_DRIVE_PERMISSIONS_LIMIT');
    if(page)seen[page]=true;
  } while(page);
  return entries;
}
