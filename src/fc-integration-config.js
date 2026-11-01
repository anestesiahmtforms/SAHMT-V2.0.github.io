const paths = new Set(['/v1/qmentum/write', '/v1/qmentum/prints', '/v1/evaluation/occurrence']);

/** Build-time station routing. Auth, database selection and FA endpoints are independent. */
export function fcIntegrationEndpoint(path, {env = import.meta.env || {}, fallback} = {}) {
  if (!paths.has(path)) throw Error('FC_INTEGRATION_ROUTE_INVALID');
  const flag = env.VITE_FC_INTEGRATION_ENABLED;
  if (flag !== undefined && !['', 'false', 'true'].includes(flag)) throw Error('FC_INTEGRATION_CONFIG_INVALID');
  if (flag !== 'true') return fallback;
  const configured = env.VITE_FC_INTEGRATION_ORIGIN;
  let url;
  try { url = new URL(configured); } catch { throw Error('FC_INTEGRATION_CONFIG_INVALID'); }
  if (url.protocol !== 'https:' || url.origin !== configured || url.username || url.password || url.hostname.includes('*'))
    throw Error('FC_INTEGRATION_CONFIG_INVALID');
  return url.origin + path;
}
