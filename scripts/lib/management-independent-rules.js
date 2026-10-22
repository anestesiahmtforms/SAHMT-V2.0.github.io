import {INDEPENDENT_FB_COLLECTIONS} from './management-independent-fb-plan.js';
const roots=new Set([...INDEPENDENT_FB_COLLECTIONS,'users','roles','accessRequests','appConfig','notifications','notificationGroups','auditLogs']);
function blockEnd(source,start){
  let depth=0,quote=null,line=false,block=false;
  for(let i=start;i<source.length;i++){
    const c=source[i],next=source[i+1];
    if(line){if(c==='\n')line=false;continue;}
    if(block){if(c==='*'&&next==='/'){block=false;i++;}continue;}
    if(quote){if(c==='\\'){i++;continue;}if(c===quote)quote=null;continue;}
    if(c==='/'&&next==='/'){line=true;i++;continue;}
    if(c==='/'&&next==='*'){block=true;i++;continue;}
    if(c==='"'||c==="'"){quote=c;continue;}
    if(c==='{')depth++;
    if(c==='}'&&--depth===0)return i+1;
  }
  throw Error('INDEPENDENT_RULES_UNBALANCED');
}
export function prepareIndependentFbRules(source){
  if(typeof source!=='string'||!source.includes("rules_version = '2'")||!source.includes('function faDomainOpen_'))throw Error('INDEPENDENT_RULES_SOURCE_INVALID');
  const matches=[...source.matchAll(/^    match \/([^\n]+?) \{/gm)],removed=[],retained=[];let result=source;
  for(const match of matches.reverse()){
    const path=match[1],root=path.split('/')[0];
    const keep=(roots.has(root)&&path!=='appConfig/labelStaff')||path==='{document=**}';
    if(!keep){const open=match.index+match[0].length-1,end=blockEnd(source,open);result=result.slice(0,match.index)+result.slice(end);removed.push(root);}else retained.push(root);
  }
  const start=result.indexOf('function faDomainOpen_('),open=result.indexOf('{',start),end=blockEnd(result,open);
  result=result.slice(0,open+1)+"\n      let path = /databases/$(database)/documents/evaluationRuntime/independentFbCutover;\n      return exists(path) && get(path).data.status == 'ACTIVE' &&\n        get(path).data.release == 'fb-independent-20261022-v1';\n    "+result.slice(end-1);
  result=result.replaceAll('faDomainOpen_','fbDomainOpen_');
  if(result.includes('managementAuthorizationLeases')||/^    match \/qmentum/m.test(result)||/^    match \/(?:checklists|labels|events|scheduleDays)\//m.test(result))throw Error('INDEPENDENT_RULES_FOREIGN_DOMAIN');
  return {source:result,retainedRoots:[...new Set(retained)].sort(),excludedRoots:[...new Set(removed)].sort()};
}
