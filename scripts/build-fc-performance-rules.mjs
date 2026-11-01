import {readFile,writeFile} from 'node:fs/promises';
import {buildFcPerformanceRules} from './lib/fc-performance-rules.js';
const path=new URL('../firestore.fc.rules',import.meta.url);
await writeFile(path,buildFcPerformanceRules(await readFile(path,'utf8')));
console.log('FC_PERFORMANCE_RULES_PREPARED_LOCAL_ONLY');
