let modules;
export function loadCommunicationModules(){
 if(!modules)modules=Promise.all([import('./communication-ui.js'),import('./communication-client.js')]).catch(error=>{modules=null;throw error;});
 return modules;
}
export function preloadCommunicationModules({isCurrent=()=>true}={}){
 void loadCommunicationModules().then(([,client])=>isCurrent()?client.prepareCommunicationSession({isCurrent}):false).catch(()=>{});
}
