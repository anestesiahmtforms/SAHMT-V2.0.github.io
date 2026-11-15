import {escapeNoticeHtml as esc} from './communication-notice-text.js';
import {trainingIdFromAppLink} from './training-activity-route.js';
import {trainingFolderLevel, validTrainingFolderPath} from './html-training-folders.js';

const normalize = text => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR');

export const trainingPickerMarkup = `<details class="comm-training-picker" data-training-picker>
  <summary>Buscar treinamento no acervo</summary>
  <fieldset disabled>
    <label>Buscar por nome ou pasta<input type="search" data-training-search placeholder="Ex.: segurança"></label>
    <div data-training-results></div>
    <label>Link do treinamento no SAHMT<input type="text" data-training-link placeholder="Cole o link direto do treinamento"></label>
    <button type="button" data-use-training-link>Vincular pelo link</button>
    <p class="comm-note" data-training-feedback role="status"></p>
  </fieldset>
</details>`;

export function mountTrainingPicker(picker, onSelect) {
  const fields = picker.querySelector('fieldset');
  const search = picker.querySelector('[data-training-search]');
  const link = picker.querySelector('[data-training-link]');
  const feedback = picker.querySelector('[data-training-feedback]');
  const results = picker.querySelector('[data-training-results]');
  let catalog = [], path = [], folders = [];

  function render() {
    const query = normalize(search.value.trim());
    const level = trainingFolderLevel(catalog.filter(item => validTrainingFolderPath(item.folderPath)), path);
    folders = level.folders.filter(folder => folder.count > 0);
    const trainings = query
      ? catalog.filter(item => normalize([item.title, ...(item.folderPath || [])].join(' ')).includes(query))
        .sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'))
      : level.trainings;
    results.innerHTML = `<h3 tabindex="-1">${query ? 'Resultados no acervo' : esc(path.length ? path.join(' › ') : 'Gestão de Documentos')}</h3>
      ${!query && path.length ? '<button type="button" data-training-up>Voltar uma pasta</button>' : ''}
      ${query ? '' : folders.map(({name, count}, i) => `<button type="button" data-training-folder="${i}">Pasta: ${esc(name)} <span>(${count})</span></button>`).join('')}
      ${trainings.map(item => `<button type="button" data-pick-training="${esc(item.id)}">${esc(item.title)}
        ${query && item.folderPath ? `<small>${esc(item.folderPath.join(' › '))}</small>` : ''}</button>`).join('')}
      ${!trainings.length && (query || !folders.length) ? '<p class="comm-note">Nenhum treinamento publicado encontrado.</p>' : ''}`;
  }

  function select(id) {
    if (!catalog.some(item => item.id === id)) {
      feedback.textContent = 'Escolha um link direto de um treinamento publicado e disponível no acervo.';
      return;
    }
    picker.open = false;
    feedback.textContent = '';
    link.value = '';
    onSelect(id);
  }

  picker.addEventListener('input', event => {
    event.stopPropagation();
    if (event.target === search) render();
    if (event.target === link) feedback.textContent = '';
  });
  picker.addEventListener('change', event => event.stopPropagation());
  picker.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || ![search, link].includes(event.target)) return;
    event.preventDefault();
    if (event.target === link && !fields.disabled) select(trainingIdFromAppLink(link.value));
  });
  picker.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || fields.disabled) return;
    if (button.hasAttribute('data-use-training-link')) select(trainingIdFromAppLink(link.value));
    if (button.hasAttribute('data-pick-training')) select(button.dataset.pickTraining);
    if (button.hasAttribute('data-training-up') || button.hasAttribute('data-training-folder')) {
      path = button.hasAttribute('data-training-up') ? path.slice(0, -1) : folders[Number(button.dataset.trainingFolder)].path;
      render();
      results.querySelector('h3').focus();
    }
  });

  return {
    update(items) {
      catalog = items;
      path = [];
      feedback.textContent = '';
      render();
    },
    setDisabled(disabled) {
      fields.disabled = disabled;
    }
  };
}
