const EQUIPMENT_STATUS = Object.freeze({
  OPERATIONAL: 'Operacional', MAINTENANCE: 'Em manutenção', OUT_OF_SERVICE: 'Fora de serviço', RETIRED: 'Retirado'
});
const MAINTENANCE_TYPE = Object.freeze({PREVENTIVE: 'Preventiva', CORRECTIVE: 'Corretiva', CALIBRATION: 'Calibração', INSPECTION: 'Inspeção'});

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));
}

function displayDate(value) {
  if (!value) return 'Sem prazo';
  const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? 'Data inválida' : new Intl.DateTimeFormat('pt-BR', {timeZone: 'America/Sao_Paulo'}).format(date);
}

export async function mountEquipmentManager(target, {managementAreaId, uid}) {
  if (!target || !managementAreaId || !uid) return;
  target.innerHTML = `<section class="equipment-manager"><header class="management-detail-heading"><div><p class="eyebrow">GESTÃO OPERACIONAL</p><h4>Equipamentos</h4></div><span id="equipment-count" class="record-meta"></span></header>
    <details class="quick-form" id="equipment-editor"><summary>Cadastrar equipamento</summary><form id="equipment-form"><input type="hidden" name="managementAreaId" value="${escapeHtml(managementAreaId)}"><input type="hidden" name="equipmentId"><input type="hidden" name="version" value="0"><div class="form-grid"><label>Patrimônio / etiqueta<input name="tag" required maxlength="40" pattern="[A-Za-z0-9_-]{2,40}" autocomplete="off"></label><label>Nome do equipamento<input name="name" required maxlength="160"></label><label>Categoria<input name="category" required maxlength="80"></label><label>Número de série<input name="serialNumber" maxlength="120"></label><label>Localização<input name="location" required maxlength="160"></label><label>UID responsável<input name="responsibleUid" required maxlength="128" value="${escapeHtml(uid)}"></label></div><div class="admin-user-actions"><button class="primary-button" type="submit">Salvar equipamento</button><button class="secondary-button" id="equipment-reset" type="button">Novo equipamento</button></div><p id="equipment-form-status" class="record-meta" role="status" aria-live="polite"></p></form></details>
    <div id="equipment-list" class="module-content"><p class="loading">Carregando equipamentos…</p></div><p id="equipment-status" class="record-meta" role="status" aria-live="polite"></p></section>`;

  const form = target.querySelector('#equipment-form');
  const list = target.querySelector('#equipment-list');
  const overallStatus = target.querySelector('#equipment-status');
  let equipment = [];
  let events = [];
  let maintenance = [];

  const refresh = async () => {
    list.innerHTML = '<p class="loading">Atualizando equipamentos e histórico…</p>';
    try {
      const data = await import('./data.js');
      [equipment, events, maintenance] = await Promise.all([
        data.listEquipmentForArea(managementAreaId),
        data.listEquipmentEventsForArea(managementAreaId),
        data.listMaintenanceRecordsForArea(managementAreaId)
      ]);
      if (!target.isConnected) return;
      target.querySelector('#equipment-count').textContent = `${equipment.length} item(ns)`;
      list.innerHTML = equipment.length ? `<ul class="record-list equipment-list">${equipment.map((item) => {
        const itemEvents = events.filter((event) => event.equipmentId === item.id);
        const itemMaintenance = maintenance.filter((record) => record.equipmentId === item.id);
        return `<li class="equipment-card"><div class="contact-list-heading"><div><strong>${escapeHtml(item.tag)} · ${escapeHtml(item.name)}</strong><small>${escapeHtml(item.category)}${item.serialNumber ? ` · Série ${escapeHtml(item.serialNumber)}` : ''}</small></div><button class="secondary-button" type="button" data-equipment-edit="${escapeHtml(item.id)}">Editar</button></div><small class="record-meta">${escapeHtml(item.location)} · ${escapeHtml(EQUIPMENT_STATUS[item.status] || item.status)} · ${item.active ? 'Ativo' : 'Inativo'} · responsável ${escapeHtml(item.responsibleUid)}</small>
          <div class="admin-user-actions">${item.status === 'RETIRED' ? '<small class="record-meta">Retirado do inventário</small>' : `<button class="secondary-button" type="button" data-equipment-active="${escapeHtml(item.id)}" data-active-next="${!item.active}" data-version="${item.version}">${item.active ? 'Desativar' : 'Reativar'}</button>`}</div>
          <details class="equipment-history"><summary>Eventos (${itemEvents.length}) · Manutenções (${itemMaintenance.length})</summary><div class="equipment-history-content"><section><h5>Histórico</h5>${itemEvents.length ? `<ul>${itemEvents.map((entry) => `<li><small>${displayDate(entry.createdAt)} · ${entry.type === 'STATUS_CHANGE' ? `${EQUIPMENT_STATUS[entry.fromStatus] || entry.fromStatus} → ${EQUIPMENT_STATUS[entry.toStatus] || entry.toStatus}` : 'Ocorrência'} · ${escapeHtml(entry.description)}</small></li>`).join('')}</ul>` : '<p class="empty-state">Sem eventos registrados.</p>'}</section><section><h5>Manutenções</h5>${itemMaintenance.length ? `<ul>${itemMaintenance.map((record) => `<li><strong>${escapeHtml(MAINTENANCE_TYPE[record.type] || record.type)}</strong><small>${escapeHtml(record.description)} · ${record.status === 'COMPLETED' ? 'Concluída' : record.status === 'IN_PROGRESS' ? 'Em andamento' : 'Aberta'} · ${displayDate(record.dueAt)} · responsável ${escapeHtml(record.responsibleUid)}</small>${record.status === 'OPEN' ? `<button class="secondary-button" type="button" data-maintenance-id="${escapeHtml(record.id)}" data-maintenance-next="IN_PROGRESS">Iniciar</button>` : record.status === 'IN_PROGRESS' ? `<button class="secondary-button" type="button" data-maintenance-id="${escapeHtml(record.id)}" data-maintenance-next="COMPLETED">Concluir</button>` : ''}</li>`).join('')}</ul>` : '<p class="empty-state">Sem manutenções registradas.</p>'}</section></div>
          ${item.active ? `<div class="equipment-actions-grid"><form class="equipment-event-form" data-equipment-event="${escapeHtml(item.id)}"><h5>Registrar evento</h5><label>Tipo<select name="type"><option value="INCIDENT">Ocorrência</option><option value="STATUS_CHANGE">Alteração de situação</option></select></label><label data-equipment-description>Descrição<textarea name="description" rows="2" required maxlength="1000"></textarea></label><label data-equipment-status-field hidden>Nova situação<select name="toStatus"><option value="OPERATIONAL">Operacional</option><option value="MAINTENANCE">Em manutenção</option><option value="OUT_OF_SERVICE">Fora de serviço</option><option value="RETIRED">Retirado</option></select></label><button class="secondary-button" type="submit">Registrar evento</button><small class="record-meta" role="status"></small></form>
          <form class="equipment-maintenance-form" data-equipment-maintenance="${escapeHtml(item.id)}"><h5>Agendar manutenção</h5><label>Tipo<select name="type"><option value="PREVENTIVE">Preventiva</option><option value="CORRECTIVE">Corretiva</option><option value="CALIBRATION">Calibração</option><option value="INSPECTION">Inspeção</option></select></label><label>Descrição<textarea name="description" rows="2" required maxlength="1000"></textarea></label><label>Prazo<input name="dueAt" type="date"></label><label>UID responsável<input name="responsibleUid" required maxlength="128" value="${escapeHtml(uid)}"></label><button class="secondary-button" type="submit">Criar manutenção</button><small class="record-meta" role="status"></small></form></div>` : '<p class="sync-state">Equipamento inativo: histórico preservado e novos registros suspensos.</p>'}</details></li>`;
      }).join('')}</ul>` : '<p class="empty-state">Nenhum equipamento cadastrado nesta área.</p>';
      if (events.length >= 100 || maintenance.length >= 100) list.insertAdjacentHTML('afterbegin', '<p class="sync-state">O histórico mais antigo pode não aparecer nesta lista.</p>');
      bindLists();
    } catch (error) {
      if (target.isConnected) list.innerHTML = `<p class="empty-state">Não foi possível carregar equipamentos. ${escapeHtml(error.message || '')}</p>`;
    }
  };

  const resetForm = () => {
    form.reset();
    form.elements.managementAreaId.value = managementAreaId;
    form.elements.equipmentId.value = '';
    form.elements.version.value = '0';
    form.elements.responsibleUid.value = uid;
    form.elements.tag.readOnly = false;
    form.dataset.mutationId = '';
    target.querySelector('#equipment-editor').open = false;
  };
  target.querySelector('#equipment-reset').addEventListener('click', resetForm);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    const status = form.querySelector('#equipment-form-status');
    button.disabled = true;
    if (status) status.textContent = 'Salvando cadastro…';
    try {
      const {saveEquipment} = await import('./data.js');
      const values = Object.fromEntries(new FormData(form).entries());
      values.equipmentId = values.equipmentId || (form.dataset.mutationId ||= values.tag.trim().toUpperCase());
      await saveEquipment(values, uid);
      resetForm();
      if (overallStatus) overallStatus.textContent = 'Equipamento salvo.';
      await refresh();
    } catch (error) {
      button.disabled = false;
      if (status) status.textContent = error.message || 'Não foi possível salvar o equipamento.';
    }
  });

  function bindLists() {
    list.querySelectorAll('[data-equipment-edit]').forEach((button) => button.addEventListener('click', () => {
      const item = equipment.find((entry) => entry.id === button.dataset.equipmentEdit);
      if (!item) return;
      form.elements.equipmentId.value = item.id;
      form.elements.version.value = String(item.version);
      for (const field of ['managementAreaId', 'tag', 'name', 'category', 'serialNumber', 'location', 'responsibleUid']) form.elements[field].value = item[field] || '';
      form.elements.tag.readOnly = true;
      target.querySelector('#equipment-editor').open = true;
      form.scrollIntoView({behavior: 'smooth', block: 'center'});
      form.elements.name.focus({preventScroll: true});
    }));
    list.querySelectorAll('[data-equipment-active]').forEach((button) => button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const {setEquipmentActive} = await import('./data.js');
        await setEquipmentActive(button.dataset.equipmentActive, button.dataset.activeNext === 'true', Number(button.dataset.version), uid);
        await refresh();
      } catch (error) {
        button.disabled = false;
        if (overallStatus) overallStatus.textContent = error.message || 'Não foi possível alterar o estado do equipamento.';
      }
    }));
    list.querySelectorAll('[data-equipment-event]').forEach((eventForm) => {
      const type = eventForm.elements.type;
      const statusField = eventForm.querySelector('[data-equipment-status-field]');
      type.addEventListener('change', () => { statusField.hidden = type.value !== 'STATUS_CHANGE'; });
      eventForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = eventForm.querySelector('[type="submit"]');
        const status = eventForm.querySelector('[role="status"]');
        button.disabled = true;
        try {
          const {recordEquipmentEvent} = await import('./data.js');
          eventForm.dataset.eventId ||= crypto.randomUUID();
          await recordEquipmentEvent({eventId: eventForm.dataset.eventId, equipmentId: eventForm.dataset.equipmentEvent, type: type.value, description: eventForm.elements.description.value, toStatus: eventForm.elements.toStatus.value}, uid);
          if (overallStatus) overallStatus.textContent = 'Evento registrado no histórico.';
          await refresh();
        } catch (error) {
          button.disabled = false;
          if (status) status.textContent = error.message || 'Não foi possível registrar o evento.';
        }
      });
    });
    list.querySelectorAll('[data-equipment-maintenance]').forEach((maintenanceForm) => maintenanceForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = maintenanceForm.querySelector('[type="submit"]');
      const status = maintenanceForm.querySelector('[role="status"]');
      button.disabled = true;
      try {
        const {createMaintenanceRecord} = await import('./data.js');
        maintenanceForm.dataset.recordId ||= crypto.randomUUID();
        await createMaintenanceRecord({recordId: maintenanceForm.dataset.recordId, equipmentId: maintenanceForm.dataset.equipmentMaintenance, ...Object.fromEntries(new FormData(maintenanceForm).entries())}, uid);
        if (overallStatus) overallStatus.textContent = 'Manutenção criada.';
        await refresh();
      } catch (error) {
        button.disabled = false;
        if (status) status.textContent = error.message || 'Não foi possível criar a manutenção.';
      }
    }));
    list.querySelectorAll('[data-maintenance-id]').forEach((button) => button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const {transitionMaintenanceRecord} = await import('./data.js');
        await transitionMaintenanceRecord(button.dataset.maintenanceId, button.dataset.maintenanceNext, uid);
        await refresh();
      } catch (error) {
        button.disabled = false;
        if (overallStatus) overallStatus.textContent = error.message || 'Não foi possível atualizar a manutenção.';
      }
    }));
  }

  await refresh();
}
