import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sealPrivateJson, openPrivateJson, createPrivateJsonProtector} from '../scripts/lib/windows-protected-json.js';
const windows = process.platform === 'win32';
const synthetic = {kind: 'SYNTHETIC_ONLY', records: [{id: 'test-member', enabled: false}], note: 'áé São Paulo'};
test('DPAPI v1 confere ida e volta sem persistir dados reais', {skip: !windows}, async () => {
  const sealed = await sealPrivateJson(synthetic);
  assert.equal(sealed.schemaVersion, 1); assert.deepEqual(await openPrivateJson(sealed), synthetic);
  assert.ok(!JSON.stringify(sealed).includes('test-member'));
  await assert.rejects(openPrivateJson({...sealed, plaintextSha256: '0'.repeat(64)}), /DIGEST_MISMATCH/);
});
test('AES-GCM v2 reutiliza chave protegida com nonces independentes e verifica conteúdo', {skip: !windows}, async () => {
  const protector = await createPrivateJsonProtector(), first = protector.seal(synthetic), second = protector.seal(synthetic);
  assert.equal(first.schemaVersion, 2); assert.equal(first.wrappedKey, second.wrappedKey); assert.notEqual(first.iv, second.iv);
  assert.notEqual(first.ciphertext, second.ciphertext); assert.deepEqual(await openPrivateJson(first), synthetic); assert.deepEqual(await openPrivateJson(second), synthetic);
});
test('v2 rejeita tag ou ciphertext adulterado e hash divergente', {skip: !windows}, async () => {
  const protector = await createPrivateJsonProtector(), envelope = protector.seal(synthetic);
  const mutate = key => { const bytes = Buffer.from(envelope[key], 'base64'); bytes[0] ^= 1; return {...envelope, [key]: bytes.toString('base64')}; };
  await assert.rejects(openPrivateJson(mutate('tag')), /AUTHENTICATION_FAILED/);
  await assert.rejects(openPrivateJson(mutate('ciphertext')), /AUTHENTICATION_FAILED/);
  await assert.rejects(openPrivateJson({...envelope, plaintextSha256: '0'.repeat(64)}), /DIGEST_MISMATCH/);
});
test('cabeçalhos inválidos falham antes de chamar DPAPI', async () => {
  for (const envelope of [null, {schemaVersion: 3}, {schemaVersion: 1, protection: 'OTHER'}, {schemaVersion: 2, protection: 'AES256_GCM_WITH_WINDOWS_DPAPI_CURRENT_USER', plaintextSha256: 'invalid'}]) {
    await assert.rejects(openPrivateJson(envelope), /HEADER_INVALID/);
  }
});

test('protector.open faz readback síncrono e independente sem expor a chave', {skip: !windows}, async () => {
  const protector = await createPrivateJsonProtector();
  assert.equal(Object.isFrozen(protector), true);
  assert.deepEqual(Reflect.ownKeys(protector).sort(), ['open', 'seal']);
  let finalEnvelope;
  for (let index = 0; index < 100; index++) {
    const value = {...synthetic, revision: index};
    finalEnvelope = protector.seal(value);
    const opened = protector.open(JSON.parse(JSON.stringify(finalEnvelope)));
    assert.equal(opened instanceof Promise, false);
    assert.deepEqual(opened, value);
  }
  assert.deepEqual(await openPrivateJson(finalEnvelope), {...synthetic, revision: 99});
});

test('protector.open recusa chave de outra instância e conteúdo adulterado', {skip: !windows}, async () => {
  const protector = await createPrivateJsonProtector(), other = await createPrivateJsonProtector();
  const envelope = protector.seal(synthetic);
  assert.throws(() => other.open(envelope), /PROTECTOR_KEY_MISMATCH/);
  const mutate = key => {
    const bytes = Buffer.from(envelope[key], 'base64'); bytes[0] ^= 1;
    return {...envelope, [key]: bytes.toString('base64')};
  };
  for (const key of ['tag', 'ciphertext', 'iv']) {
    assert.throws(() => protector.open(mutate(key)), /AUTHENTICATION_FAILED/);
  }
  assert.throws(() => protector.open({...envelope, plaintextSha256: '0'.repeat(64)}), /DIGEST_MISMATCH/);
});

test('protector.open recusa cabeçalhos ambíguos antes de avaliar accessors', {skip: !windows}, async () => {
  const protector = await createPrivateJsonProtector(), envelope = protector.seal(synthetic);
  const symbolHeader = {...envelope, [Symbol('unexpected')]: true};
  const nonEnumerable = {...envelope}; Object.defineProperty(nonEnumerable, 'unexpected', {value: true});
  let getterCalls = 0;
  const accessor = {...envelope}; Object.defineProperty(accessor, 'schemaVersion', {get() { getterCalls++; return 2; }});
  const invalid = [null, [], {schemaVersion: 1}, {...envelope, extra: true}, symbolHeader, nonEnumerable, accessor,
    {...envelope, iv: 'AAA='}, {...envelope, tag: 'AAA='}, {...envelope, ciphertext: '!'},
    {...envelope, plaintextSha256: 42}, Object.assign(Object.create({extra: true}), envelope)];
  for (const item of invalid) assert.throws(() => protector.open(item), /HEADER_INVALID/);
  assert.equal(getterCalls, 0);
  assert.deepEqual(protector.open(Object.assign(Object.create(null), envelope)), synthetic);
});
