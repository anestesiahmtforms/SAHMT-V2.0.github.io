// Each published analysis has two independent, non-repeatable credits.
export const QMENTUM_PARTICIPATION_POINTS=Object.freeze({ACKNOWLEDGEMENT:1,SUGGESTION:2});
export function participationId(analysisId,uid,modality){
 if(!/^[a-f0-9]{64}$/.test(analysisId)||typeof uid!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(uid)||!Object.hasOwn(QMENTUM_PARTICIPATION_POINTS,modality))throw Error('QMENTUM_PARTICIPATION_INVALID');
 return `${analysisId}_${uid}_${modality}`;
}
export function validateParticipation({analysisId,uid,modality,suggestion=''}){
 participationId(analysisId,uid,modality);
 if(typeof suggestion!=='string'||(modality==='SUGGESTION'?(suggestion.trim().length<8||suggestion.length>2000):suggestion!==''))throw Error('QMENTUM_SUGGESTION_INVALID');
 return suggestion.trim();
}
