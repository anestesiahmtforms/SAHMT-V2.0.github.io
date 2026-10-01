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
const optionalMatch = serviceWorker.match(/const OFFLINE_OPTIONAL_ENTRIES = \[([^\]]*)\];/);
if (!optionalMatch) throw new Error('A lista de módulos opcionais offline não foi encontrada.');
const optionalEntries = [...optionalMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map((item) => item[1]);
const optionalKeysFor = (source) => Object.keys(manifest).filter((key) =>
  [key, manifest[key]?.src].some((value) => typeof value === 'string' && value.replace(/^(?:\.\.\/)+/, '') === source));
const appCheckEntry = 'node_modules/firebase/app-check/dist/esm/index.esm.js';
if (optionalKeysFor(appCheckEntry).length && !optionalEntries.includes(appCheckEntry)) throw new Error('O SDK App Check emitido é necessário para a inicialização offline do Firestore.');
for (const key of new Set(optionalEntries.flatMap(optionalKeysFor))) {
  const graph = collectGraph(key);
  for (const value of graph.visited) cachedEntries.add(value);
  for (const value of graph.files) cachedFiles.add(value);
}
for (const key of ['src/firebase-auth.js', 'src/data-lite.js', 'src/data.js', 'src/label-camera.js']) {
  if (!offlineEntries.includes(key) || !cachedEntries.has(key)) {
    throw new Error(`O fluxo offline precisa manter ${key} e suas dependências no cache.`);
  }
}
// Rollup may give a dynamic module an underscored/generated manifest key, so
// check its emitted identity as well as the source path.
for (const key of cachedEntries) {
  const entry = manifest[key];
  const identity = [key, entry.src, entry.name, entry.file].filter(Boolean).join(' ');
  if (/(report-pdf|label-ai|checklist-signature|html2canvas|dompurify|canvg)/.test(identity)) {
    throw new Error(`Módulo pesado/online não deve entrar no precache offline: ${key}`);
  }
}
let totalBytes = 0;
for (const file of cachedFiles) {
  const path = join('dist', file);
  totalBytes += statSync(path).size;
}
const fixedPrecache = serviceWorker.match(/const PRECACHE = \[([\s\S]*?)\];/);
if (!fixedPrecache || !/^\s*BASE\s*,/m.test(fixedPrecache[1])) throw new Error('O precache fixo precisa incluir a página inicial.');
const precacheFiles = new Set(['index.html', ...cachedFiles,
  ...[...fixedPrecache[1].matchAll(/`\$\{BASE\}([^`]+)`/g)].map((item) => item[1])]);
const precacheBytes = [...precacheFiles].reduce((sum, file) => sum + statSync(join('dist', file)).size, 0);
console.log(`[offline manifest] shell: ${shell.files.size} arquivos / ${[...shell.files].reduce((sum, file) => sum + statSync(join('dist', file)).size, 0)} bytes; grafo offline: ${cachedFiles.size} arquivos / ${totalBytes} bytes; precache total com HTML/manifestos/imagens fixas: ${precacheFiles.size} arquivos / ${precacheBytes} bytes; módulos offline adicionais: ${offlineEntries.join(', ')}`);
