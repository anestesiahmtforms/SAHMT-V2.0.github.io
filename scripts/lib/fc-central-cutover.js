const jobs=new Set(['processarParticipacoesQmentumV1','executarCicloQmentumV1','reconciliarAnalisesQmentumV1','validarRevisoesQmentumV1','processarFilaQmentumV1']);
const deliveries=new Set(['qmProcessParticipation_','qmDeliverFbParticipation_','evaluationDeliverOccurrence_']);
export const FC_CENTRAL_GUARDED_FUNCTIONS=Object.freeze([...jobs,...deliveries]);
export function guardCentralFcDeclaration(name,source){
 if(!jobs.has(name)&&!deliveries.has(name))return source;
 if(source.includes('fcCentralPerformanceStopped_'))throw Error('FC_CENTRAL_GUARD_CONFLICT');
 const index=source.indexOf('{');if(index<0)throw Error('FC_CENTRAL_GUARD_SOURCE_CHANGED');
 const guard=jobs.has(name)?"\n  if(fcCentralPerformanceStopped_())return {code:'FC_PERFORMANCE_MOVED',processed:0,pending:0};":"\n  if(fcCentralPerformanceStopped_())throw Error('FC_PERFORMANCE_MOVED');";
 return source.slice(0,index+1)+guard+source.slice(index+1);
}
