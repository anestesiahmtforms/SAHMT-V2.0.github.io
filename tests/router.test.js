import {test} from 'node:test';
import assert from 'node:assert/strict';

Object.defineProperty(globalThis, 'location', {configurable: true, value: {hash: ''}});
const {currentRoute, navigate} = await import('../src/router.js');

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
