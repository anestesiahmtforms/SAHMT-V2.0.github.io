const marker = '// FA is the entry shell. Its former performance producer is retired.';
const needle = 'faPerformanceIdentity_();const lease=faPerformanceAcquire_();';
const replacement = "faPerformanceIdentity_();if(faPerformanceEntryOnly_())return {code:'FA_ENTRY_ONLY_PERFORMANCE_RETIRED',reads:0,writes:0};const lease=faPerformanceAcquire_();";
export function prepareFaEntryOnly(source) {
  if (source.includes(marker)) {
    if (source.split(replacement).length !== 3 || !source.includes('function faPerformanceEntryOnly_(){return true;}')) throw Error('FA_ENTRY_POLICY_DRIFT');
    return source;
  }
  if (source.split(needle).length !== 3 || source.includes('function faPerformanceEntryOnly_')) throw Error('FA_ENTRY_SOURCE_DRIFT');
  const newline=source.includes('\r\n')?'\r\n':'\n';
  return source.replaceAll(needle,replacement)+newline+marker+newline+'function faPerformanceEntryOnly_(){return true;}'+newline;
}
