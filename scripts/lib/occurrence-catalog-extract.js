import {OCCURRENCE_CATALOG_SPECS} from '../../src/occurrence-schema.js';

export function extractOccurrenceCatalog(markdown) {
  if (typeof markdown !== 'string' || markdown.length > 500000) throw new Error('OCCURRENCE_CATALOG_SOURCE_INVALID');
  const sections = [...markdown.matchAll(/^###\s+([^\r\n]+?)\s*$/gm)].filter(match => /\(\d+ opções\)/.test(match[1]));
  const found = {};
  for (let index = 0; index < sections.length; index++) {
    const heading = sections[index][1];
    const match = heading.match(/^([A-Z0-9_À-Ú]+)\s+\((\d+) opções\)$/u);
    if (!match) throw new Error('OCCURRENCE_CATALOG_HEADING_INVALID');
    const [, key, countText] = match;
    const expected = OCCURRENCE_CATALOG_SPECS[key]?.count;
    if (!expected || Number(countText) !== expected || Object.hasOwn(found, key)) throw new Error('OCCURRENCE_CATALOG_HEADING_INVALID');
    const start = sections[index].index + sections[index][0].length;
    const end = sections[index + 1]?.index ?? markdown.length;
    const values = markdown.slice(start, end).split(/\r?\n/)
      .map(line => line.match(/^\s*\d+\.\s+(.*)$/)?.[1])
      .filter(value => value !== undefined);
    if (values.length !== expected || values.some(value => !value.trim() || value.length > 600)
      || new Set(values).size !== values.length) throw new Error('OCCURRENCE_CATALOG_CONTENT_INVALID');
    found[key] = values.map(value => value.trim());
  }
  const expectedKeys = Object.keys(OCCURRENCE_CATALOG_SPECS).sort();
  if (Object.keys(found).sort().join('\n') !== expectedKeys.join('\n')) throw new Error('OCCURRENCE_CATALOG_INCOMPLETE');
  return Object.freeze({schemaVersion: 1, catalogs: Object.freeze(found)});
}
