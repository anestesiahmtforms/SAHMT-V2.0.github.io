import { mkdir, writeFile } from 'node:fs/promises';
import { firebaseCliAccountToken } from './lib/firebase-cli-account-token.js';
import { google } from './lib/fd-fe-release.js';

const source = 'sahmt-17a16';
const destination = 'sahmt-comunicacao-ff';
const database = 'comunicacao';
const ffEmail = 'anestesiahmtforms6@gmail.com';
const faEmail = 'anestesiahmtforms@gmail.com';
const identity = 'https://identitytoolkit.googleapis.com';
const firebase = 'https://firebase.googleapis.com/v1beta1/projects/';
const authConfig = project => identity + '/admin/v2/projects/' + project;
const accounts = project => identity + '/v1/projects/' + project + '/accounts:';
const providerPath = '/defaultSupportedIdpConfigs/google.com';
const apply = process.argv.includes('--apply');
const requireState = (condition, code) => { if (!condition) throw Error(code); };

async function listUsers(project, token) {
  const users = [];
  let nextPageToken;
  do {
    const query = new URLSearchParams({ maxResults: '1000' });
    if (nextPageToken) query.set('nextPageToken', nextPageToken);
    const result = await google(accounts(project) + 'batchGet?' + query, token);
    users.push(...(result.users || []));
    nextPageToken = result.nextPageToken;
  } while (nextPageToken);
  return users;
}

function canonicalUser(user) {
  requireState(typeof user.localId === 'string' && /^[^/\s]{1,128}$/.test(user.localId), 'FF_SOURCE_UID_INVALID');
  const providers = (user.providerUserInfo || []).filter(p => p.providerId === 'google.com');
  requireState(providers.length <= 1, 'FF_GOOGLE_LINK_AMBIGUOUS');
  const googleProvider = providers[0];
  if (googleProvider) {
    requireState(user.emailVerified === true && typeof user.email === 'string' && user.email
      && typeof googleProvider.rawId === 'string' && googleProvider.rawId, 'FF_GOOGLE_LINK_UNVERIFIED');
  }
  const record = {
    localId: user.localId,
    emailVerified: user.emailVerified === true,
    disabled: user.disabled === true,
    providerUserInfo: googleProvider ? [{ providerId: 'google.com', rawId: googleProvider.rawId }] : []
  };
  if (user.email) record.email = user.email;
  if (user.displayName) record.displayName = user.displayName;
  if (googleProvider?.email) record.providerUserInfo[0].email = googleProvider.email;
  return record;
}

function index(users, key, code) {
  const map = new Map();
  for (const user of users) {
    const value = key(user);
    if (!value) continue;
    requireState(!map.has(value), code);
    map.set(value, user);
  }
  return map;
}

const emailKey = user => user.email?.trim().toLowerCase();
const googleKey = user => user.providerUserInfo?.find(p => p.providerId === 'google.com')?.rawId;
const uidKey = user => user.localId;
const same = (left, right) => uidKey(left) === uidKey(right) && emailKey(left) === emailKey(right)
  && googleKey(left) === googleKey(right) && Boolean(left.disabled) === Boolean(right.disabled)
  && Boolean(left.emailVerified) === Boolean(right.emailVerified);

async function configureAuth(ff, sourceProvider, current) {
  const domain = 'anestesiahmtforms.github.io';
  const authorizedDomains = [...new Set([...(current.authorizedDomains || []), domain, 'localhost'])];
  await google(authConfig(destination) + '/config?updateMask=authorizedDomains,client.permissions.disabledUserSignup',
    ff, { authorizedDomains, client: { permissions: { disabledUserSignup: true } } }, 'PATCH');
  const settings = await google(authConfig(destination) + '/config', ff);
  requireState(settings.client?.permissions?.disabledUserSignup === true && settings.authorizedDomains?.includes(domain),
    'FF_AUTH_SIGNUP_GUARD_FAILED');
  const path = authConfig(destination) + providerPath;
  const existing = await google(path, ff, undefined, 'GET', true);
  if (!existing || !existing.enabled || existing.clientId !== sourceProvider.clientId) {
    const provider = { enabled: true, clientId: sourceProvider.clientId, clientSecret: sourceProvider.clientSecret };
    requireState(typeof provider.clientSecret === 'string' && provider.clientSecret.length > 10, 'FF_SOURCE_OAUTH_SECRET_UNAVAILABLE');
    if (existing) await google(path + '?updateMask=enabled,clientId,clientSecret', ff, provider, 'PATCH');
    else await google(authConfig(destination) + '/defaultSupportedIdpConfigs?idpId=google.com', ff, provider);
  }
  const verified = await google(path, ff);
  requireState(verified.enabled && verified.clientId === sourceProvider.clientId, 'FF_GOOGLE_PROVIDER_READBACK_FAILED');
}

try {
  const [fa, ff] = await Promise.all([firebaseCliAccountToken(faEmail), firebaseCliAccountToken(ffEmail)]);
  const [project, billing, firestore, sourceProvider, sourceUsers] = await Promise.all([
    google(firebase + destination, ff),
    google('https://cloudbilling.googleapis.com/v1/projects/' + destination + '/billingInfo', ff),
    google('https://firestore.googleapis.com/v1/projects/' + destination + '/databases', ff),
    google(authConfig(source) + providerPath, fa),
    listUsers(source, fa)
  ]);
  requireState(project.projectId === destination && project.state === 'ACTIVE', 'FF_FIREBASE_PROJECT_MISMATCH');
  requireState(billing.billingEnabled === false, 'FF_BILLING_MUST_BE_DISABLED');
  requireState(firestore.databases?.length === 1 && firestore.databases[0].name === 'projects/' + destination + '/databases/' + database
    && firestore.databases[0].type === 'FIRESTORE_NATIVE', 'FF_NAMED_DATABASE_REQUIRED');
  requireState(sourceProvider.enabled && sourceProvider.clientId, 'FF_SOURCE_GOOGLE_PROVIDER_REQUIRED');
  const current = await google(authConfig(destination) + '/config', ff, undefined, 'GET', true);
  requireState(current, 'FF_ENABLE_FIREBASE_AUTHENTICATION_IN_CONSOLE');

  const records = sourceUsers.map(canonicalUser);
  requireState(records.length > 0, 'FF_SOURCE_ACCOUNTS_REQUIRED');
  const sourceByUid = index(records, uidKey, 'FF_SOURCE_UID_DUPLICATE');
  index(records, emailKey, 'FF_SOURCE_EMAIL_DUPLICATE');
  index(records, googleKey, 'FF_SOURCE_GOOGLE_DUPLICATE');
  const before = await listUsers(destination, ff);
  const beforeByUid = index(before, uidKey, 'FF_DESTINATION_UID_DUPLICATE');
  index(before, emailKey, 'FF_DESTINATION_EMAIL_DUPLICATE');
  index(before, googleKey, 'FF_DESTINATION_GOOGLE_DUPLICATE');
  requireState(before.every(user => sourceByUid.has(uidKey(user)) && same(user, sourceByUid.get(uidKey(user)))),
    'FF_DESTINATION_ACCOUNT_CONFLICT');
  const missing = records.filter(user => !beforeByUid.has(uidKey(user)));
  const summary = { station: 'FF', projectId: destination, database, sourceProjectId: source, accounts: records.length,
    googleLinked: records.filter(googleKey).length, alreadyMatched: before.length, toImport: missing.length, billingEnabled: false };
  if (apply) {
    await configureAuth(ff, sourceProvider, current);
    for (let offset = 0; offset < missing.length; offset += 1000) {
      const users = missing.slice(offset, offset + 1000);
      const result = await google(accounts(destination) + 'batchCreate', ff,
        { hashAlgorithm: 'BCRYPT', sanityCheck: true, allowOverwrite: false, users });
      requireState(!(result.error?.length || result.errors?.length || result.failureCount), 'FF_IMPORT_PARTIAL_RECHECK_REQUIRED');
    }
    const after = await listUsers(destination, ff);
    const afterByUid = index(after, uidKey, 'FF_READBACK_UID_DUPLICATE');
    requireState(after.length === records.length && records.every(user => same(user, afterByUid.get(uidKey(user)) || {})),
      'FF_UID_GOOGLE_LINK_READBACK_FAILED');
    summary.uidAndGoogleLinkVerified = true;
    summary.created = missing.length;
    await mkdir('.local-preview/ff', { recursive: true });
    await writeFile('.local-preview/ff/identity-status.json', JSON.stringify(summary, null, 2) + '\n');
  }
  console.log(JSON.stringify(summary));
} catch (error) {
  console.error(/^[A-Z_0-9]+$/.test(error.message) ? error.message : 'FF_PROVISIONING_FAILED');
  process.exitCode = 1;
}
