const collections = ['labels'];
const check = (value, code) => {if (!value) throw Error('FREEZE_' + code);};

// Blank comments and quoted literals without changing any source offset.
function codeMask(source) {
  let result = '', index = 0;
  while (index < source.length) {
    const start = index, first = source[index], second = source[index + 1];
    if (first === '/' && second === '/') {while (index < source.length && source[index] !== '\n') index++;}
    else if (first === '/' && second === '*') {
      index += 2; while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index++;
      check(index < source.length, 'COMMENT_UNTERMINATED'); index += 2;
    } else if (first === "'" || first === '"') {
      index++; let closed = false;
      while (index < source.length) {
        if (source[index] === '\\') {index += 2; continue;}
        if (source[index++] === first) {closed = true; break;}
      }
      check(closed, 'STRING_UNTERMINATED');
    } else {result += first; index++; continue;}
    result += source.slice(start, index).replace(/[^\r\n]/g, ' ');
  }
  return result;
}

export function buildFhSourceRulesFreeze(source) {
  check(typeof source === 'string' && source.length > 0 && source.length < 300000, 'SOURCE_INVALID');
  const mask = codeMask(source), matches = [];
  for (const entry of mask.matchAll(/\bmatch\s+(\/[A-Za-z0-9_{}=*\/.-]+)\s*\{/g)) {
    const opening = entry.index + entry[0].length - 1; let depth = 1, end = opening + 1;
    for (; end < mask.length && depth; end++) {if (mask[end] === '{') depth++; else if (mask[end] === '}') depth--;}
    check(depth === 0, 'BLOCK_UNBALANCED');
    matches.push({path: entry[1], start: entry.index, opening, end});
  }
  const databases = matches.filter(match => /^\/databases\/\{[^/{}]+\}\/documents$/.test(match.path));
  check(databases.length === 1, 'DATABASE_BLOCK_INVALID'); const database = databases[0];
  const inside = matches.filter(match => match.start > database.opening && match.end < database.end);
  const top = inside.filter(match => !inside.some(parent => parent !== match && parent.start < match.start && parent.end > match.end));
  const selected = [];
  for (const collection of collections) {
    const scoped = top.filter(match => match.path === '/' + collection || match.path.startsWith('/' + collection + '/'));
    check(scoped.length === 1 && new RegExp('^/' + collection + '/\\{[A-Za-z0-9_]+\\}$').test(scoped[0].path), 'MODULE_BLOCK_INVALID');
    selected.push({...scoped[0], collection});
  }
  const catalog=top.filter(match=>match.path==='/appConfig/labelStaff');
  check(catalog.length===1,'LABEL_CATALOG_BLOCK_INVALID');selected.push({...catalog[0],collection:'appConfig/labelStaff',literal:true});
  // An overlapping wildcard allow would override a deny in the retired block.
  for (const match of top.filter(match => !selected.some(value => value.start === match.start))) {
    if (match.path.startsWith('/{')) {
      const body = mask.slice(match.opening + 1, match.end - 1);
      for (const allow of body.matchAll(/\ballow\s+[^:;]+:\s*if\s*([^;]+);/g)) check(allow[1].trim() === 'false', 'OVERLAPPING_ALLOW');
      check(!/\ballow\b/.test(body.replace(/\ballow\s+[^:;]+:\s*if\s*false\s*;/g, '')), 'UNRECOGNIZED_ALLOW');
    }
  }
  let direct = mask.slice(database.opening + 1, database.end - 1);
  for (const match of [...top].sort((a, b) => b.start - a.start)) {
    const start = match.start - database.opening - 1, end = match.end - database.opening - 1;
    direct = direct.slice(0, start) + ' '.repeat(end - start) + direct.slice(end);
  }
  check(!/\ballow\b/.test(direct), 'DATABASE_WIDE_ALLOW');
  let content = '', cursor = 0; const replacements = [];
  for (const match of selected.sort((a, b) => a.start - b.start)) {
    content += source.slice(cursor, match.start);
    const preparedStart = content.length;
    content += match.literal ? 'match /appConfig/labelStaff { allow read, write: if false; }' : `match /${match.collection}/{fhDocument=**} { allow read, write: if false; }`;
    replacements.push({collection: match.collection, original: source.slice(match.start, match.end),
      originalStart: match.start, originalEnd: match.end, preparedStart, preparedEnd: content.length});
    cursor = match.end;
  }
  content += source.slice(cursor);
  return {content, replacements};
}
