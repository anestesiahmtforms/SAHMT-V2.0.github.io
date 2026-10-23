export function isQmentumFcMigrationVerified(plan) {
 const counts=plan?.counts;
 const numbers=['qmentumSource','qmentumDestination','create','equivalent','destinationOnly','occurrenceSource','occurrenceEquivalent','conflicts'];
 if(plan?.ready!==true||!counts||numbers.some(key=>!Number.isSafeInteger(counts[key])||counts[key]<0))return false;
 return counts.create===0&&counts.conflicts===0&&counts.qmentumSource===counts.equivalent
  &&counts.qmentumDestination===counts.equivalent+counts.destinationOnly
  &&counts.occurrenceSource===counts.occurrenceEquivalent;
}
