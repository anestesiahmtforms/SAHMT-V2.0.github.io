import {readFile, lstat, open, realpath, link, unlink} from 'node:fs/promises';
import {resolve, dirname, basename, relative, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash, randomUUID} from 'node:crypto';
import {openPrivateJson, createPrivateJsonProtector} from './lib/windows-protected-json.js';
import {snapshotDigest} from './lib/management-split-plan.js';
import {reviewManagementQuarterSnapshot, MANAGEMENT_QUARTER_REVIEW_BASELINE,
  MANAGEMENT_QUARTER_REVIEW_RECEIPT} from './lib/management-quarter-snapshot-review.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const demand = (ok, code) => {if (!ok) throw Error(code);};
const safe = e => /^[A-Z][A-Z0-9_]{2,100}$/.test(e?.message || '') ? e.message : 'QUARTER_REVIEW_LOCAL_FAILED';
const parse = bytes => {try {return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));}
  catch {throw Error('QUARTER_REVIEW_PRIVATE_JSON_INVALID');}};
const nameAllowed = v => typeof v === 'string' && /^capture-FA-[0-9]{1,32}\.dpapi\.json$/.test(v);
const outputAllowed = v => typeof v === 'string' && /^quarter-review-FA-[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.dpapi\.json$/.test(v);
const checkpointAllowed = v => typeof v === 'string' && /^capture-FA-[0-9]{1,32}-latest\.dpapi\.json$/.test(v);
const zero = {sourcePauseChanged:false, readBudgetChanged:false, credentialLookupIssued:0,
  firestoreDocumentReadsIssued:0, firestoreWritesIssued:0, authChangesIssued:0, grantsIssued:0,
  productionAuthorized:false, migrationReady:false, operationalFreshnessEvaluated:false, automaticNextBatch:false};

/** Exported dependency seams are for synthetic local fixtures. The CLI always
 * uses the existing Windows DPAPI helper, and has no credential/network path. */
export async function runLocalManagementQuarterReview({root:taskRoot = root, args,
  openProtected = openPrivateJson, createProtector = createPrivateJsonProtector, publishExclusive = link} = {}) {
  demand(Array.isArray(args) && (args.length === 3 || args.length === 5), 'USE_FA_REVIEW_COMPLETE_PRIVATE_CAPTURE');
  const [reference, mode, capture, option, output] = args;
  demand(reference === 'FA' && mode === '--review-complete' && nameAllowed(capture)
    && (args.length === 3 || option === '--out' && outputAllowed(output)),
  'USE_FA_REVIEW_COMPLETE_PRIVATE_CAPTURE');
  const absoluteRoot = resolve(taskRoot), privateRoot = resolve(absoluteRoot, '.local-preview');
  const directory = resolve(privateRoot, 'management-split');
  const checkDirectories = async () => {
    for (const path of [absoluteRoot, privateRoot, directory]) {
      const info = await lstat(path);
      demand(info.isDirectory() && !info.isSymbolicLink(), 'QUARTER_REVIEW_DIRECTORY_LINK_FORBIDDEN');
    }
    demand(relative(await realpath(absoluteRoot), await realpath(directory)) === join('.local-preview', 'management-split'),
      'QUARTER_REVIEW_DIRECTORY_SCOPE_INVALID');
  };
  await checkDirectories();
  demand((await readFile(resolve(absoluteRoot, '.gitignore'), 'utf8')).split(/\r?\n/).includes('.local-preview/'),
    'QUARTER_REVIEW_PRIVATE_NOT_IGNORED');
  const absentLock = async () => {
    try {await lstat(resolve(directory, 'backup-read-FA.lock'));}
    catch (e) {if (e.code === 'ENOENT') return; throw e;}
    throw Error('QUARTER_REVIEW_CAPTURE_LOCK_PRESENT');
  };
  await absentLock();
  if (output) {
    try {await lstat(resolve(directory, output));}
    catch (e) {if (e.code !== 'ENOENT') throw e;}
    // A separate regular read avoids treating a present dangling symlink as absent.
    try {await lstat(resolve(directory, output)); throw Error('QUARTER_REVIEW_OUTPUT_ALREADY_EXISTS');}
    catch (e) {if (e.code !== 'ENOENT') throw e;}
  }
  const reads = [];
  const readPrivate = async (name, maximumBytes = 72 * 1024 * 1024, track = true) => {
    demand(typeof name === 'string' && name === basename(name), 'QUARTER_REVIEW_PRIVATE_NAME_INVALID');
    const path = resolve(directory, name), before = await lstat(path);
    demand(before.isFile() && !before.isSymbolicLink() && before.size > 0 && before.size <= maximumBytes,
      'QUARTER_REVIEW_PRIVATE_FILE_INVALID');
    const handle = await open(path, 'r');
    let bytes;
    try {
      const opened = await handle.stat();
      demand(opened.isFile() && opened.dev === before.dev && opened.ino === before.ino
        && opened.size === before.size, 'QUARTER_REVIEW_PRIVATE_FILE_CHANGED');
      bytes = await handle.readFile();
      demand(bytes.length === opened.size && bytes.length <= maximumBytes, 'QUARTER_REVIEW_PRIVATE_FILE_CHANGED');
    } finally {await handle.close();}
    const after = await lstat(path);
    demand(after.isFile() && !after.isSymbolicLink() && after.dev === before.dev && after.ino === before.ino
      && after.size === before.size, 'QUARTER_REVIEW_PRIVATE_FILE_CHANGED');
    const item = {name, maximumBytes, sha256:hash(bytes), json:parse(bytes)};
    if (track) reads.push(item);
    return item;
  };
  const publicReceiptFile = capture.replace(/\.dpapi\.json$/, '-receipt.json');
  const receiptRead = await readPrivate(publicReceiptFile, 8 * 1024 * 1024);
  const captureRead = await readPrivate(capture);
  demand(receiptRead.json.ciphertextSha256 === captureRead.sha256, 'QUARTER_REVIEW_CAPTURE_CIPHERTEXT_PIN_MISMATCH');
  const checkpointFile = receiptRead.json.checkpointFile;
  demand(checkpointAllowed(checkpointFile), 'QUARTER_REVIEW_CHECKPOINT_NAME_INVALID');
  const headRead = await readPrivate('quarter-head-FA.json', 65536);
  const checkpointRead = await readPrivate(checkpointFile);
  const baselineRead = await readPrivate(MANAGEMENT_QUARTER_REVIEW_BASELINE);
  const baselineReceiptRead = await readPrivate(MANAGEMENT_QUARTER_REVIEW_RECEIPT, 8 * 1024 * 1024);
  const scopeRead = await readPrivate('backup-scope-FA.json', 65536);
  // Decrypt only in memory. These values must never be logged or exported as JSON.
  const packet = await openProtected(captureRead.json);
  const checkpointPacket = await openProtected(checkpointRead.json);
  const baselinePacket = await openProtected(baselineRead.json);
  const reviewed = reviewManagementQuarterSnapshot({captureName:capture, captureCiphertextSha256:captureRead.sha256,
    packet, publicReceipt:receiptRead.json, head:headRead.json, checkpointPacket, baselinePacket,
    baselineReceipt:baselineReceiptRead.json, scope:scopeRead.json});
  const unchanged = async () => {
    await checkDirectories(); await absentLock();
    for (const item of reads) {
      const current = await readPrivate(item.name, item.maximumBytes, false);
      demand(current.sha256 === item.sha256, 'QUARTER_REVIEW_INPUT_CHANGED_DURING_REVIEW');
    }
  };
  await unchanged();
  let outputCiphertextSha256 = null;
  if (output) {
    const protector = await createProtector();
    const sealed = protector.seal(reviewed.protectedReview), bytes = Buffer.from(JSON.stringify(sealed) + '\n');
    demand(sealed.schemaVersion === 2 && sealed.protection === 'AES256_GCM_WITH_WINDOWS_DPAPI_CURRENT_USER',
      'QUARTER_REVIEW_PROTECTED_OUTPUT_REQUIRED');
    await unchanged();
    const temporary = output + '.' + randomUUID() + '.tmp.dpapi.json';
    const temporaryPath = resolve(directory, temporary), outputPath = resolve(directory, output);
    let published = false, temporaryCreated = false, owned = null;
    try {
      const handle = await open(temporaryPath, 'wx', 0o600); temporaryCreated = true;
      try {owned = await handle.stat(); await handle.writeFile(bytes); await handle.sync();}
      finally {await handle.close();}
      const stored = await readPrivate(temporary, 72 * 1024 * 1024, false);
      const reopened = await openProtected(stored.json);
      demand(snapshotDigest(reopened) === snapshotDigest(reviewed.protectedReview),
        'QUARTER_REVIEW_PROTECTED_OUTPUT_ROUNDTRIP_FAILED');
      await unchanged();
      // Hard-link creation is exclusive; rename would overwrite a prior review.
      await publishExclusive(temporaryPath, outputPath); published = true;
      const final = await lstat(outputPath);
      demand(final.isFile() && !final.isSymbolicLink() && final.dev === owned.dev && final.ino === owned.ino,
        'QUARTER_REVIEW_OUTPUT_OWNERSHIP_CHANGED');
      await unchanged();
      outputCiphertextSha256 = stored.sha256;
    } catch (error) {
      if (published && owned) {
        const final = await lstat(outputPath);
        demand(final.isFile() && !final.isSymbolicLink() && final.dev === owned.dev && final.ino === owned.ino,
          'QUARTER_REVIEW_OUTPUT_OWNERSHIP_CHANGED');
        await unlink(outputPath);
      }
      throw error;
    } finally {
      if (temporaryCreated && owned) {
        try {
          const current = await lstat(temporaryPath);
          demand(current.isFile() && !current.isSymbolicLink() && current.dev === owned.dev && current.ino === owned.ino,
            'QUARTER_REVIEW_OUTPUT_OWNERSHIP_CHANGED');
          await unlink(temporaryPath);
        } catch (error) {if (error.code !== 'ENOENT') throw error;}
      }
    }
  }
  return {...reviewed.summary, protectedOutputWritten:Boolean(output), outputFile:output || null,
    outputCiphertextSha256};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {console.log(JSON.stringify(await runLocalManagementQuarterReview({args:process.argv.slice(2)})));}
  catch (error) {
    console.error(JSON.stringify({mode:'LOCAL_COMPLETE_QUARTER_REVIEW', errorCode:safe(error), ...zero}));
    process.exitCode = 1;
  }
}
