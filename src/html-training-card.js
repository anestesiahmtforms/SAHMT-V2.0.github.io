import {escapeHtml as h} from './html-training-model.js';
import {htmlTrainingActivityState} from './html-training-activity.js';
import {compactTrainingTitle} from './html-training-labels.js';

/** Presentation only: opening still goes through the authorized OPEN request. */
export function renderTrainingDocumentCard(training, {canManage = false, compact = false, activity = htmlTrainingActivityState(training)} = {}) {
  const published = training.status === 'PUBLISHED';
  const title = h(training.title || 'Documento');
  const label = compact?h(compactTrainingTitle(training.title || 'Documento')):title;
  const id = h(training.id);
  const meta = published ? `${Number(training.sectionCount) || 0} seções · 5 questões` : 'Rascunho · aguardando publicação';
  return `<article class="ht-card ht-document-card"><h3><button type="button" class="ht-document-folder" title="${title}" data-activity-state="${activity.color}" ${published ? `data-ht="open" data-id="${id}" aria-label="${title}" aria-description="${h(activity.label)}"` : 'disabled'}><span class="ht-document-paper" aria-hidden="true"><svg viewBox="0 0 32 40" fill="none"><path d="M5 2h14l8 8v28H5V2Z" fill="currentColor"/><path d="M19 2v9h8M10 18h12M10 24h12M10 30h8" stroke="#b59a64" stroke-width="2" stroke-linejoin="round"/></svg></span><span class="ht-document-face"><span class="ht-eyebrow">${h(training.category)}${training.subcategory ? ' · ' + h(training.subcategory) : ''}</span><span class="ht-document-title">${label}</span><span class="ht-document-status">${h(published?activity.label:meta)}</span><span class="ht-document-chevron" aria-hidden="true">${activity.complete?'✓':'↗'}</span></span></button></h3>${canManage ? `<div class="ht-card-actions"><button type="button" data-ht="edit" data-id="${id}" class="ht-secondary" aria-label="Editar treinamento: ${title}" title="Editar treinamento">${compact?'<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15v5Z"/></svg>':'Editar treinamento'}</button></div>` : ''}</article>`;
}
