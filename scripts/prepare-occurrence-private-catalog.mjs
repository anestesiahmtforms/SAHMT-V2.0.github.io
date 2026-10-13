import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {extractOccurrenceCatalog} from './lib/occurrence-catalog-extract.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[2];
if (!source || process.argv.length > 3) {
  process.stderr.write('Uso: node scripts/prepare-occurrence-private-catalog.mjs <caminho-do-prompt-md>\n');
  process.exitCode = 2;
} else {
  try {
    const markdown = await readFile(path.resolve(source), 'utf8');
    const catalog = extractOccurrenceCatalog(markdown);
    const outputDirectory = path.join(root, '.local-preview', 'occurrences');
    await mkdir(outputDirectory, {recursive: true});
    await writeFile(path.join(outputDirectory, 'catalog.json'), JSON.stringify(catalog), {encoding: 'utf8', mode: 0o600});
    process.stdout.write(`OCCURRENCE_CATALOG_READY ${Object.keys(catalog.catalogs).length} catálogos\n`);
  } catch (error) {
    process.stderr.write(`${/OCCURRENCE_CATALOG_[A-Z_]+/.exec(error?.message || '')?.[0] || 'OCCURRENCE_CATALOG_PREPARATION_FAILED'}\n`);
    process.exitCode = 1;
  }
}
