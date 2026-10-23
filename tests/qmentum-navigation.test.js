import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8'),router=readFileSync(new URL('../src/router.js',import.meta.url),'utf8'),hub=readFileSync(new URL('../src/management-hub.js',import.meta.url),'utf8');
test('QMENTUM opens directly from Registro de Indicadores and is absent from Clinical Coordination',()=>{
 assert.doesNotMatch(main,/qmentum-open/);
 assert.match(hub,/label:'Registro de Indicadores',icon:'indicators',route:'qmentum',access:'qmentum'/);
 assert.doesNotMatch(hub,/label:'Indicadores Qmentum'|indicators:\{title:/);
 assert.match(main,/!\['people', 'admin', 'occurrences', 'qmentum'\]\.includes\(route\)/);
 assert.match(router,/'qmentum'/);
});
test('direct route uses the independent FC services and preserves the common-user administrative pause',()=>{
 const body=main.slice(main.indexOf("if(route === 'qmentum')"),main.indexOf("if (['management', 'training'].includes(route)"));
 assert.match(body,/import\('\.\/fc-module-firebase\.js'\)/);assert.match(body,/import\('\.\/fc-module-session\.js'\)/);assert.match(body,/getIndicatorsAuth\(\),db=getIndicatorsFirestore\(\)/);assert.doesNotMatch(body,/indicatorsDb|ensureProject|signIn/);
 assert.match(body,/session\.user\?\.uid===uid&&canOpenRestrictedModule\('qmentum'\)/);
 assert.match(main,/\['management', 'training', 'qmentum'\]\.includes\(requestedRoute\) && !canOpenRestrictedModule\(requestedRoute\)/);
});
