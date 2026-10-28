import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';

// This owner OAuth configuration is server-only. Service accounts cannot own
// new files in this private My Drive destination without storage quota.
const OWNER = 'anestesiahmtforms@gmail.com';
const ROOT = '1ETtQoCK4DBQ06gwecJbb0Ac5SneAnRGK';
const FOLDER = 'application/vnd.google-apps.folder';
const API = 'https://www.googleapis.com/drive/v3/files';
const FILE_FIELDS = 'id,parents,appProperties,mimeType,size,shared';
const FOLDER_FIELDS = 'id,parents,mimeType,trashed,shared,owners(emailAddress)';
const fail = (code, status = 503) => { throw Object.assign(new Error(code), { code, status }); };
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const secret = value => typeof value === 'string' && value.length > 0 && value.length <= 8192 && !/[\s\x00-\x1f\x7f]/.test(value);

export function createDriveClient({ credentials, fetchImpl = fetch, now = Date.now } = {}) {
  if (credentials === undefined || credentials === null) return { ready: false };
  if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials) || Object.keys(credentials).some(key => !['clientId', 'clientSecret', 'refreshToken', 'ownerEmail'].includes(key)) || !['clientId', 'clientSecret', 'refreshToken'].every(key => secret(credentials[key])) || credentials.ownerEmail !== OWNER || typeof fetchImpl !== 'function' || typeof now !== 'function') fail('DOCUMENT_DRIVE_CONFIG_INVALID');
  const { clientId, clientSecret, refreshToken } = credentials;
  let cached = null, refreshing = null;
  const destinations = new Map();
  const time = () => {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0) fail('DOCUMENT_DRIVE_CONFIG_INVALID');
    return value;
  };
  async function request(url, options = {}, allowMissing = false) {
    let response;
    try {
      response = await fetchImpl(url, { ...options, redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(30000) });
    } catch { fail('DOCUMENT_DRIVE_UNAVAILABLE'); }
    if (allowMissing && response.status === 404) return null;
    if (!response.ok) {
      if (response.status === 403) fail('DOCUMENT_DRIVE_FORBIDDEN', 403);
      if (response.status === 409) fail('DOCUMENT_DRIVE_CONFLICT', 409);
      fail('DOCUMENT_DRIVE_UNAVAILABLE');
    }
    try { return await response.json(); } catch { fail('DOCUMENT_DRIVE_UNAVAILABLE'); }
  }
  async function token() {
    if (cached && cached.expiresAt > time() + 60000) return cached.value;
    if (!refreshing) refreshing = (async () => {
      const issuedAt = time();
      const result = await request('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken }).toString(),
      });
      if (!result || !secret(result.access_token) || typeof result.token_type !== 'string' || result.token_type.toLowerCase() !== 'bearer' || !Number.isFinite(result.expires_in) || result.expires_in <= 60 || result.expires_in > 3600) fail('DOCUMENT_DRIVE_AUTH_UNAVAILABLE');
      const user = await request('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${result.access_token}` } });
      if (!user || user.email_verified !== true || typeof user.email !== 'string' || user.email.toLowerCase() !== OWNER) fail('DOCUMENT_DRIVE_OWNER_MISMATCH', 403);
      cached = { value: result.access_token, expiresAt: issuedAt + result.expires_in * 1000 };
      return cached.value;
    })().finally(() => { refreshing = null; });
    return refreshing;
  }
  async function authenticated(url, options = {}, allowMissing = false) {
    return request(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${await token()}` } }, allowMissing);
  }
  async function metadata(id, fields, allowMissing = false) {
    if (!identifier(id)) fail('DOCUMENT_DRIVE_INPUT_INVALID', 403);
    return authenticated(`${API}/${encodeURIComponent(id)}?fields=${encodeURIComponent(fields)}`, {}, allowMissing);
  }
  function projectFile(file, id) {
    if (!file || file.id !== id || !Array.isArray(file.parents) || file.parents.some(parent => !identifier(parent)) || typeof file.mimeType !== 'string') fail('DOCUMENT_DRIVE_UNCONFIRMED');
    if (file.shared !== false) fail('DOCUMENT_DRIVE_FILE_NOT_PRIVATE', 403);
    return Object.fromEntries(['id', 'parents', 'appProperties', 'mimeType', 'size', 'shared'].filter(key => file[key] !== undefined).map(key => [key, structuredClone(file[key])]));
  }
  async function verifyDestination(categoryFolderId, professionalFolderId, rootFolderId) {
    if (!identifier(categoryFolderId) || !identifier(professionalFolderId) || rootFolderId !== ROOT || new Set([categoryFolderId, professionalFolderId, rootFolderId]).size !== 3) fail('DOCUMENT_DRIVE_DESTINATION_INVALID', 403);
    destinations.delete(categoryFolderId);
    const ids = [categoryFolderId, professionalFolderId, rootFolderId];
    const folders = await Promise.all(ids.map(id => metadata(id, FOLDER_FIELDS, true)));
    const privateOwnerFolder = (folder, index) => folder && folder.id === ids[index] && folder.mimeType === FOLDER && folder.trashed === false && folder.shared === false && Array.isArray(folder.owners) && folder.owners.length === 1 && typeof folder.owners[0]?.emailAddress === 'string' && folder.owners[0].emailAddress.toLowerCase() === OWNER;
    if (!folders.every(privateOwnerFolder) || !Array.isArray(folders[0].parents) || !folders[0].parents.includes(professionalFolderId) || !Array.isArray(folders[1].parents) || !folders[1].parents.includes(rootFolderId)) fail('DOCUMENT_DRIVE_DESTINATION_INVALID', 403);
    destinations.set(categoryFolderId, { professionalFolderId, rootFolderId });
  }
  return {
    ready: true,
    async allocateId() {
      const result = await authenticated(`${API}/generateIds?count=1&space=drive&type=files`);
      if (!Array.isArray(result?.ids) || result.ids.length !== 1 || !identifier(result.ids[0])) fail('DOCUMENT_DRIVE_UNCONFIRMED');
      return result.ids[0];
    },
    verifyDestination,
    async getFile(id) {
      const result = await metadata(id, FILE_FIELDS, true);
      return result === null ? null : projectFile(result, id);
    },
    async upload({ id, folderId, name, mimeType, digest, bytes } = {}) {
      if (!identifier(id) || !identifier(folderId) || typeof name !== 'string' || name.length < 1 || name.length > 240 || /[\x00-\x1f\x7f/\\]/.test(name) || !['application/pdf', 'image/jpeg'].includes(mimeType) || !/^[a-f0-9]{64}$/.test(digest || '') || !(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > (mimeType === 'image/jpeg' ? 2 : 5) * 1024 * 1024) fail('DOCUMENT_DRIVE_INPUT_INVALID', 403);
      const destination = destinations.get(folderId);
      if (!destination) fail('DOCUMENT_DRIVE_DESTINATION_INVALID', 403);
      // Revalidate even when this worker instance handled a previous upload:
      // moved/trashed folders must not inherit an old in-memory authorization.
      await verifyDestination(folderId, destination.professionalFolderId, destination.rootFolderId);
      const fileBytes = Buffer.from(bytes);
      let boundary;
      do { boundary = `sahmt_${randomBytes(18).toString('hex')}`; } while (fileBytes.includes(Buffer.from(boundary)));
      const metadata = { id, name, mimeType, parents: [folderId], appProperties: { sahmtDigest: digest } };
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
        fileBytes, Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      const result = await authenticated(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=${FILE_FIELDS}`, {
        method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
      });
      return projectFile(result, id);
    },
  };
}
