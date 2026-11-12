import {callFunctionalAction} from './functional-client.js';
import {isSahmtPerformanceAction} from './sahmt-performance-actions.js';
export async function callSahmtPerformanceApi({uid,isCurrent,action,input,signal}={}){
 if(!isSahmtPerformanceAction(action))throw Error('SAHMT_PERFORMANCE_UNSUPPORTED_ACTION');
 return callFunctionalAction({uid,isCurrent,action,input,signal});
}
