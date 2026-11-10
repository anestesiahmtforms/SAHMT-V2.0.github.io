import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {generateKeyPairSync, verify} from 'node:crypto';
import {projectionHeaders} from '../worker-operational-domain/projection-runtime.js';
import {encodeFields, decodeFields} from '../worker-training/firestore.js';
const require = createRequire(import.meta.resolve('wrangler/package.json'));
const {build} = require('esbuild'), {Miniflare, convertV4MiniflareOptions} = require('miniflare');

test('actual Worker runtime derives an FJ session from FA and authenticates idempotent FI projections', async () => {
  const project = 'sahmt-escala-fj', prefix = `projects/${project}/databases/(default)/documents`, secret = 'synthetic-'.repeat(8);
  const keys = generateKeyPairSync('rsa', {modulusLength: 2048});
  const credentials = {project_id: project, client_email: `fj-module-worker@${project}.iam.gserviceaccount.com`, private_key: keys.privateKey.export({type: 'pkcs8', format: 'pem'})};
  const actor = {uid: 'synthetic-member', email: 'member@example.test'}, now = Math.floor(Date.now() / 1000);
  const token = Buffer.from('{"alg":"RS256"}').toString('base64url') + '.' + Buffer.from(JSON.stringify({aud: 'sahmt-17a16',
    iss: 'https://securetoken.google.com/sahmt-17a16', sub: actor.uid, email: actor.email, email_verified: true,
    auth_time: now - 100, iat: now, exp: now + 3600})).toString('base64url') + '.' + 'x'.repeat(50);
  const profile = {uid: actor.uid, email: actor.email, active: true, access: true, permissions: {scheduleRead: true}};
  const documents = new Map([[prefix + '/scheduleDays/2026-11-06', encodeFields({date: '2026-11-06', version: 1,
    positions: [{position: 1, sigla: 'AA'}], highlights: {siglas: ['AA'], releaseTimes: {AA: 1800000000000}, events: []}})]]);
  let commits = 0, sourceReads = 0; const requests = [],documentReads=[];
  const bundle = await build({entryPoints: ['worker-operational-domain/worker.js'], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', external: ['node:*']});
  const mf = new Miniflare(convertV4MiniflareOptions({name: 'fj-module-test', modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-10-13', compatibilityFlags: ['nodejs_compat'], bindings: {
      MODULE_STATION: 'FJ', MODULE_PROJECT_ID: project, MODULE_CUTOVER_ACTIVE: 'true', ALLOWED_ORIGINS: 'https://example.test',
      FA_PUBLIC_API_KEY: 'synthetic-public-key', MODULE_SERVICE_ACCOUNT_JSON: JSON.stringify(credentials), EVENT_PROJECTION_SHARED_SECRET: secret
    }, outboundService: async request => {
      const url = new URL(request.url);
      requests.push(url.hostname + url.pathname);
      if (url.hostname === 'identitytoolkit.googleapis.com') {
        assert.equal((await request.json()).idToken, token);
        return Response.json({users: [{localId: actor.uid, email: actor.email, emailVerified: true, validSince: '0'}]});
      }
      if (url.hostname === 'oauth2.googleapis.com') return Response.json({access_token: 'synthetic-service-token', expires_in: 3600});
      assert.equal(url.hostname, 'firestore.googleapis.com');
      const name = decodeURIComponent(url.pathname.slice(4));
      if (name === `projects/sahmt-17a16/databases/(default)/documents/users/${actor.uid}`) {
        sourceReads++; assert.equal(request.headers.get('Authorization'), 'Bearer ' + token);
        return Response.json({name, fields: encodeFields(profile)});
      }
      assert.ok(name.startsWith(prefix)); assert.equal(request.headers.get('Authorization'), 'Bearer synthetic-service-token');
      if (name === prefix + '/users/' + actor.uid) return Response.json({name, fields: encodeFields(profile)});
      const payload = await request.json();
      if (name.endsWith(':beginTransaction')) return Response.json({transaction: 'synthetic-transaction'});
      if (name.endsWith(':rollback')) return Response.json({});
      if (name.endsWith(':batchGet')) {documentReads.push(...payload.documents);return Response.json(payload.documents.map(id => documents.has(id) ? {found: {name: id, fields: documents.get(id)}} : {missing: id}));}
      if (name.endsWith(':commit')) {
        commits++;
        for (const write of payload.writes) {
          assert.ok(write.update.name.startsWith(prefix));
          const fields = structuredClone(documents.get(write.update.name) || {});
          if (write.updateMask) for (const path of write.updateMask.fieldPaths) {
            const parts = path.split('.'); let destination = fields, source = write.update.fields;
            for (const part of parts.slice(0, -1)) {destination[part] ??= {mapValue: {fields: {}}}; destination = destination[part].mapValue.fields; source = source[part].mapValue.fields;}
            destination[parts.at(-1)] = source[parts.at(-1)];
          } else Object.assign(fields, write.update.fields);
          documents.set(write.update.name, fields);
        }
        return Response.json({commitTime: new Date().toISOString()});
      }
      throw Error('UNEXPECTED_LOCAL_RUNTIME_REQUEST');
    }}));
  try {
    const session = await mf.dispatchFetch('https://module.test/v1/session', {method: 'POST',
      headers: {Origin: 'https://example.test', Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'}, body: '{}'});
    assert.equal(session.status, 200, JSON.stringify({requests, sourceReads, reply: await session.clone().text()})); const result = await session.json(), parts = result.customToken.split('.');
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
    assert.equal(result.uid, actor.uid); assert.equal(claims.claims.moduleStation, 'FJ'); assert.ok(claims.claims.moduleLeaseExpiresAt > now);
    assert.equal(verify('RSA-SHA256', Buffer.from(parts.slice(0, 2).join('.')), keys.publicKey, Buffer.from(parts[2], 'base64url')), true);
    assert.equal(sourceReads, 1);
    const denied = await mf.dispatchFetch('https://module.test/internal/v1/event-projection', {method: 'POST', body: '{}'});
    assert.equal(denied.status, 401); assert.equal(commits, 0);
    const event = {eventId: 'event', version: 1, date: '2026-11-06', active: true, scheduleSigla: 'AA', memberSigla: 'BB', actorUid: actor.uid};
    const body = JSON.stringify(event);
    for (let attempt = 0; attempt < 2; attempt++) {
      const reply = await mf.dispatchFetch('https://module.test/internal/v1/event-projection', {method: 'POST', body, headers: projectionHeaders(body, secret)});
      assert.equal(reply.status, 200); assert.equal((await reply.json()).status, attempt ? 'ALREADY_APPLIED' : 'APPLIED');
    }
    assert.equal(commits, 1);
    const schedule = decodeFields(documents.get(prefix + '/scheduleDays/2026-11-06'));
    assert.deepEqual(schedule.highlights.siglas, ['AA']); assert.deepEqual(schedule.highlights.releaseTimes, {AA: 1800000000000});
    assert.deepEqual(schedule.highlights.events, ['EVENTO:AA:BB:event']);
    documents.set(prefix+'/runtimePolicy/folders',encodeFields({schemaVersion:1,revision:1,disabled:['operacao/escala']}));
    documentReads.length=0;
    const paused=await mf.dispatchFetch('https://module.test/internal/v1/event-projection',{method:'POST',body,headers:projectionHeaders(body,secret)});
    assert.equal(paused.status,403);assert.equal((await paused.json()).code,'DOMAIN_FOLDER_DISABLED');
    assert.deepEqual(documentReads,[prefix+'/runtimePolicy/folders']);assert.equal(commits,1);
    documents.set(prefix+'/runtimePolicy/folders',encodeFields({schemaVersion:1,revision:0,disabled:[]}));documentReads.length=0;
    const malformed=await mf.dispatchFetch('https://module.test/internal/v1/event-projection',{method:'POST',body,headers:projectionHeaders(body,secret)});
    assert.equal(malformed.status,503);assert.equal((await malformed.json()).code,'DOMAIN_FOLDER_POLICY_INVALID');assert.deepEqual(documentReads,[prefix+'/runtimePolicy/folders']);
  } finally {await mf.dispose();}
});
