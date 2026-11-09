const fn='fiLegacyAdminWritable_';
const marker='    // FI_ADMIN_CUTOVER_V1';
const prefix='  match /databases/{database}/documents {';
const gate=`${marker}
    function ${fn}() {
      let path = /databases/$(database)/documents/fiAdministrativeCutover/current;
      return !exists(path) || get(path).data.get('active', false) != true;
    }`;

export function addFiCutoverRules(input,station){
 if(!['FA','FJ'].includes(station)||typeof input!=='string')throw Error('FI_RULES_INPUT');
 let text=input.replaceAll('\r\n','\n');
 if(text.includes(marker))throw Error('FI_RULES_ALREADY_PATCHED');
 const replace=(search,next)=>{
  if(text.split(search).length!==2)throw Error('FI_RULES_ANCHOR_MISMATCH');
  text=text.replace(search,next);
 };
 const gateAllow=anchor=>replace(anchor,anchor.replace('if ','if '+fn+'() && '));
 replace(prefix,prefix+'\n'+gate);
 if(station==='FA'){
  gateAllow("allow update: if isAdmin() && request.resource.data.uid == uid &&");
  gateAllow("allow create: if can('usersManage') && validUserProfile(request.resource.data, uid)");
  replace('allow update: if mayManageUser(uid) ||','allow update: if ('+fn+'() && mayManageUser(uid)) ||');
  if(text.includes('|| adminFirstLoginCohortUpdate(uid) ||'))replace('|| adminFirstLoginCohortUpdate(uid) ||','|| ('+fn+'() && adminFirstLoginCohortUpdate(uid)) ||');
  gateAllow('allow update: if validAccessRequestApproval(uid);');
  gateAllow("allow create: if configId == 'app' && isAdmin() && validAppConfig(request.resource.data)");
  gateAllow("allow update: if configId == 'app' && isAdmin() && validAppConfig(request.resource.data)");
 }else{
  gateAllow("allow create: if moduleSession() && (can('peopleManage') && validContact");
  gateAllow("allow update: if moduleSession() && (can('peopleManage') && resource.data.sigla == sigla");
  gateAllow("allow create, update: if moduleSession() && (can('peopleManage') && validEventMember");
 }
 return text;
}
