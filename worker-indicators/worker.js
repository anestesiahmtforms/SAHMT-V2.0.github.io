const json=(code,status=410)=>Response.json({code},{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});

/** FD is no longer the SAHMT performance runtime; FK owns this feature. */
export function createIndicatorWorker(){
 return Object.freeze({
  async fetch(request){
   const path=new URL(request.url).pathname;
   if(path==='/v1/indicators'||path==='/v1/fd-scheduled-refresh')return json('SAHMT_PERFORMANCE_MOVED_TO_FK');
   return json('INDICATOR_ROUTE_UNKNOWN',404);
  },
  async scheduled(){return {code:'SAHMT_PERFORMANCE_MOVED_TO_FK'};}
 });
}
export default createIndicatorWorker();
