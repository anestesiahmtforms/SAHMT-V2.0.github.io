const IMPORT_COLUMNS = ['sigla', 'name', 'email', 'phone', 'active'];

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  const input = String(text || '').replace(/^\uFEFF/, '');
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') { value += '"'; index++; }
      else if (char === '"') quoted = false;
      else value += char;
      continue;
    }
    if (char === '"' && value === '') quoted = true;
    else if (char === ',') { row.push(value); value = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[index + 1] === '\n') index++;
      row.push(value); value = '';
      if (row.some((cell) => String(cell).trim())) rows.push(row);
      row = [];
    } else value += char;
  }
  if (quoted) throw new Error('O CSV contém uma célula com aspas sem fechamento.');
  if (value || row.length) { row.push(value); if (row.some((cell) => String(cell).trim())) rows.push(row); }
  return rows;
}

export function parseContactImportCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('O CSV não contém registros para importar.');
  const headers = rows[0].map((value) => String(value).trim().toLowerCase());
  if (headers.length !== IMPORT_COLUMNS.length || headers.some((header, index) => header !== IMPORT_COLUMNS[index])) {
    throw new Error('Use o CSV de contato preparado com as colunas sigla, name, email, phone e active, nesta ordem.');
  }
  const siglas = new Set();
  const emails = new Set();
  const records = rows.slice(1).map((cells, index) => {
    if (cells.length !== IMPORT_COLUMNS.length) throw new Error(`A linha ${index + 2} tem quantidade incorreta de colunas.`);
    const [rawSigla, rawName, rawEmail, rawPhone, rawActive] = cells.map((value) => String(value).trim());
    const sigla = rawSigla.toUpperCase();
    const name = rawName.slice(0, 120);
    const email = rawEmail.toLowerCase().slice(0, 200);
    const phone = rawPhone.slice(0, 40);
    if (!/^(?:[A-Z]{2}|L2)$/.test(sigla) || !name || !email || !/^\S+@\S+\.\S+$/.test(email) || !['true', 'false'].includes(rawActive.toLowerCase())) {
      throw new Error(`A linha ${index + 2} tem sigla, nome, e-mail ou situação inválida.`);
    }
    if (siglas.has(sigla)) throw new Error(`A sigla ${sigla} aparece mais de uma vez no CSV.`);
    if (emails.has(email)) throw new Error('O CSV contém e-mail duplicado.');
    siglas.add(sigla);
    emails.add(email);
    return {sigla, name, email, phone, active: rawActive.toLowerCase() === 'true'};
  });
  return records;
}

export function compareContactImportRows(records, currentContacts) {
  const bySigla = new Map(currentContacts.map((contact) => [String(contact.sigla || '').toUpperCase(), contact]));
  const missing = records.filter((record) => !bySigla.has(record.sigla)).map((record) => record.sigla);
  const changes = records.filter((record) => {
    const current = bySigla.get(record.sigla);
    return current && (String(current.name || '').trim() !== record.name ||
      String(current.email || '').trim().toLowerCase() !== record.email ||
      String(current.phone || '').trim() !== record.phone || current.active !== record.active);
  });
  return {matched: records.length - missing.length, missing, changes: changes.length, active: records.filter((record) => record.active).length, inactive: records.length - records.filter((record) => record.active).length};
}
