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

test('Desempenho FD e FE têm rotas próprias no PWA',()=>{
 navigate('fd-performance');assert.equal(location.hash,'#/fd-performance');assert.equal(currentRoute(),'fd-performance');
 navigate('fe-performance');assert.equal(location.hash,'#/fe-performance');assert.equal(currentRoute(),'fe-performance');
});

test('sessão autenticada offline redesenha a rota ao navegar', () => {
  assert.equal(shouldRenderHashChange({status: 'signed-in', offline: true}), true);
  assert.equal(shouldRenderHashChange({status: 'signed-in', offline: false}), true);
  assert.equal(shouldRenderHashChange({status: 'auth-limited', offline: true}), true);
  for(const status of ['checking','loading-profile','blocked','signed-out','auth-error'])
    assert.equal(shouldRenderHashChange({status}), false);
});

test('voltar aos painéis de Governança usa a rota local sem recarregar FA', () => {
  navigate('management-hub', {panel:'records'});
  assert.equal(location.hash, '#/management-hub/records');
  assert.equal(currentRoute(), 'management-hub');
  navigate('management-hub', {panel:'https://example.com'});
  assert.equal(location.hash, '#/management-hub');
});
test('station performance has an internal panel URL under its module container',()=>{
 for(const panel of ['fdPerformance','fePerformance']){
  navigate('management-hub',{panel});
  assert.equal(location.hash,'#/management-hub/'+panel);
  assert.equal(currentRoute(),'management-hub');
 }
});
