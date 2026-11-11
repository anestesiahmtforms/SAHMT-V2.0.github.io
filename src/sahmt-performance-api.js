import {callFunctionalAction} from './functional-client.js';
export async function callSahmtPerformanceApi({uid,isCurrent,action,input,signal}={}){
 return callFunctionalAction({uid,isCurrent,action,input,signal});
}
