/** Server-side publication validation. No browser DOM or third-party runtime. */
export function fail(code, status = 400) {
  const error = new Error(code); error.code = code; error.status = status; throw error;
}
export const copy = value => JSON.parse(JSON.stringify(value));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function identifier(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:@+-]{0,199}$/.test(value)) fail('INVALID_INPUT');
  return value;
}
export function text(value, max = 1000, optional = false) {
  if (typeof value !== 'string' || value.length > max || (!optional && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail('INVALID_INPUT');
  return value;
}
export function version(value) { if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_INPUT'); return value; }
export function documentSize(value, maximum = 800000) {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > maximum) fail('PAYLOAD_TOO_LARGE', 413);
}

const tags = new Set('p div span br hr h1 h2 h3 h4 h5 h6 strong b em i u s sub sup ul ol li blockquote pre code table caption thead tbody tfoot tr td th colgroup col img figure figcaption a section details summary'.split(' '));
const classes = new Set(['flow', 'branch', 'action', 'scroll', 'notice', 'source']);
const styles = new Set('color background-color font-size font-family font-weight font-style text-align text-decoration line-height margin margin-top margin-right margin-bottom margin-left padding padding-top padding-right padding-bottom padding-left border border-top border-right border-bottom border-left border-collapse border-spacing width height max-width vertical-align list-style-type white-space'.split(' '));

// Reject unknown markup instead of attempting regex-based sanitization. Every
// admitted attribute is interpreted by a small, closed grammar. In particular,
// no URL attribute other than an embedded raster image is admitted.
export function safeHtml(html) {
  text(html, 8000000, true);
  let at = 0;
  while (at < html.length) {
    const start = html.indexOf('<', at);
    if (start < 0) break;
    const token = /^<(\/)?([a-z][a-z0-9]*)(\s[^<>]*?)?\s*(\/?)>/i.exec(html.slice(start));
    if (!token || !tags.has(token[2].toLowerCase())) fail('UNSAFE_CONTENT');
    const tag = token[2].toLowerCase(), attrs = token[3] || '';
    if (token[1] && (attrs.trim() || token[4])) fail('UNSAFE_CONTENT');
    let remainder = attrs; const seen = new Set();
    while (remainder.trim()) {
      const attr = /^\s+([a-z][a-z0-9-]*)\s*=\s*(?:"([^"<>]*)"|'([^'<>]*)')/i.exec(remainder);
      if (!attr) fail('UNSAFE_CONTENT');
      const name = attr[1].toLowerCase(), value = attr[2] ?? attr[3];
      if (seen.has(name)) fail('UNSAFE_CONTENT'); seen.add(name);
      if (name === 'class') {
        if (!value.trim() || value.trim().split(/\s+/).some(token => !classes.has(token))) fail('UNSAFE_CONTENT');
      } else if (['title', 'alt', 'lang', 'dir'].includes(name)) {
        if (/[\u0000-\u001f]/.test(value) || (name === 'dir' && !['rtl', 'ltr', 'auto'].includes(value))) fail('UNSAFE_CONTENT');
      } else if (['colspan', 'rowspan', 'width', 'height', 'span', 'start'].includes(name)) {
        if (!/^\d{1,4}%?$/.test(value)) fail('UNSAFE_CONTENT');
      } else if (name === 'scope') {
        if (!['row', 'col', 'rowgroup', 'colgroup'].includes(value)) fail('UNSAFE_CONTENT');
      } else if (name === 'style') {
        if (/[&\\@{}<>]/.test(value) || /(?:url|expression|behavior|binding)\s*[:(]/i.test(value)) fail('UNSAFE_CONTENT');
        for (const declaration of value.split(';').filter(part => part.trim())) {
          const colon = declaration.indexOf(':');
          if (colon < 0 || !styles.has(declaration.slice(0, colon).trim().toLowerCase()) || !/^[a-z0-9\s#.,%()'"+\/-]+$/i.test(declaration.slice(colon + 1))) fail('UNSAFE_CONTENT');
        }
      } else if (name === 'src' && tag === 'img') {
        if (!/^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) fail('UNSAFE_CONTENT');
      } else fail('UNSAFE_CONTENT');
      remainder = remainder.slice(attr[0].length);
    }
    at = start + token[0].length;
  }
  return html;
}

function auditSchema(input, trainingId) {
  if (input == null) return null;
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Array.isArray(input.tests) || !input.tests.length || !Array.isArray(input.checks || [])) fail('INVALID_INPUT');
  if (input.trainingId && input.trainingId !== trainingId) fail('INVALID_INPUT');
  const all = [...input.tests, ...(input.checks || [])], codes = new Set();
  if (all.length > 150) fail('INVALID_INPUT');
  for (const item of all) { if (!object(item)) fail('INVALID_INPUT'); identifier(item.code); if (codes.has(item.code)) fail('INVALID_INPUT'); codes.add(item.code); }
  const normalized = { ...copy(input), trainingId, checks: copy(input.checks || []) };
  documentSize(normalized, 200000);
  return normalized;
}

export function publication(input) {
  const trainingId = identifier(input.trainingId), oldVersion = version(input.expectedVersion), metadata = input.training;
  if (!object(metadata) || metadata.source !== undefined && !object(metadata.source)) fail('INVALID_INPUT');
  const training = {
    id: trainingId, title: text(metadata.title), category: text(metadata.category, 150), subcategory: text(metadata.subcategory || '', 150, true),
    audienceGroup: metadata.audienceGroup, managerUid: metadata.managerUid === '' ? '' : identifier(metadata.managerUid), status: metadata.status,
    source: copy(metadata.source || {}),
  };
  if (!['GENERAL', 'RESTRICTED'].includes(training.audienceGroup) || !['DRAFT', 'PUBLISHED'].includes(training.status)) fail('INVALID_INPUT');
  documentSize(training.source, 20000);
  if (input.institutionalReviewConfirmed !== undefined && typeof input.institutionalReviewConfirmed !== 'boolean') fail('INVALID_INPUT');
  if (input.deferInstitutionalReview !== undefined && typeof input.deferInstitutionalReview !== 'boolean') fail('INVALID_INPUT');
  if (input.deferInstitutionalReview === true) text(input.reviewDeferralReason, 2000);
  if (training.source.pendingInstitutionalReview === true && training.status !== 'DRAFT' && input.institutionalReviewConfirmed !== true && input.deferInstitutionalReview !== true) fail('INSTITUTIONAL_REVIEW_REQUIRED');
  if (!Array.isArray(input.sections) || !input.sections.length || input.sections.length > 100) fail('INVALID_INPUT');
  const sections = input.sections.map(section => {
    if (!object(section)) fail('INVALID_INPUT');
    return { id: identifier(section.id), title: text(section.title, 1000, true), html: safeHtml(section.html) };
  });
  if (new Set(sections.map(s => s.id)).size !== sections.length) fail('INVALID_INPUT');
  documentSize(sections, 8000000);
  if (!Array.isArray(input.bank) || input.bank.length < 5 || input.bank.length > 500) fail('INVALID_INPUT');
  const bank = input.bank.map(question => {
    if (!object(question) || !Array.isArray(question.options) || question.options.length < 2 || question.options.length > 10) fail('INVALID_INPUT');
    const options = question.options.map(option => {
      if (!object(option)) fail('INVALID_INPUT');
      return { id: identifier(option.id), text: text(option.text, 10000) };
    });
    if (new Set(options.map(o => o.id)).size !== options.length || !options.some(o => o.id === question.correctOptionId) || typeof question.points !== 'number' || !Number.isFinite(question.points) || question.points <= 0 || question.points > 100) fail('INVALID_INPUT');
    return { id: identifier(question.id), stem: text(question.stem, 20000), options, correctOptionId: question.correctOptionId, points: question.points,
      ...(question.comment === undefined ? {} : { comment: text(question.comment, 20000, true) }) };
  });
  if (new Set(bank.map(q => q.id)).size !== bank.length) fail('INVALID_INPUT');
  const selected = input.selectedQuestionIds;
  if (!Array.isArray(selected) || selected.length !== 5 || new Set(selected).size !== 5 || selected.some(id => !bank.some(q => q.id === id))) fail('INVALID_INPUT');
  const schema = auditSchema(input.auditSchema, trainingId);
  const privateVersion = { bank, selectedQuestionIds: [...selected], auditSchema: schema };
  documentSize(privateVersion, 750000);
  return { training, sections, privateVersion, expectedVersion: oldVersion };
}
