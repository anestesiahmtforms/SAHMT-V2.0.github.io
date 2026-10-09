import {spawn} from 'node:child_process';
import {createHash, randomBytes, createCipheriv, createDecipheriv} from 'node:crypto';
const digest = value => createHash('sha256').update(value).digest('hex');
const entropy = 'SAHMT_MANAGEMENT_BACKUP_V1';
async function dpapi(data, decrypt = false) {
  if (process.platform !== 'win32') throw Error('WINDOWS_DPAPI_REQUIRED');
  if (!Buffer.isBuffer(data) || data.length > 50 * 1024 * 1024) throw Error('PROTECTED_JSON_SIZE_INVALID');
  const code = "Add-Type -AssemblyName System.Security; $inputBytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $entropy=[Text.Encoding]::UTF8.GetBytes('" + entropy + "'); $outputBytes=[Security.Cryptography.ProtectedData]::" + (decrypt ? 'Unprotect' : 'Protect') + "($inputBytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($outputBytes));";
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', code], {windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
    const chunks = []; let size = 0, settled = false;
    const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); if (error) { child.kill(); reject(error); } else resolve(result); };
    const timer = setTimeout(() => finish(Error('DPAPI_TIMEOUT')), 30000);
    child.stdout.on('data', chunk => { size += chunk.length; if (size > 72 * 1024 * 1024) finish(Error('DPAPI_OUTPUT_TOO_LARGE')); else chunks.push(chunk); });
    child.stderr.on('data', () => {}); // Never emit cryptographic payloads or subprocess diagnostics.
    child.on('error', () => finish(Error('DPAPI_UNAVAILABLE')));
    child.stdin.on('error', () => finish(Error('DPAPI_INPUT_FAILED')));
    child.on('close', exitCode => {
      if (exitCode !== 0) return finish(Error('DPAPI_FAILED'));
      const encoded = Buffer.concat(chunks).toString('utf8').trim();
      if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return finish(Error('DPAPI_RESPONSE_INVALID'));
      finish(null, Buffer.from(encoded, 'base64'));
    });
    child.stdin.end(data.toString('base64'));
  });
}
export async function sealPrivateJson(value) {
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const ciphertext = await dpapi(plaintext);
  return {schemaVersion: 1, protection: 'WINDOWS_DPAPI_CURRENT_USER', plaintextSha256: digest(plaintext), ciphertext: ciphertext.toString('base64')};
}
export async function createPrivateJsonProtector() {
  const key = randomBytes(32), wrappedKey = (await dpapi(key)).toString('base64');
  return Object.freeze({seal(value) {
    const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
    if (plaintext.length > 50 * 1024 * 1024) throw Error('PROTECTED_JSON_SIZE_INVALID');
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from('SAHMT_MANAGEMENT_BACKUP_V2'));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return {schemaVersion: 2, protection: 'AES256_GCM_WITH_WINDOWS_DPAPI_CURRENT_USER', plaintextSha256: digest(plaintext), wrappedKey, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64')};
  }});
}
export async function openPrivateJson(envelope) {
  if (envelope?.schemaVersion === 2) {
    if (envelope.protection !== 'AES256_GCM_WITH_WINDOWS_DPAPI_CURRENT_USER' || !/^[a-f0-9]{64}$/.test(envelope.plaintextSha256 || '') || !['wrappedKey', 'iv', 'tag', 'ciphertext'].every(key => typeof envelope[key] === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(envelope[key]))) throw Error('PROTECTED_JSON_HEADER_INVALID');
    const key = await dpapi(Buffer.from(envelope.wrappedKey, 'base64'), true), iv = Buffer.from(envelope.iv, 'base64'), tag = Buffer.from(envelope.tag, 'base64');
    if (key.length !== 32 || iv.length !== 12 || tag.length !== 16) throw Error('PROTECTED_JSON_HEADER_INVALID');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from('SAHMT_MANAGEMENT_BACKUP_V2')); decipher.setAuthTag(tag);
    let plaintext;
    try { plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]); }
    catch { throw Error('PROTECTED_JSON_AUTHENTICATION_FAILED'); }
    if (digest(plaintext) !== envelope.plaintextSha256) throw Error('PROTECTED_JSON_DIGEST_MISMATCH');
    return JSON.parse(plaintext.toString('utf8'));
  }
  if (envelope?.schemaVersion !== 1 || envelope.protection !== 'WINDOWS_DPAPI_CURRENT_USER' || !/^[a-f0-9]{64}$/.test(envelope.plaintextSha256 || '') || typeof envelope.ciphertext !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.ciphertext)) throw Error('PROTECTED_JSON_HEADER_INVALID');
  const plaintext = await dpapi(Buffer.from(envelope.ciphertext, 'base64'), true);
  if (digest(plaintext) !== envelope.plaintextSha256) throw Error('PROTECTED_JSON_DIGEST_MISMATCH');
  return JSON.parse(plaintext.toString('utf8'));
}