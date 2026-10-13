import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';

const safe = code => process.stdout.write(code + '\n');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST = path.join(ROOT, 'tests', 'management-gateway-hmac-homologation.test.js');
const KEY_BASENAME = 'hmac-secret.txt';

function secretPaths() {
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) throw Error('WINDOWS_LOCALAPPDATA_REQUIRED');
  const directory = path.join(process.env.LOCALAPPDATA, 'SAHMT', 'management-gateway-homologation');
  return {directory, file: path.join(directory, KEY_BASENAME)};
}

function windowsUserSid() {
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    '[Console]::Out.Write([Security.Principal.WindowsIdentity]::GetCurrent().User.Value)'],
  {windowsHide: true, encoding: 'utf8', timeout: 10000, maxBuffer: 1024});
  const sid = result.status === 0 ? result.stdout.trim() : '';
  if (!/^S-1-[0-9-]+$/.test(sid)) throw Error('WINDOWS_IDENTITY_UNAVAILABLE');
  return sid;
}

function restrictAcl(target, directory = false) {
  const sid = windowsUserSid();
  const permission = directory ? '(OI)(CI)F' : 'F';
  const result = spawnSync('icacls.exe', [target, '/inheritance:r', '/grant:r', `*${sid}:${permission}`],
    {windowsHide: true, encoding: 'utf8', timeout: 10000, maxBuffer: 4096});
  if (result.status !== 0) throw Error('LOCAL_SECRET_ACL_FAILED');
}

function runClipboard(secret, {clearOnlyIfMatching = false} = {}) {
  const command = clearOnlyIfMatching
    ? "$candidate=[Console]::In.ReadToEnd(); try {$current=Get-Clipboard -Raw -ErrorAction Stop; if ($current -ceq $candidate) {Set-Clipboard -Value '' -ErrorAction Stop}} catch {exit 3}; [Console]::Out.Write('HOMOLOGATION_CLIPBOARD_HANDLED')"
    : "$value=[Console]::In.ReadToEnd(); try {Set-Clipboard -Value $value -ErrorAction Stop} catch {exit 3}; [Console]::Out.Write('HOMOLOGATION_CLIPBOARD_SET')";
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-Command', command],
      {windowsHide: true, stdio: ['pipe', 'pipe', 'ignore']});
    let output = '', settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(result);
    };
    const timer = setTimeout(() => { child.kill(); finish(Error('CLIPBOARD_TIMEOUT')); }, 10000);
    child.stdout.on('data', chunk => {
      output += chunk.toString('utf8');
      if (output.length > 80) finish(Error('CLIPBOARD_PROTOCOL_FAILED'));
    });
    child.on('error', () => finish(Error('CLIPBOARD_UNAVAILABLE')));
    child.stdin.on('error', () => finish(Error('CLIPBOARD_INPUT_FAILED')));
    child.on('close', code => {
      const expected = clearOnlyIfMatching ? 'HOMOLOGATION_CLIPBOARD_HANDLED' : 'HOMOLOGATION_CLIPBOARD_SET';
      code === 0 && output === expected
        ? finish(null, true)
        : finish(Error('CLIPBOARD_UNAVAILABLE'));
    });
    child.stdin.end(secret, 'utf8');
  });
}

function runLocalTests() {
  const result = spawnSync(process.execPath, ['--test', TEST], {
    cwd: ROOT, windowsHide: true, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024
  });
  if (result.error?.code === 'ETIMEDOUT') throw Error('LOCAL_TESTS_TIMEOUT');
  if (result.status !== 0) throw Error('LOCAL_TESTS_FAILED');
}

async function readSecret(file) {
  let value;
  try { value = (await fs.readFile(file, 'utf8')).trim(); }
  catch (error) {
    if (error?.code === 'ENOENT') throw Error('HOMOLOGATION_SECRET_FILE_MISSING');
    if (error?.code === 'EACCES' || error?.code === 'EPERM') throw Error('HOMOLOGATION_SECRET_FILE_ACCESS_DENIED');
    throw Error('HOMOLOGATION_SECRET_FILE_READ_FAILED');
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw Error('HOMOLOGATION_SECRET_FILE_INVALID');
  return value;
}

async function prepare({directory, file}) {
  runLocalTests();
  safe('HOMOLOGATION_LOCAL_TESTS_OK');
  await fs.mkdir(directory, {recursive: true});
  restrictAcl(directory, true);

  let value = randomBytes(32).toString('base64url');
  const temporary = path.join(directory, `.hmac-secret-${randomBytes(8).toString('hex')}.tmp`);
  try {
    await fs.writeFile(temporary, value, {encoding: 'utf8', flag: 'wx', mode: 0o600});
    restrictAcl(temporary);
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, {force: true}).catch(() => {});
    if (['LOCAL_SECRET_ACL_FAILED', 'WINDOWS_IDENTITY_UNAVAILABLE'].includes(error?.message)) throw error;
    throw Error('LOCAL_SECRET_WRITE_FAILED');
  }

  safe('HOMOLOGATION_SECRET_SAVED_WITH_CURRENT_USER_ACL');
  try {
    await runClipboard(value);
    safe('HOMOLOGATION_SECRET_COPIED_TO_CLIPBOARD');
  } catch (error) {
    safe(error?.message === 'CLIPBOARD_TIMEOUT' ? 'HOMOLOGATION_CLIPBOARD_TIMEOUT' : 'HOMOLOGATION_CLIPBOARD_COPY_FAILED');
    process.exitCode = 2;
  } finally {
    value = undefined;
  }
}

async function main() {
  const action = process.argv[2];
  try {
    const paths = secretPaths();
    if (action === 'prepare') return await prepare(paths);
    if (action === 'copy') {
      await runClipboard(await readSecret(paths.file));
      safe('HOMOLOGATION_SECRET_COPIED_TO_CLIPBOARD');
      return;
    }
    if (action === 'diagnose') {
      await readSecret(paths.file);
      safe('HOMOLOGATION_SECRET_FILE_OK');
      return;
    }
    if (action === 'remove') {
      let value;
      try { value = await readSecret(paths.file); }
      catch (error) {
        if (error?.message === 'HOMOLOGATION_SECRET_FILE_MISSING') { safe('HOMOLOGATION_SECRET_ABSENT'); return; }
        throw error;
      }
      await runClipboard(value, {clearOnlyIfMatching: true});
      await fs.rm(paths.file, {force: true});
      safe('HOMOLOGATION_SECRET_REMOVED');
      return;
    }
    safe('USAGE_PREPARE_COPY_DIAGNOSE_REMOVE');
    process.exitCode = 2;
  } catch (error) {
    const allowed = new Set(['WINDOWS_LOCALAPPDATA_REQUIRED', 'WINDOWS_IDENTITY_UNAVAILABLE', 'LOCAL_SECRET_ACL_FAILED',
      'LOCAL_TESTS_TIMEOUT', 'LOCAL_TESTS_FAILED', 'LOCAL_SECRET_WRITE_FAILED', 'HOMOLOGATION_SECRET_FILE_MISSING',
      'HOMOLOGATION_SECRET_FILE_ACCESS_DENIED', 'HOMOLOGATION_SECRET_FILE_READ_FAILED', 'HOMOLOGATION_SECRET_FILE_INVALID',
      'CLIPBOARD_TIMEOUT', 'CLIPBOARD_PROTOCOL_FAILED', 'CLIPBOARD_UNAVAILABLE', 'CLIPBOARD_INPUT_FAILED']);
    safe(allowed.has(error?.message) ? error.message : 'HOMOLOGATION_SECRET_OPERATION_FAILED');
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
