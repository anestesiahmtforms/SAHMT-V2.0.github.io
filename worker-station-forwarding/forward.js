const ORIGIN='https://anestesiahmtforms.github.io';
const targets={FD:'https://sahmt-indicators.anestesiahmtforms4.workers.dev',FE:'https://sahmt-fe-surveys.anestesiahmtforms5.workers.dev'};
async function action(request){
 if(Number(request.headers.get('Content-Length'))>32768)return null;
 const reader=request.clone().body?.getReader();if(!reader)return null;
 let bytes=0,text='';const decoder=new TextDecoder();
 try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>32768)return null;text+=decoder.decode(value,{stream:true});}text+=decoder.decode();return JSON.parse(text)?.action;}catch{return null;}finally{void reader.cancel().catch(()=>{});}
}
export function stationForwarder(legacy,station,fetchImpl=fetch){
 if(!targets[station])throw Error('STATION_FORWARD_CONFIG_INVALID');
 return {
  async fetch(request,env,ctx){
   const path=new URL(request.url).pathname;
   const candidate=station==='FD'?path==='/v1/indicators':path==='/v1/institutional-surveys';
   let forward=candidate&&request.headers.get('Origin')===ORIGIN&&['POST','OPTIONS'].includes(request.method);
   // Keep the existing epidemiological report authorization and bootstrap in central.
   if(forward&&station==='FE')forward=request.method==='POST'&&['SUBMIT','GET_PERFORMANCE'].includes(await action(request));
   if(!forward)return legacy.fetch(request,env,ctx);
   const headers=new Headers();for(const name of ['Origin','Content-Type','Authorization']){const value=request.headers.get(name);if(value)headers.set(name,value);}
   try{return await fetchImpl(new Request(targets[station]+path,{method:request.method,headers,body:request.body,redirect:'manual',signal:AbortSignal.timeout(25000),duplex:'half'}));}
   catch{return Response.json({code:station==='FD'?'INDICATOR_UNAVAILABLE':'SURVEY_UNAVAILABLE'},{status:503,headers:{'Cache-Control':'no-store','Access-Control-Allow-Origin':ORIGIN,Vary:'Origin'}});}
  },
  // The FD compiler cron is installed on the FD account during cutover.
  async scheduled(event,env,ctx){if(station!=='FD'&&legacy.scheduled)return legacy.scheduled(event,env,ctx);}
 };
}
export function stationAwareWorker(legacy,station){
 const forwarder=stationForwarder(legacy,station);
 return {fetch(request,env,ctx){return (env[station+'_STATION_FORWARD_ENABLED']==='true'?forwarder:legacy).fetch(request,env,ctx);},
  scheduled(event,env,ctx){return (env[station+'_STATION_FORWARD_ENABLED']==='true'?forwarder:legacy).scheduled?.(event,env,ctx);}};
}
