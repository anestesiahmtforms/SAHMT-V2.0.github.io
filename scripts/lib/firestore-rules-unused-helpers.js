// Remove only the four legacy schedule validators that have no call site in
// any active rule. In Rules, functions cannot be stored/passed as values.
// Keep every match/allow expression and all other source bytes unchanged.
export const UNUSED_SCHEDULE_HELPERS=Object.freeze([
 'validSchedulePositionAt','validSchedulePositions','validNewScheduleDay','validSchedulePositionsUpdate'
]);
export function pruneUnusedScheduleRuleHelpers(source){
 if(typeof source!=='string')throw Error('RULE_HELPER_SOURCE_INVALID');
 const masked=source.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g,s=>s.replace(/[^\r\n]/g,' '));
 const close=open=>{let depth=1;for(let i=open+1;i<masked.length;i++){if(masked[i]==='{')depth++;if(masked[i]==='}'&&!--depth)return i;}throw Error('RULE_HELPER_BRACES_INVALID');};
 const matches=[...masked.matchAll(/\bmatch\s+(\S+)\s*\{/g)].map(m=>({path:m[1],open:m.index+m[0].length-1,end:close(m.index+m[0].length-1)}));
 const spans=[];
 for(const name of UNUSED_SCHEDULE_HELPERS){
  const declarations=[...masked.matchAll(new RegExp('\\bfunction\\s+'+name+'\\s*\\([^)]*\\)\\s*\\{','g'))];
  if(!declarations.length)continue;
  if(declarations.length!==1)throw Error('RULE_HELPER_DECLARATION_AMBIGUOUS');
  const m=declarations[0],open=m.index+m[0].length-1,parents=matches.filter(x=>x.open<m.index&&x.end>m.index);
  if(parents.length!==1||parents[0].path!=='/databases/{database}/documents')throw Error('RULE_HELPER_SCOPE_UNEXPECTED');
  const lineStart=source.lastIndexOf('\n',m.index)+1;
  spans.push({name,start:source.slice(lineStart,m.index).trim()===''?lineStart:m.index,end:close(open)+1});
 }
 if(spans.length&&spans.length!==UNUSED_SCHEDULE_HELPERS.length)throw Error('RULE_HELPER_SET_INCOMPLETE');
 for(const {name} of spans){
  // Includes the declaration itself; all mentions must belong to the removed
  // set. This also detects accidental future use outside an allow expression.
  for(const m of masked.matchAll(new RegExp('\\b'+name+'\\b','g')))
   if(!spans.some(s=>s.start<=m.index&&m.index<s.end))throw Error('RULE_HELPER_STILL_REFERENCED');
 }
 let result=source;for(const s of [...spans].sort((a,b)=>b.start-a.start))result=result.slice(0,s.start)+result.slice(s.end);
 return {source:result,removed:spans.map(s=>s.name),removedSourceBytes:Buffer.byteLength(source)-Buffer.byteLength(result)};
}
