import test from 'node:test';
import assert from 'node:assert/strict';
import {renderQmentumShell} from '../src/qmentum-shell.js';

test('the registration shell identifies the module and its FC loading state',()=>{
 const html=renderQmentumShell({baseUrl:'/preview/',displayName:'Synthetic person'});
 assert.match(html,/>REGISTRO DE INDICADORES<\/h2>/);
 assert.match(html,/Carregando acesso ao FC/);
 assert.doesNotMatch(html,/Carregando acesso ao FA/);
 assert.match(html,/data-route="home">HOME<\/button>/);
});
