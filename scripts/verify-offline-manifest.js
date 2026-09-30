import {readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';

const manifestPath = 'dist/assets-manifest.json';
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const serviceWorker = readFileSync('public/service-worker.js', 'utf8');
const match = serviceWorker.match(/const OFFLINE_DYNAMIC_ENTRIES = \[([^\]]*)\];/);
if (!match) throw new Error('A lista de módulos offline não foi encontrada no Service Worker.');
const offlineEntries = [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((item) => item[1]);
if (!offlineEntries.length) throw new Error('Nenhum módulo adicional foi marcado como essencial offline.');

const entryKey = Object.keys(manifest).find((key) => manifest[key]?.isEntry && /\.js$/.test(manifest[key].file || ''));
if (!entryKey) throw new Error('A entrada JS do PWA não está no manifest Vite.');

function collectGraph(rootKey) {
  const visited = new Set();
  const files = new Set();
  const visit = (key) => {
    if (visited.has(key)) return;
    const entry = manifest[key];
    if (!entry) throw new Error(`Import ausente no manifest Vite: ${key}`);
    visited.add(key);
    for (const file of [entry.file, ...(entry.css || []), ...(entry.assets || [])]) {
      if (file) files.add(file);
    }
    for (const imported of entry.imports || []) visit(imported);
  };
  visit(rootKey);
  return {visited, files};
}

const shell = collectGraph(entryKey);
const cachedEntries = new Set(shell.visited);
const cachedFiles = new Set(shell.files);
for (const key of offlineEntries) {
  const graph = collectGraph(key);
  for (const value of graph.visited) cachedEntries.add(value);
  for (const value of graph.files) cachedFiles.add(value);
}
if (!offlineEntries.includes('src/data.js') || !cachedEntries.has('src/data.js')) {
  throw new Error('O fluxo offline precisa manter src/data.js e suas dependências no cache.');
}
for (const key of ['src/report-pdf.js', 'src/label-ai.js', 'src/checklist-signature.js']) {
  if (cachedEntries.has(key)) throw new Error(`Módulo pesado/online não deve entrar no precache offline: ${key}`);
}
let totalBytes = 0;
for (const file of cachedFiles) {
  const path = join('dist', file);
  totalBytes += statSync(path).size;
}
console.log(`[offline manifest] shell: ${shell.files.size} arquivos / ${[...shell.files].reduce((sum, file) => sum + statSync(join('dist', file)).size, 0)} bytes; cache completo: ${cachedFiles.size} arquivos / ${totalBytes} bytes; módulos offline adicionais: ${offlineEntries.join(', ')}`);
