// Only installed shells need this bridge. Updated shells call FC directly.
export const FC_COMPAT_ORIGIN = 'https://sahmt-fc-integration.anestesiahmtforms3.workers.dev';
const paths = new Set(['/v1/qmentum/write', '/v1/qmentum/prints']);
const allowedOrigin = 'https://anestesiahmtforms.github.io';
const reply = (code, status, origin) => Response.json({code}, {status, headers:{
  'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff',
  ...(origin === allowedOrigin ? {'Access-Control-Allow-Origin':origin, Vary:'Origin'} : {}),
  ...(status === 503 ? {'Retry-After':'60'} : {})
}});

/** Preserve the exact live central module and delegate only FC service paths.
 * FC validates the original bearer, project audience, permissions and command.
 * No central HMAC, cookies, alternate destination or retry enters this bridge.
 */
export function withFcCompatibility(central, {fetchImpl = globalThis.fetch} = {}) {
  return {async fetch(request, env, context) {
    const url = new URL(request.url);
    if (url.pathname === '/v1/evaluation/occurrence')
      return reply('OCCURRENCE_SCORING_RETIRED_IN_FA', 410, request.headers.get('Origin'));
    if (env?.FC_COMPAT_FORWARD_ENABLED !== 'true' || !paths.has(url.pathname))
      return central.fetch(request, env, context);
    const origin = request.headers.get('Origin');
    if (url.search) return reply('FC_COMPAT_ROUTE_NOT_FOUND', 404, origin);
    if (origin !== allowedOrigin) return reply('FC_COMPAT_ORIGIN_DENIED', 403);
    if (!['POST', 'OPTIONS'].includes(request.method)) return reply('FC_COMPAT_METHOD_DENIED', 405, origin);
    if (request.method === 'POST' && url.pathname === '/v1/qmentum/prints' && env.FC_COMPAT_PRINTS_READY !== 'true')
      return reply('QMENTUM_PRINT_UNAVAILABLE', 503, origin);
    const headers = new Headers();
    for (const name of ['Origin', 'Authorization', 'Content-Type', 'Access-Control-Request-Method', 'Access-Control-Request-Headers'])
      if (request.headers.has(name)) headers.set(name, request.headers.get(name));
    try {
      // Stream the body; the FC relay enforces its existing input/size limits.
      // A redirect or failure never retries a possibly committed mutation.
      const response = await fetchImpl(FC_COMPAT_ORIGIN + url.pathname, {
        method:request.method, headers, body:request.body, redirect:'manual',
        signal:AbortSignal.any([request.signal, AbortSignal.timeout(65000)]),
        cache:'no-store', ...(request.body ? {duplex:'half'} : {})
      });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        return reply('FC_COMPAT_UNAVAILABLE', 503, origin);
      }
      const outgoing = new Headers();
      for (const name of ['Content-Type', 'Access-Control-Allow-Origin', 'Access-Control-Allow-Methods', 'Access-Control-Allow-Headers', 'Vary', 'Retry-After'])
        if (response.headers.has(name)) outgoing.set(name, response.headers.get(name));
      outgoing.set('Cache-Control', 'no-store');
      outgoing.set('X-Content-Type-Options', 'nosniff');
      return new Response(response.body, {status:response.status, headers:outgoing});
    } catch {
      return reply('FC_COMPAT_UNAVAILABLE', 503, origin);
    }
  }};
}
