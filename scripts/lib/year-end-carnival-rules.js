import {createHash} from 'node:crypto';
const marker='    // YEAR_END_SCHEDULE_V1:',endMarker='    // END_YEAR_END_SCHEDULE_V1';
const canonical=s=>s.replaceAll('\r','').trim();
export function yearEndRulesBlock(source){
 const start=source.indexOf(marker),end=source.indexOf(endMarker,start);
 if(start<0||end<=start||source.indexOf(marker,start+marker.length)!==-1)throw Error('YEAR_END_RULES_BLOCK_REQUIRED');
 return source.slice(start,end+endMarker.length);
}
export function prepareYearEndCarnivalRules(live,candidate){
 const current=yearEndRulesBlock(live),next=yearEndRulesBlock(candidate);
 if(!next.includes("get('summaryVersion', 0) == 2")||!next.includes("['natal', 'reveillon', 'carnaval']")||!next.includes('plantaoCarnaval'))throw Error('YEAR_END_CARNIVAL_RULES_REQUIRED');
 const alreadyCurrent=canonical(current)===canonical(next);
 if(!alreadyCurrent&&createHash('sha256').update(canonical(current)).digest('hex')!=='c88e101579d1cb0e13663037726bd7a9d97405f3e2f380fce44faceafc8827bc')throw Error('YEAR_END_RULES_DRIFT');
 return {alreadyCurrent,content:live.replace(current,()=>next)};
}
