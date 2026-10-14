import {managementDomainCollections} from './secondary-domain-release-package.js';
// Source transformation is candidate-only. It never installs Rules or toggles the marker.
export function prepareIdentityCutoverRules(source) {
 if(typeof source!=='string'||source.includes('function faDomainOpen_'))throw Error('CUTOVER_RULES_ALREADY_OR_INVALID');
 const root='match /databases/{database}/documents {';
 if(!source.includes(root))throw Error('CUTOVER_RULES_ROOT_INVALID');
 const matches=[...source.matchAll(/match \/([A-Za-z][A-Za-z0-9]*)\/\{[^}]+\}\s*\{/g)];let output=source,changed=0;
 for(const match of matches.reverse()){
  const collection=match[1];if(!managementDomainCollections.includes(collection)&&!/^evaluation[A-Z]/.test(collection)&&collection!=='notifications')continue;
  const start=match.index+match[0].length;let end=start,depth=1,quote=null,line=false,block=false;
  for(;end<source.length&&depth;end++){
   const c=source[end],next=source[end+1];
   if(line){if(c==='\n')line=false;continue;}if(block){if(c==='*'&&next==='/'){block=false;end++;}continue;}
   if(quote){if(c==='\\'){end++;continue;}if(c===quote)quote=null;continue;}
   if(c==='/'&&next==='/'){line=true;end++;continue;}if(c==='/'&&next==='*'){block=true;end++;continue;}
   if(c==='"'||c==="'"){quote=c;continue;}if(c==='{')depth++;if(c==='}')depth--;
  }
  if(depth)throw Error('CUTOVER_RULES_UNBALANCED');
  let body=source.slice(start,end-1);
  if(collection==='notifications')body=body.replace(/allow (create|update): if /g,(_,verb)=>`allow ${verb}: if ((request.resource.data.audienceType != 'MANAGEMENT_AREA'${verb==='update'?" && resource.data.audienceType != 'MANAGEMENT_AREA'":''}) || faDomainOpen_(true)) && `);
  else body=body.replace(/allow ([a-z, ]+): if ([^;]+);/g,(_,verbs,expression)=>{const write=/create|update|delete|write/.test(verbs);return `allow ${verbs}: if faDomainOpen_(${write}) && (${expression});`;});
  output=output.slice(0,start)+body+output.slice(end-1);changed++;
 }
 if(changed<managementDomainCollections.length)throw Error('CUTOVER_RULES_COVERAGE_MISSING');
 return output.replace(root,root+`
    function faDomainOpen_(writeOperation) {
      let path = /databases/$(database)/documents/managementRuntime/domainCutover;
      return !exists(path) || (get(path).data.get('retired', false) != true &&
        (!writeOperation || get(path).data.get('sourceWritesBlocked', false) != true));
    }
`);
}
