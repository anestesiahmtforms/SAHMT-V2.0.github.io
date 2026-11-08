// FI retains its historical data; all operational work now belongs to FJ.
export default {
  async scheduled() {},
  async fetch(request, env) {
    const headers = {'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', Vary:'Origin'};
    const origin = request.headers.get('Origin');
    if (String(env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).includes(origin)) {
      Object.assign(headers, {'Access-Control-Allow-Origin':origin, 'Access-Control-Allow-Methods':'POST, OPTIONS',
        'Access-Control-Allow-Headers':'Authorization, Content-Type, X-Firebase-AppCheck'});
    }
    if (request.method === 'GET' && new URL(request.url).pathname === '/health') {
      return Response.json({station:'FI', projectId:'sahmt-operacional-fi', cutoverActive:false, retired:true, destination:'FJ'}, {headers});
    }
    if (request.method === 'OPTIONS') return new Response(null, {status:204, headers});
    return Response.json({code:'DOMAIN_MODULE_RETIRED', station:'FI', destination:'FJ'}, {status:410, headers});
  }
};
