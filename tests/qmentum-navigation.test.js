import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8'),router=readFileSync(new URL('../src/router.js',import.meta.url),'utf8');
test('QMENTUM entry belongs to Clinical Coordination and is absent from the Home menu',()=>{
 assert.match(main,/area\.id === 'area-coordenacao-clinica' && can\('admin'\)[^\n]+id="qmentum-open">INDICADORES OBRIGATÓRIOS QMENTUM/);
 assert.match(main,/!\['people', 'admin', 'occurrences', 'qmentum'\]\.includes\(route\)/);
 assert.match(router,/'qmentum'/);
});
test('direct route uses only existing FA services and preserves the common-user administrative pause',()=>{
 const body=main.slice(main.indexOf("if(route === 'qmentum')"),main.indexOf("if (['management', 'training'].includes(route)"));
 assert.match(body,/import\('\.\/firebase\.js'\)/);assert.match(body,/import\('\.\/firebase-auth\.js'\)/);assert.doesNotMatch(body,/indicatorsDb|ensureProject|signIn/);
 assert.match(body,/session\.user\?\.uid===uid&&can\('admin'\)/);
 assert.match(main,/\['management', 'training', 'qmentum'\]\.includes\(requestedRoute\) && !canOpenRestrictedModule\(requestedRoute\)/);
});
