import {readFile, writeFile} from 'node:fs/promises';
import {addMemberCategoryRules} from './lib/member-category-rules.js';

const source=(await readFile('firestore.occurrences.rules','utf8')).replaceAll('\r\n','\n');
const replacements=[
  ['// FC occurrence records use project-specific claims issued after FA authorization.','// FC occurrence and QMENTUM modules use FC Google Authentication and local user permissions.'],
  [`    function signedFromFa() {
      return database == '(default)' && request.auth != null &&
        request.auth.token.firebase is map &&
        request.auth.token.firebase.sign_in_provider == 'custom' &&
        request.auth.token.sahmtFaSourceProjectId == 'sahmt-17a16';
    }
    function canCatalog() { return signedFromFa() && request.auth.token.sahmtOccurrencesCatalogRead == true; }
    function canWrite() { return signedFromFa() && request.auth.token.sahmtOccurrencesWrite == true; }
    function canRead() { return signedFromFa() && request.auth.token.sahmtOccurrencesRead == true; }
    function canAudit() { return signedFromFa() && request.auth.token.sahmtOccurrencesAuditRead == true; }`,
   `    function signedIn() { return database == '(default)' && request.auth != null && request.auth.token.firebase is map && request.auth.token.firebase.sign_in_provider == 'google.com'; }
    function profilePath(uid) { return /databases/$(database)/documents/users/$(uid); }
    function hasProfile() { return signedIn() && exists(profilePath(request.auth.uid)); }
    function profile() { return get(profilePath(request.auth.uid)).data; }
    function activeUser() { return hasProfile() && profile().uid == request.auth.uid && profile().active == true && profile().access == true; }
    function profileCan(permission) { return activeUser() && profile().permissions is map && profile().permissions.keys().hasAny([permission]) && profile().permissions[permission] == true; }
    function signedFromFc() { return activeUser(); }
    function canCatalog() { return profileCan('occurrencesCatalogRead') || canWrite(); }
    function canWrite() { return profileCan('occurrencesWrite'); }
    function canRead() { return profileCan('occurrencesRead'); }
    function canAudit() { return profileCan('occurrencesAuditRead'); }`],
  ["data.keys().hasOnly(['schemaVersion','id','source','sourceId','uid','formId','points','status','createdAt']) &&",
   "data.keys().hasOnly(['schemaVersion','id','source','sourceId','originProjectId','uid','formId','points','status','createdAt']) &&"],
  ['data.sourceId == reportId && data.uid == request.auth.uid &&',
   "data.sourceId == reportId && data.uid == request.auth.uid &&\n        data.get('originProjectId', 'indicadores---sahmt') == 'indicadores---sahmt' &&"],
  [`    // Preserve the existing bounded read probe used by the indicators pilot.
    match /indicators/{indicatorId} {
      allow list: if database == '(default)' && request.auth != null &&
        request.auth.token.firebase is map &&
        request.auth.token.firebase.sign_in_provider == 'custom' &&
        request.query.limit != null && request.query.limit <= 1;
      allow get, create, update, delete: if false;
    }`,
   `    // Preserve the existing bounded indicators probe for signed-in FC users.
    match /indicators/{indicatorId} {
      allow list: if activeUser() && request.query.limit != null && request.query.limit <= 1;
      allow get, create, update, delete: if false;
    }`]
];
let output=source;
for(const [before,after] of replacements){if(!output.includes(before))throw Error('FC_RULE_SOURCE_DRIFT');output=output.replace(before,after);}
const marker='    match /occurrenceCatalogs/current {';
if(!output.includes(marker))throw Error('FC_RULES_USER_MARKER_MISSING');
output=output.replace(marker,`    match /users/{uid} {
      allow get: if signedIn() && request.auth.uid == uid;
      allow list, create, update, delete: if false;
    }
${marker}`);
const legacy='    function signedFromFc() { return activeUser(); }\n';
if(!output.includes(legacy))throw Error('FC_RULES_IDENTITY_HELPER_MISSING');
output=output.replace(legacy,'');
const folderRules = `
    function fcRecordsFolderOpen_(folder) {
      let path = /databases/$(database)/documents/runtimePolicy/folders;
      let policy = exists(path) ? get(path).data : {'schemaVersion': 1, 'revision': 1, 'disabled': []};
      return (activeUser() && profile().get('uid', '') == request.auth.uid && (profile().get('role', '') == 'administrador_app' || profile().get('permissions', {}).get('admin', false) == true)) || (policy.schemaVersion == 1 && policy.revision is int && policy.revision >= 1 &&
        policy.disabled is list && !policy.disabled.hasAny(['registros', folder]));
    }
`;
const begin=output.indexOf(marker);
const end=output.indexOf('    match /indicators/',begin);
if(begin<0||end<0)throw Error('FC_RECORDS_RULE_SCOPE_MISSING');
const occurrenceRules=output.slice(begin,end).replace(/(allow [a-z, ]+: if )(?!false\s*;)([^;]+);/g,
  (_,prefix,condition)=>prefix+"fcRecordsFolderOpen_('registros/ocorrencias') && ("+condition+");");
output=output.slice(0,begin)+folderRules+occurrenceRules+output.slice(end);
await writeFile('firestore.fc.base.rules',addMemberCategoryRules(output));
console.log('FC_MODULE_RULE_BASE_PREPARED');
