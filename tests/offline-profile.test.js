import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source = readFileSync(new URL('../src/auth.js', import.meta.url), 'utf8');
const fn = source.slice(source.indexOf('async function showCachedSession('), source.indexOf('export function watchSession('));
test('resposta do perfil local após troca de usuário é descartada', async () => {
  let finish, current = true; const states = [];
  const ctx = vm.createContext({readCachedProfile: () => new Promise(resolve => {finish = resolve;}), profileForPresentation: value => value}); vm.runInContext(fn, ctx);
  const loading = ctx.showCachedSession({uid: 'a'}, state => states.push(state), () => current);
  current = false; finish({uid: 'a', active: true, access: true}); await loading;
  assert.equal(states.length, 0);
});
test('perfil local de outra identidade nunca abre a sessão', async () => {
  const states = [];
  const ctx = vm.createContext({readCachedProfile: async () => ({uid: 'other', active: true, access: true}), profileForPresentation: value => value}); vm.runInContext(fn, ctx);
  await ctx.showCachedSession({uid: 'a'}, state => states.push(state));
  assert.equal(states[0].status, 'profile-error');
});
