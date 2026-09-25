const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const labelLine = /^(?:nome|pront(?:u[aá]rio)?|n\.?\s*pront|conv[eê]nio|n\.?\s*cirur|n\.?\s*atend|n\.?\s*guia|senha)\b/i;

function readAfterLabel(lines, expression, stopAtNextLabel = true) {
  const index = lines.findIndex((line) => expression.test(line));
  if (index < 0) return '';
  const current = clean(lines[index].replace(expression, ''));
  if (current) return current;
  for (const line of lines.slice(index + 1, index + 4)) {
    if (stopAtNextLabel && labelLine.test(line)) break;
    if (/\d{3,14}/.test(line)) return line.match(/\d{3,14}/)?.[0] || '';
    if (clean(line)) return clean(line);
  }
  return '';
}

function labelNumber(lines, expression) {
  const value = readAfterLabel(lines, expression, true);
  const digits = value.replace(/\D/g, '');
  return digits.length >= 3 && digits.length <= 14 ? digits : '';
}

export function extractLabelFields(text) {
  const lines = String(text || '').replace(/\r/g, '\n').split('\n').map(clean).filter(Boolean);
  const source = lines.join('\n');
  const nameMatch = source.match(/\bNome\s*:\s*([^\n]*?)(?=\s+Pront(?:u[aá]rio)?\s*[:#=-]|\s+N\.?\s*Pront\s*[:#=-]|$)/i);
  const insuranceMatch = source.match(/\bConv[eê]nio\s*:\s*([^\n]+)/i);
  const normalized = source.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const consultation = /consulta\s+pre[- ]anestesica/.test(normalized);
  const sadt = /\bn\.?\s*guia\b/.test(normalized) && /\bsenha\b/.test(normalized) && /\bconvenio\b/.test(normalized);
  const fields = {
    patientName: clean(nameMatch?.[1]).replace(/\b(?:pront(?:u[aá]rio)?|n\.?\s*pront)\b.*$/i, ''),
    insurance: clean(insuranceMatch?.[1]),
    procedureCode: labelNumber(lines, /\bn\.?\s*cirur(?:gia)?\b\s*[:#=-]?/i),
    encounterCode: labelNumber(lines, /\bn\.?\s*atend(?:imento)?\b\s*[:#=-]?/i),
    type: consultation ? 'Consulta Pré-anestésica' : sadt ? 'SADT' : '',
    creditor: consultation ? 'Caixa' : ''
  };
  if (consultation) {
    fields.insurance = '';
    fields.procedureCode = '';
  }
  if (sadt) fields.procedureCode = '';
  const required = consultation
    ? ['patientName', 'encounterCode']
    : ['patientName', 'encounterCode', ...(sadt ? ['insurance'] : ['procedureCode', 'insurance'])];
  fields.uncertain = required.filter((field) => !fields[field]);
  fields.status = 'CONFIRMACAO_NECESSARIA';
  return fields;
}

export async function prepareLabelImage(file) {
  if (!(file instanceof Blob) || !/^image\/(?:jpeg|png|webp)$/i.test(file.type)) {
    throw new Error('Selecione uma foto JPG, PNG ou WebP.');
  }
  if (file.size > 12 * 1024 * 1024) throw new Error('A imagem excede 12 MB. Escolha uma foto menor.');
  let bitmap;
  let temporaryUrl = '';
  try {
    let image;
    if (typeof createImageBitmap === 'function') {
      try { bitmap = await createImageBitmap(file, {imageOrientation: 'from-image'}); } catch { bitmap = await createImageBitmap(file); }
      image = bitmap;
    } else {
      temporaryUrl = URL.createObjectURL(file);
      image = document.createElement('img');
      image.src = temporaryUrl;
      if (typeof image.decode === 'function') await image.decode();
      else await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; });
    }
    const width = bitmap?.width || image.naturalWidth;
    const height = bitmap?.height || image.naturalHeight;
    const scale = Math.min(1, 2200 / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d', {alpha: false});
    if (!context) throw new Error('Não foi possível preparar a imagem neste aparelho.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    bitmap?.close();
    if (temporaryUrl) URL.revokeObjectURL(temporaryUrl);
  }
}

export function cropLabelImage(source, rect) {
  if (!source || !Number.isFinite(source.width) || !Number.isFinite(source.height)) {
    throw new Error('A foto ainda não está pronta para recorte.');
  }
  const left = Math.max(0, Math.min(1, Number(rect?.left) || 0));
  const top = Math.max(0, Math.min(1, Number(rect?.top) || 0));
  const right = Math.max(left, Math.min(1, left + (Number(rect?.width) || 0)));
  const bottom = Math.max(top, Math.min(1, top + (Number(rect?.height) || 0)));
  const x = Math.floor(left * source.width);
  const y = Math.floor(top * source.height);
  const width = Math.max(1, Math.ceil(right * source.width) - x);
  const height = Math.max(1, Math.ceil(bottom * source.height) - y);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', {alpha: false});
  if (!context) throw new Error('Não foi possível recortar a foto neste aparelho.');
  context.drawImage(source, x, y, width, height, 0, 0, width, height);
  return canvas;
}

export async function readLabelImage(canvas, onProgress = () => {}) {
  const {createWorker} = await import('tesseract.js');
  const ocrAssets = `${import.meta.env.BASE_URL}vendor/ocr/`;
  const worker = await createWorker('por', 1, {
    workerPath: `${ocrAssets}worker.min.js`,
    corePath: `${ocrAssets}core/`,
    langPath: `${ocrAssets}lang`,
    workerBlobURL: false,
    gzip: false,
    logger: (message) => onProgress(message)
  });
  try {
    await worker.setParameters({preserve_interword_spaces: '1'});
    const {data} = await worker.recognize(canvas);
    return extractLabelFields(data.text);
  } finally {
    await worker.terminate();
  }
}
