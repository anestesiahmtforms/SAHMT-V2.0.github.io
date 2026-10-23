const sections=[['// BEGIN QMENTUM_FA','// END QMENTUM_FA'],['// BEGIN OCCURRENCES_FA_V1','// END OCCURRENCES_FA_V1']];
/** Remove only the explicitly marked source modules. The remainder of the
 * live FA rules is preserved, including all identity and operational rules. */
export function retireFcSourceRules(source,{requireBoth=false}={}){
 if(typeof source!=='string')throw Error('FC_RETIREMENT_RULE_SOURCE_INVALID');
 let result=source,removed=0;
 for(const [begin,end] of sections){
  const a=result.indexOf(begin),b=result.indexOf(end);
  if(a<0&&b<0){if(requireBoth)throw Error('FC_RETIREMENT_RULE_SECTION_MISSING');continue;}
  if(a<0||b<a||result.indexOf(begin,a+begin.length)>=0||result.indexOf(end,b+end.length)>=0)throw Error('FC_RETIREMENT_RULE_SECTION_INVALID');
  result=result.slice(0,a)+result.slice(b+end.length);removed++;
 }
 if(/\bmatch\s+\/(?:qmentum\w*|occurrence(?:Audit|Reports|Catalogs|ScoreClaims))\b|\{occurrenceCollection\}/.test(result))throw Error('FC_RETIREMENT_RULE_UNMAPPED_SCOPE');
 if(!/match\s+\/\{document=\*\*\}\s*\{\s*allow read, write: if false;\s*\}/.test(result))throw Error('FC_RETIREMENT_DEFAULT_DENY_MISSING');
 return {source:result,removed};
}
