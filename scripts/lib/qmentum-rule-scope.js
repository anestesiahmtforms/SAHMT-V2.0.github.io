/** Localize QMENTUM helpers to each exact root collection. Never add a
 * recursive wildcard scope, global helper tree or permissive fallback. */
export function scopeQmentumFragment(fragment){
 const mask=fragment.replace(/'(?:\\.|[^'\\])*'|\/\/[^\r\n]*/g,s=>s.replace(/[^\r\n]/g,' '));
 const close=open=>{let n=1;for(let i=open+1;i<mask.length;i++){if(mask[i]==='{')n++;if(mask[i]==='}'&&!--n)return i;}throw Error('QMENTUM_RULE_SCOPE_INVALID');};
 const first=fragment.indexOf('    match /qmentumAccess/'),helpers=new Map();
 for(const m of mask.slice(0,first).matchAll(/function\s+(qm\w+)\([^)]*\)\s*\{/g)){const open=m.index+m[0].length-1;helpers.set(m[1],fragment.slice(m.index,close(open)+1));}
 const roots=[];let at=first,serial=0;
 const authHelpers=new Set(['qmSigned','qmAccess','qmEnabled','qmMember','qmUnit','qmManager','qmReviewer']);
 const rename=(text,names)=>{for(const [name,replacement] of names)text=text.replace(new RegExp('\\b'+name+'\\b','g'),replacement);return text;};
 function render(start,open,end,label,inherited=new Map(),root=false){
  const children=[];let cursor=open+1;
  while(cursor<end){const m=/\bmatch\s+\S+\s*\{/.exec(mask.slice(cursor,end));if(!m)break;const at=cursor+m.index,o=at+m[0].length-1,e=close(o);if(e>end)throw Error('QMENTUM_RULE_SCOPE_INVALID');children.push({start:at,open:o,end:e});cursor=e+1;}
  let direct='',last=open+1;for(const child of children){direct+=fragment.slice(last,child.start);last=child.end+1;}direct+=fragment.slice(last,end);
  const needed=new Set();const include=text=>{for(const name of helpers.keys())if(!inherited.has(name)&&new RegExp('\\b'+name+'\\(').test(text)&&!needed.has(name)){needed.add(name);include(helpers.get(name));}};
  // Share only identity helpers across this QMENTUM collection; keep numeric,
  // history, definition and import validators inside the leaf that uses them.
  if(root){const subtree=fragment.slice(open+1,end);for(const name of authHelpers)if(new RegExp('\\b'+name+'\\(').test(subtree))include(name+'(');}
  include(direct);const names=new Map(inherited),prefix=label+'_'+serial++;
  for(const name of needed)names.set(name,prefix+'_'+name);
  let body='\n'+[...needed].map(name=>rename(helpers.get(name),names)).join('\n')+'\n';last=open+1;
  for(const child of children){body+=rename(fragment.slice(last,child.start),names)+render(child.start,child.open,child.end,label,names);last=child.end+1;}body+=rename(fragment.slice(last,end),names);
  return fragment.slice(start,open+1)+body+'}';
 }
 while(at<fragment.length){const m=/    match \/(qmentum\w+)\/[^\n]*\{/.exec(fragment.slice(at));if(!m)break;
  const start=at+m.index,open=start+m[0].length-1,end=close(open);
  roots.push(render(start,open,end,m[1],new Map(),true));at=end+1;
 }
 if(roots.length!==4)throw Error('QMENTUM_RULE_ROOTS_INVALID');
 return roots.join('\n');
}
