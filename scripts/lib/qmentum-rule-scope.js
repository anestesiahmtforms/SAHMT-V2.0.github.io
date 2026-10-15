/** Localize QMENTUM helpers to each exact root collection. Never add a
 * recursive wildcard scope, global helper tree or permissive fallback. */
export function scopeQmentumFragment(fragment){
 const mask=fragment.replace(/'(?:\\.|[^'\\])*'|\/\/[^\r\n]*/g,s=>s.replace(/[^\r\n]/g,' '));
 const close=open=>{let n=1;for(let i=open+1;i<mask.length;i++){if(mask[i]==='{')n++;if(mask[i]==='}'&&!--n)return i;}throw Error('QMENTUM_RULE_SCOPE_INVALID');};
 const first=fragment.indexOf('    match /qmentumAccess/'),helpers=new Map();
 for(const m of mask.slice(0,first).matchAll(/function\s+(qm\w+)\([^)]*\)\s*\{/g)){const open=m.index+m[0].length-1;helpers.set(m[1],fragment.slice(m.index,close(open)+1));}
 const roots=[];let at=first;
 while(at<fragment.length){const m=/    match \/(qmentum\w+)\/[^\n]*\{/.exec(fragment.slice(at));if(!m)break;
  const start=at+m.index,open=start+m[0].length-1,end=close(open);let body=fragment.slice(open+1,end);
  const needed=new Set();const include=text=>{for(const name of helpers.keys())if(new RegExp('\\b'+name+'\\(').test(text)&&!needed.has(name)){needed.add(name);include(helpers.get(name));}};include(body);
  body='\n'+[...needed].map(name=>helpers.get(name)).join('\n')+'\n'+body;
  for(const name of needed)body=body.replace(new RegExp('\\b'+name+'\\b','g'),m[1]+'_'+name);
  roots.push(fragment.slice(start,open+1)+body+'}');at=end+1;
 }
 if(roots.length!==4)throw Error('QMENTUM_RULE_ROOTS_INVALID');
 return roots.join('\n');
}
