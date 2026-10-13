import test from 'node:test';
import assert from 'node:assert/strict';
import {OCCURRENCE_CATALOG_SPECS} from '../src/occurrence-schema.js';
import {extractOccurrenceCatalog} from '../scripts/lib/occurrence-catalog-extract.js';

const fixture = Object.entries(OCCURRENCE_CATALOG_SPECS).map(([key, spec]) =>
  `### ${key} (${spec.count} opções)\n${Array.from({length:spec.count},(_,i)=>`${i+1}. Sintético ${key} ${i+1}`).join('\n')}`
).join('\n');

test('extrai todos os dicionários sintéticos sem alterar ordem ou contagens', () => {
  const value = extractOccurrenceCatalog(fixture);
  assert.equal(value.schemaVersion,1);
  for (const [key,spec] of Object.entries(OCCURRENCE_CATALOG_SPECS)) {
    assert.equal(value.catalogs[key].length,spec.count);
    assert.equal(value.catalogs[key][0],`Sintético ${key} 1`);
    assert.equal(value.catalogs[key].at(-1),`Sintético ${key} ${spec.count}`);
  }
});

test('rejeita fonte incompleta, contagem divergente, duplicatas e conteúdo vazio', () => {
  assert.throws(()=>extractOccurrenceCatalog('sem catálogos'),/OCCURRENCE_CATALOG_INCOMPLETE/);
  const incomplete=fixture.replace(/\n\d+\. Sintético SETORES_9 9/,'');
  assert.throws(()=>extractOccurrenceCatalog(incomplete),/OCCURRENCE_CATALOG_CONTENT_INVALID/);
  const duplicate=fixture.replace('2. Sintético SETORES_9 2','2. Sintético SETORES_9 1');
  assert.throws(()=>extractOccurrenceCatalog(duplicate),/OCCURRENCE_CATALOG_CONTENT_INVALID/);
  assert.throws(()=>extractOccurrenceCatalog('x'.repeat(500001)),/OCCURRENCE_CATALOG_SOURCE_INVALID/);
});
