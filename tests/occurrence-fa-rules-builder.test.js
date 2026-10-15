import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
import{prepareOccurrenceFaRules,prepareOccurrenceSourceRules}from'../scripts/lib/occurrence-fa-rules.js';
const fa=readFileSync(new URL('../firestore.rules',import.meta.url),'utf8').replace(/\n    \/\/ BEGIN OCCURRENCES_FA_V1[\s\S]*?    \/\/ END OCCURRENCES_FA_V1\n/,''),fc=readFileSync(new URL('../firestore.occurrences.rules',import.meta.url),'utf8');
test('FA addition preserves existing rules byte-for-byte apart from line endings',()=>{
 const result=prepareOccurrenceFaRules(fa,fc),original=result.replace(/\n    \/\/ BEGIN OCCURRENCES_FA_V1[\s\S]*?    \/\/ END OCCURRENCES_FA_V1\n/,'');
 assert.equal(original,fa.replaceAll('\r\n','\n'));assert.match(result,/originProjectId == 'sahmt-17a16'/);
 assert.doesNotMatch(result,/function canAudit|sahmtOccurrencesAuditRead/);assert.match(result,/permissions\.occurrencesAuditRead == true/);
 assert.throws(()=>prepareOccurrenceFaRules(result,fc));
});
test('source fencing preserves existing FC rules and requires only a private runtime marker',()=>{
 const result=prepareOccurrenceSourceRules(fc);assert.match(result,/function canWrite\(\) \{ return occurrenceSourceOpen_\(\) && signedFromFa/);
 assert.match(result,/match \/occurrenceAudit/);assert.match(result,/sahmtOccurrencesAuditRead/);
 assert.throws(()=>prepareOccurrenceSourceRules(result));
});
