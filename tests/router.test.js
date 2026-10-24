import {test} from 'node:test';
import assert from 'node:assert/strict';

Object.defineProperty(globalThis, 'location', {configurable: true, value: {hash: ''}});
const {currentRoute, navigate, shouldRenderHashChange} = await import('../src/router.js');

test('rota de sincronização pertence ao roteador do mesmo PWA', () => {
  navigate('offline');
  assert.equal(location.hash, '#/offline');
  assert.equal(currentRoute(), 'offline');
});

test('rota desconhecida não altera a navegação atual', () => {
  navigate('offline');
  navigate('apps-script');
  assert.equal(location.hash, '#/offline');
});

test('Registro de Ocorrências possui rota própria sem reutilizar Eventos de Escala',()=>{
  navigate('occurrences');
  assert.equal(location.hash,'#/occurrences');
  assert.equal(currentRoute(),'occurrences');
  navigate('events');
  assert.equal(currentRoute(),'events');
});

test('sessão autenticada offline redesenha a rota ao navegar', () => {
  assert.equal(shouldRenderHashChange({status: 'signed-in', offline: true}), true);
  assert.equal(shouldRenderHashChange({status: 'signed-in', offline: false}), true);
  assert.equal(shouldRenderHashChange({status: 'auth-limited', offline: true}), false);
});

test('voltar aos painéis de Governança usa a rota local sem recarregar FA', () => {
  navigate('management-hub', {panel:'records'});
  assert.equal(location.hash, '#/management-hub/records');
  assert.equal(currentRoute(), 'management-hub');
  navigate('management-hub', {panel:'https://example.com'});
  assert.equal(location.hash, '#/management-hub');
});
