export function notificationReference(value) {
 if(typeof value!=='string'||!value||value.length>220)throw Error('NOTIFICATION_ID_INVALID');
 const target=value.startsWith('FB::')?'FB':'FA',id=target==='FB'?value.slice(4):value;
 if(!id||/[\/\\\x00-\x1f]/.test(id)||['.','..'].includes(id)||id.includes('::'))throw Error('NOTIFICATION_ID_INVALID');
 return {target,id};
}
export async function mergeNotificationDomains({fa,fb,enabled,pageSize=100}) {
 if(!enabled)return fa();
 const [primary,secondary]=await Promise.all([fa(),fb().catch(()=>[])]);
 const items=[...primary.filter(x=>x.audienceType!=='MANAGEMENT_AREA'),...secondary.filter(x=>x.audienceType==='MANAGEMENT_AREA').map(x=>({...x,id:'FB::'+x.id}))];
 return items.sort((a,b)=>Number(b.priority||0)-Number(a.priority||0)).slice(0,Math.min(100,Math.max(1,pageSize)));
}
