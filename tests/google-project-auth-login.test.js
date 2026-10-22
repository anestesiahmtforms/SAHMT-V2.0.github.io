import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const auth=readFileSync(new URL('../src/auth.js',import.meta.url),'utf8');
const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');

test('login habitual FA não inicia conexões secundárias automaticamente',()=>{
  const start=auth.indexOf('export async function signInGoogle()');
  const end=auth.indexOf('export async function signOutGlobal()',start);
  assert.notEqual(start,-1);assert.notEqual(end,-1);
  const login=auth.slice(start,end);
  assert.match(login,/return api\.signInWithPopup\(api\.auth, provider, api\.browserPopupRedirectResolver\)/);
  assert.doesNotMatch(login,/adoptGoogleSignInResult|\.connect\(/);
});

test('conexão secundária fica atrás da confirmação explícita do painel',()=>{
  assert.match(main,/createGoogleButton/);
  assert.match(main,/confirm:runtime\.confirmGoogleProjectAccess/);
  assert.match(main,/if \(googleProjectAuthEnabled\)/);
});
