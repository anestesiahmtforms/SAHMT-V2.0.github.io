import {createPrivateKey, sign} from 'node:crypto';
import {Buffer} from 'node:buffer';

export const DOMAIN_PROJECTS = Object.freeze({FI: 'sahmt-operacional-fi', FJ: 'sahmt-escala-fj', FH: 'sahmt-etiquetas-fh', FG: 'sahmt-checklist-fg'});
export const FA_PROJECT = 'sahmt-17a16';
export const MODULE_LEASE_SECONDS = 300;
export const fail = (code, status = 503) => Object.assign(new Error(code), {code, status});
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');

export async function boundedJson(response, maximum = 32768) {
  if (!response.body) throw fail('DOMAIN_RESPONSE_INVALID');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.length; if (size > maximum) throw fail('DOMAIN_BODY_LIMIT', 413);
      chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw fail('DOMAIN_RESPONSE_INVALID'); }
}

// Signature and account state are checked by Firebase, with the FA API key.
// Decoding claims is only an early rejection; it never establishes identity.
export async function verifyFaSession(authorization, {apiKey, fetchImpl = fetch, now = Date.now} = {}) {
  const denied = () => fail('DOMAIN_SESSION_INVALID', 401);
  if (!apiKey) throw fail('DOMAIN_CONFIG_REQUIRED');
  if (!/^Bearer [A-Za-z0-9_.-]{50,16000}$/.test(authorization || '')) throw denied();
  const token = authorization.slice(7); let header, claims;
  try {
    const parts = token.split('.'); if (parts.length !== 3) throw Error();
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch { throw denied(); }
  const time = now() / 1000;
  if (header.alg !== 'RS256' || claims.aud !== FA_PROJECT || claims.iss !== `https://securetoken.google.com/${FA_PROJECT}` ||
      typeof claims.sub !== 'string' || !/^[^/\s\x00-\x1f]{1,128}$/.test(claims.sub) ||
      !Number.isFinite(claims.exp) || claims.exp <= time || !Number.isFinite(claims.iat) || claims.iat > time + 30 ||
      !Number.isFinite(claims.auth_time) || claims.auth_time > time + 30) throw denied();
  const response = await fetchImpl('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + encodeURIComponent(apiKey), {
    method: 'POST', body: JSON.stringify({idToken: token}), headers: {'Content-Type': 'application/json'},
    redirect: 'manual', signal: AbortSignal.timeout(15000)
  });
  const value = await boundedJson(response), user = value.users?.length === 1 ? value.users[0] : null;
  if (!response.ok || !user || user.localId !== claims.sub || user.disabled === true ||
      Number(user.validSince || 0) > claims.auth_time || !user.email ||
      String(user.email).toLowerCase() !== String(claims.email || '').toLowerCase() ||
      Boolean(user.emailVerified) !== Boolean(claims.email_verified)) throw denied();
  return {uid: user.localId, email: user.email.toLowerCase(), emailVerified: user.emailVerified === true, authTime: claims.auth_time};
}

export function serviceIdentity(credentials, station, {fetchImpl = fetch, now = Date.now} = {}) {
  const projectId = DOMAIN_PROJECTS[station];
  if (!projectId || credentials?.project_id !== projectId ||
      credentials.client_email !== `${station.toLowerCase()}-module-worker@${projectId}.iam.gserviceaccount.com`) throw fail('DOMAIN_CONFIG_REQUIRED');
  let key;
  try { key = createPrivateKey(credentials.private_key); } catch { throw fail('DOMAIN_CONFIG_REQUIRED'); }
  let cached, pending;
  return {
    async accessToken() {
      if (cached?.until > now() + 60000) return cached.token;
      if (!pending) pending = (async () => {
        const iat = Math.floor(now() / 1000), unsigned = b64({alg: 'RS256', typ: 'JWT'}) + '.' + b64({
          iss: credentials.client_email, scope: 'https://www.googleapis.com/auth/datastore',
          aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600
        });
        const response = await fetchImpl('https://oauth2.googleapis.com/token', {method: 'POST', redirect: 'manual',
          signal: AbortSignal.timeout(15000), body: new URLSearchParams({grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: unsigned + '.' + sign('RSA-SHA256', Buffer.from(unsigned), key).toString('base64url')})});
        const result = await boundedJson(response, 16384);
        if (!response.ok || typeof result.access_token !== 'string' || !Number.isFinite(result.expires_in) ||
            result.expires_in < 120 || result.expires_in > 3600) throw fail('DOMAIN_SERVICE_AUTH_UNAVAILABLE');
        cached = {token: result.access_token, until: now() + result.expires_in * 1000};
        return cached.token;
      })().finally(() => { pending = null; });
      return pending;
    },
    customToken(actor) {
      const iat = Math.floor(now() / 1000), unsigned = b64({alg: 'RS256', typ: 'JWT'}) + '.' + b64({
        iss: credentials.client_email, sub: credentials.client_email,
        aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
        iat, exp: iat + MODULE_LEASE_SECONDS, uid: actor.uid,
        claims: {sourceProjectId: FA_PROJECT, moduleStation: station, faAuthTime: actor.authTime,
          moduleLeaseExpiresAt: iat + MODULE_LEASE_SECONDS}
      });
      return unsigned + '.' + sign('RSA-SHA256', Buffer.from(unsigned), key).toString('base64url');
    }
  };
}

export function canEnterModule(profile, actor, station) {
  const permissions = profile?.permissions || {};
  const modulePermissions = station === 'FI' ? ['eventsRead', 'eventsWrite', 'eventsCatalogManage', 'peopleManage'] :
    station === 'FJ' ? ['scheduleRead', 'scheduleWrite', 'eventsRead', 'eventsWrite', 'checklistSign'] :
    station === 'FH' ? ['labelsRead', 'labelsWrite', 'labelsManage'] :
    station === 'FG' ? ['checklistRead', 'checklistWrite', 'checklistSign', 'checklistManage'] : [];
  return profile?.uid === actor.uid && String(profile.email || '').toLowerCase() === actor.email &&
    profile.active === true && profile.access === true &&
    (station === 'FH' ? modulePermissions.some(permission => (permissions[permission] ?? permissions.admin) === true) :
      (profile.role === 'administrador_app' || permissions.admin === true || modulePermissions.some(permission => permissions[permission] === true)));
}
