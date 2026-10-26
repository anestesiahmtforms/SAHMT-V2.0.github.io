import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import parse5 from 'parse5';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const footer = value => value.replace(/\nSAHMT\s*\|[\s\S]*$/i, '').trim();

function validateBank(bank, expectedCount) {
  if (!bank.length || bank.length !== expectedCount) throw new Error(`Question count mismatch: expected ${expectedCount}, parsed ${bank.length}`);
  if (new Set(bank.map(q => q.id)).size !== bank.length) throw new Error('Duplicate question source codes');
  for (const q of bank) {
    if (!q.id || !q.stem || !Number.isFinite(q.points) || q.points <= 0 || q.options.length !== 4 || new Set(q.options.map(o => o.id)).size !== 4 || q.options.some(o => !o.text)) throw new Error(`Incomplete question: ${q.id}`);
    if (!q.correctOptionId || !q.options.some(o => o.id === q.correctOptionId)) throw new Error(`Missing or ambiguous answer/gabarito: ${q.id}`);
  }
  return bank;
}

export function parseQuestionBank(input, { documentId, expectedCount }) {
  const text = input.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ')
    .replace(/^(Código da questão|Pergunta|Descrição|Pontos)[ \t]*\|[ \t]*(.*)$/gm, '$1\n$2')
    .replace(/^Opção[ \t]*\|[ \t]*Texto[ \t]*\|[ \t]*Gabarito[ \t]*$/gm, 'Opção\nTexto\nGabarito')
    .replace(/^([A-D])[ \t]*\|[ \t]*(.*?)[ \t]*\|[ \t]*(RESPOSTA CORRETA)?[ \t]*$/gm, '$1\n$2\n$3');
  const bank = [];
  if (/Código da questão\s*\n/i.test(text)) {
    const blocks = text.split(/^\s*Questão\s+\d+\s*$/im).slice(1);
    for (const raw of blocks) {
      const block = footer(raw);
      const metadata = block.match(/Código da questão\s*\n([^\n]+)\s*\nPergunta\s*\n([\s\S]*?)\nDescrição\s*\n([\s\S]*?)\nPontos\s*\n\s*([\d.,]+)/i);
      if (!metadata) throw new Error('Unparsed native bank metadata');
      const optionBody = block.match(/(?:^|\n)Opção\s*\nTexto\s*\nGabarito\s*\n([\s\S]*)/i)?.[1];
      const options = []; const keys = [];
      for (const match of (optionBody || '').matchAll(/(?:^|\n)([A-D])\s*\n([\s\S]*?)(?=\n[A-D]\s*\n|$)/g)) {
        if (/RESPOSTA CORRETA/i.test(match[2])) keys.push(match[1]);
        options.push({ id: match[1], text: clean(match[2].replace(/RESPOSTA CORRETA/ig, '')) });
      }
      const q = { id: clean(metadata[1]), stem: clean(metadata[2]), options, correctOptionId: keys.length === 1 ? keys[0] : '', points: Number(metadata[4].replace(',', '.')) };
      if (clean(metadata[3])) q.comment = clean(metadata[3]);
      bank.push(q);
    }
  } else if (/Código:\s*[\w-]+\s*\|\s*Valor:/i.test(text)) {
    for (const block of text.split(/(?:^|\n)\s*\d{2}\.\s+/).slice(1)) {
      const m = footer(block).match(/^([\s\S]*?)Código:\s*([\w-]+)\s*\|\s*Valor:\s*([\d.,]+)\s*pontos?\s+([\s\S]*?)Gabarito:\s*([A-D])\s+Justificativa:\s*([\s\S]*)$/i);
      if (!m) throw new Error('Unparsed exported bank question');
      const options = [...m[4].matchAll(/(?:^|\s)([A-D])\)\s*([\s\S]*?)(?=\s[A-D]\)\s|$)/g)].map(x => ({ id: x[1], text: clean(x[2]) }));
      bank.push({ id: m[2], stem: clean(m[1]), options, correctOptionId: m[5].toUpperCase(), points: Number(m[3].replace(',', '.')), comment: clean(m[6]) });
    }
  } else {
    const split = text.split(/^\s*GABARITO(?:\s+COMENTADO)?\s*:?\s*$/im);
    if (split.length !== 2) throw new Error('Missing unique final answer/gabarito table');
    const answers = new Map([...split[1].matchAll(/(?:^|\n|\|)\s*(\d+)(?:[.)\-]\s*|\s+)([A-D])\b([^\n|]*)/gi)].map(m => [Number(m[1]), { key: m[2].toUpperCase(), comment: clean(m[3].replace(/^\s*[—–:\-]\s*/, '')) }]));
    for (const explanation of split[1].matchAll(/(?:^|\n)\s*(\d+)\s+Alternativa\s+([A-D])\s+([\s\S]*?)(?=\n\s*\d+\s+Alternativa\s+[A-D]|$)/gi)) {
      const answer = answers.get(Number(explanation[1]));
      if (!answer || answer.key !== explanation[2].toUpperCase()) throw new Error('Conflicting commented answer/gabarito');
      answer.comment = clean(explanation[3]);
    }
    const heads = [...split[0].matchAll(/^\s*(?:Questão\s+(\d+)\s*\n|(\d+)[.)]\s+)([\s\S]*?)(?=^\s*(?:Questão\s+\d+\s*$|\d+[.)]\s+)|$(?![\s\S]))/gim)];
    for (const m of heads) {
      const n = Number(m[1] || m[2]); const body = m[3];
      const first = body.search(/(?:^|\n)\s*[a-d]\)\s+/i);
      if (first < 0) throw new Error(`Unparsed question options: ${n}`);
      const options = [...body.slice(first).matchAll(/(?:^|\n)\s*([a-d])\)\s*([\s\S]*?)(?=\n\s*[a-d]\)\s+|$)/gi)].map(x => ({ id: x[1].toUpperCase(), text: clean(x[2]) }));
      const q = { id: `${documentId}-q${String(n).padStart(2, '0')}`, stem: clean(body.slice(0, first)), options, correctOptionId: answers.get(n)?.key || '', points: 1 };
      if (answers.get(n)?.comment) q.comment = answers.get(n).comment;
      bank.push(q);
    }
    if (answers.size !== bank.length) throw new Error('Answer/gabarito count does not match questions');
  }
  return validateBank(bank, expectedCount);
}

const tags = new Set('p h1 h2 h3 h4 h5 h6 div section span table thead tbody tfoot tr td th caption colgroup col br hr details summary figure figcaption img strong em b i u s sup sub ul ol li blockquote pre code abbr'.split(' '));
const drop = new Set('script style iframe object embed form input select button textarea nav header footer link meta svg math template audio video canvas'.split(' '));
const textContent = node => node.nodeName === '#text' ? node.value : (node.childNodes || []).map(textContent).join(' ');
const attr = (node, name) => node.attrs?.find(a => a.name === name)?.value;
const inside = (root, file) => { const rel = path.relative(root, file); return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel); };

export async function convertStudyHtml(html, { htmlPath, auditRoot }) {
  const document = parse5.parse(html); const articles = [];
  function locate(node) { if (node.tagName === 'article' && (attr(node, 'class') || '').split(/\s+/).includes('source-body')) articles.push(node); for (const child of node.childNodes || []) locate(child); }
  locate(document);
  if (articles.length !== 1) throw new Error('Expected exactly one study source-body article');
  const realRoot = await fs.realpath(auditRoot); const assets = new Map();
  async function sanitize(node) {
    if (node.nodeName === '#text') { node.value = node.value.replace(/https?:\/\/(?:docs|drive)\.google\.com\/[^\s<>]+/gi, '[referência institucional]'); return [node]; }
    if (!node.tagName || drop.has(node.tagName)) return [];
    const children = (await Promise.all((node.childNodes || []).map(sanitize))).flat();
    if (!tags.has(node.tagName)) return children;
    const attrs = [];
    for (const a of node.attrs || []) {
      if (['alt', 'title', 'scope', 'colspan', 'rowspan'].includes(a.name)) attrs.push(a);
      if (a.name === 'class') { const value = a.value.split(/\s+/).filter(c => ['flow', 'branch', 'action', 'scroll', 'notice', 'source'].includes(c)).join(' '); if (value) attrs.push({ name: 'class', value }); }
      if (['width', 'height', 'span', 'start'].includes(a.name) && /^\d{1,5}$/.test(a.value)) attrs.push(a);
    }
    if (node.tagName === 'img') {
      const source = attr(node, 'src');
      if (!source || /^(?:[a-z]+:|[/\\])|[?#]/i.test(source)) throw new Error('Remote or unsupported image source');
      const resolved = path.resolve(path.dirname(htmlPath), decodeURIComponent(source));
      if (!inside(realRoot, resolved)) throw new Error('Image escapes private audit scope');
      const realFile = await fs.realpath(resolved);
      if (!inside(realRoot, realFile)) throw new Error('Image realpath escapes private audit scope');
      const data = await fs.readFile(realFile);
      // Some audited files have a .png name with JPEG bytes; trust the signature.
      const mime = data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ? 'image/png'
        : data[0] === 255 && data[1] === 216 ? 'image/jpeg'
          : /^GIF8[79]a$/.test(data.subarray(0, 6).toString()) ? 'image/gif'
            : data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP' ? 'image/webp' : null;
      if (!mime) throw new Error(`Invalid or unsupported image: ${path.basename(realFile)}`);
      attrs.push({ name: 'src', value: `data:${mime};base64,${data.toString('base64')}` });
      assets.set(realFile, { path: path.relative(realRoot, realFile).replaceAll(path.sep, '/'), sha256: sha256(data), bytes: data.length });
    }
    node.attrs = attrs; node.childNodes = children; children.forEach(c => { c.parentNode = node; }); return [node];
  }
  const nodes = (await Promise.all(articles[0].childNodes.map(sanitize))).flat();
  const groups = []; let group = { title: 'Introdução', nodes: [] };
  for (const node of nodes) {
    if (node.tagName === 'h2') {
      if (group.nodes.some(n => n.tagName || clean(textContent(n)))) groups.push(group);
      group = { title: clean(textContent(node)), nodes: [] };
    }
    group.nodes.push(node);
  }
  if (group.nodes.some(n => n.tagName || clean(textContent(n)))) groups.push(group);
  if (!groups.length) throw new Error('Study article is empty');
  const sections = groups.map((g, n) => ({ id: `section-${String(n + 1).padStart(3, '0')}`, title: g.title || `Leitura ${n + 1}`, html: parse5.serialize({ nodeName: '#document-fragment', childNodes: g.nodes }).trim() }));
  if (/RESPOSTA CORRETA|correctOptionId|answerKey/i.test(sections.map(s => s.html).join(''))) throw new Error('Answer key marker leaked into study HTML');
  return { sections, assets: [...assets.values()].sort((a, b) => a.path.localeCompare(b.path)) };
}

export function selectQuestionIds(bank, trainingId) {
  if (bank.length < 5 || new Set(bank.map(q => q.id)).size !== bank.length) throw new Error('At least five unique bank questions required');
  return bank.map(q => ({ id: q.id, rank: sha256(`${trainingId}\n${q.id}`) })).sort((a, b) => a.rank.localeCompare(b.rank) || a.id.localeCompare(b.id)).slice(0, 5).map(q => q.id);
}

export function createTrainingRecord({ topic, bank, sections, auditSchema = null, pending = [], documentRevisionId, questionRevisionId, auditRevisionId }) {
  if (!topic.texto_id || !topic.banco_id || !topic.pasta_id || !topic.tema || !sections?.length) throw new Error('Missing official topic/source mapping or study sections');
  const trainingId = auditSchema?.trainingId || `html-${topic.texto_id}`;
  const source = { folderId: topic.pasta_id, documentId: topic.texto_id, questionDocumentId: topic.banco_id };
  if (topic.auditoria_id) source.auditDocumentId = topic.auditoria_id;
  for (const [key, value] of Object.entries({ documentRevisionId, questionRevisionId, auditRevisionId })) if (value) source[key] = value;
  source.revisions = {};
  for (const [key, value] of Object.entries({ document: documentRevisionId, questions: questionRevisionId, audit: auditRevisionId })) if (value) source.revisions[key] = value;
  source.pendingInstitutionalReview = Boolean(topic.rop || pending.some(p => p.code === 'SOURCE_REVIEW_REQUIRED'));
  const pendingItems = [{ code: 'MANAGER_ASSIGNMENT_REQUIRED', message: 'Designar o gestor responsável antes de publicar.' }, ...pending];
  if (topic.rop) pendingItems.push({ code: 'INSTITUTIONAL_REVIEW_REQUIRED', message: 'Validar os enunciados e testes com o manual institucional contratado antes da publicação.' });
  return { trainingId, training: { title: topic.tema, category: topic.rop ? 'ROPs' : topic.area === 'Administrativos' ? 'Documentos administrativos' : topic.area, subcategory: topic.subarea || '', audienceGroup: topic.area === 'Administrativos' ? 'RESTRICTED' : 'GENERAL', managerUid: '', status: 'DRAFT', source }, sections, bank, selectedQuestionIds: selectQuestionIds(bank, trainingId), auditSchema: auditSchema ? { ...structuredClone(auditSchema), trainingId } : null, pending: pendingItems };
}

export function assertPrivateOutput(workspaceRoot, output) {
  if (path.resolve(output) !== path.resolve(workspaceRoot, '.local-preview/html-training-import')) throw new Error('Import output must be the private .local-preview/html-training-import folder');
}
