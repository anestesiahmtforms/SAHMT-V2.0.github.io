import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
// Source hygiene only: current remote trigger state needs separate evidence.
test('FA excludes the executed one-off tool and retired trigger installers',()=>{
 const directory=new URL('../apps-script-v2/',import.meta.url);
 assert.equal(existsSync(new URL('FaRoutineRetirement.gs',directory)),false);
 const source=readdirSync(directory).filter(f=>f.endsWith('.gs')).map(f=>readFileSync(new URL(f,directory),'utf8')).join('\n');
 for(const name of ['retirarAcionadoresLegadosFA20261108','installEvaluationTriggers','installChecklistResponsibilityTrigger','installChecklistValidationTrigger','installManagementScoreValidationTrigger','installTrainingValidationTrigger','instalarDesempenhoFaV1','executarDesempenhoFaV1'])
  assert.doesNotMatch(source,new RegExp(`function\\s+${name}\\s*\\(`),name);
});
