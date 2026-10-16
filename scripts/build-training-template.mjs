import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const source=await readFile(new URL('scripts/lib/training-template-standardization.js',root),'utf8');
const generated='/** Data-only planner; no API calls on definition. */\nconst SAHMT_TRAINING_TEMPLATE_PLANNER=(function(){\n'+source
  .replace("import {createHash} from 'node:crypto';",'')
  .replace('const copy = value => structuredClone(value);','const copy = value => JSON.parse(JSON.stringify(value));')
  .replace("const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');",'const hash = value => formsEvaluationHash_(value);')
  .replaceAll('export function ','function ')
  +'\nreturn Object.freeze({plan:planTrainingTemplate,verify:verifyTrainingTemplateReadback});\n})();\n';
const destination=new URL('apps-script-v2/TrainingTemplatePlanner.gs',root);
if(process.argv.includes('--check')) {
  if(await readFile(destination,'utf8')!==generated)throw Error('TRAINING_TEMPLATE_GENERATED_SOURCE_OUTDATED');
  console.log('TRAINING_TEMPLATE_GENERATED_SOURCE_OK');
}else {await writeFile(destination,generated);console.log('TRAINING_TEMPLATE_GENERATED');}
