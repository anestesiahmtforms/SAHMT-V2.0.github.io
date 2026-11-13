import {deviceUpdateState, recoveryUrl, updateRequest, deviceInstallationLabel, devicePublishedState} from './app-updates-targeted.js';
import {requestUpdatesForUsers} from './app-updates-targeted-batch.js';
import {deviceVersionLabel} from './app-version.js';
import {mergeMemberCategoryAssignments} from './member-categories.js';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const memberGroups = [
  ['EFETIVO', 'Efetivos'],
  ['RESIDENTE_1', 'Residentes R1'],
  ['RESIDENTE_2', 'Residentes R2'],
  ['RESIDENTE_3', 'Residentes R3'],
  ['SUBSTITUTO', 'Substitutos'],
  ['other', 'Sem grupo funcional'],
];
const names = new Intl.Collator('pt-BR', {sensitivity: 'base'});
const accessDate = new Intl.DateTimeFormat('pt-BR', {day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo'});
const userName = user => String(user.displayName || '').trim();
const searchText = value => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');
function lastAccess(device) {
  const value = device.lastSeenAt;
  const milliseconds = value?.toMillis?.() ?? value?.toDate?.()?.getTime() ?? value;
  return Number.isFinite(milliseconds) && milliseconds > 0 && milliseconds <= 8.64e15 ? milliseconds : 0;
}
const accessLabel = milliseconds => milliseconds ? accessDate.format(milliseconds) : 'Sem acesso registrado';

export async function latestAppRelease(target, {fetchImpl = fetch, origin = location.origin} = {}) {
  const response = await fetchImpl(origin + '/SAHMT-V2.0.github.io/tools/app-release.json?t=' + Date.now(), {cache: 'no-store', redirect: 'error'});
  if (!response.ok) throw Error('APP_UPDATE_VERSION_UNAVAILABLE');
  const data = await response.json(), release = data.targets?.[target];
  if (data.schema !== 1 || !Number.isSafeInteger(release) || release <= 0) throw Error('APP_UPDATE_VERSION_INVALID');
  return release;
}
export async function openUserAppUpdates({actorUid, profile, target, isCurrent,
  root = document, services, readRelease = latestAppRelease}) {
  const data = services || await import('./fi-admin-data.js');
  if (!isCurrent()) return () => {};
  const dialog = root.createElement('dialog'); dialog.className = 'admin-app-updates';
  dialog.setAttribute('aria-labelledby', 'admin-app-updates-title');
  dialog.innerHTML = `<header><h2 id="admin-app-updates-title">ATUALIZAÇÃO POR APARELHO</h2><p>${escape(profile.displayName || profile.email || profile.uid)}</p></header><section><p>A exigência vale somente para esta pessoa neste app (${escape(target)}), na próxima abertura. Cada aparelho confirma separadamente. Um formulário em uso continua aberto.</p><p data-request-state></p><div class="admin-user-actions"><button type="button" class="primary-button" data-request-update>EXIGIR VERSÃO ATUAL</button><button type="button" class="secondary-button" data-cancel-update>CANCELAR EXIGÊNCIA</button></div><p data-admin-update-status role="status" aria-live="polite"></p><h3>Aparelhos conhecidos</h3><p>Confirmação informa a versão realmente aberta neste navegador. Aparelhos sem este controle só aparecem depois da primeira conexão atualizada. Um aparelho confirmado não confirma os demais.</p><div data-device-list></div><button type="button" class="secondary-button" data-refresh-devices>CONFERIR CONFIRMAÇÕES</button><h3>Primeira atualização de um Android antigo</h3><p>Se o aparelho ficou preso na versão antiga, abra este link nele uma vez, no navegador usado pelo app. Depois, reabra o app instalado. A sessão e os dados salvos são preservados. No iPhone instalado, prefira “Atualizar agora” ou a opção de reparar dentro do próprio app: o Safari pode manter uma instalação separada.</p><label>Link de recuperação<input readonly data-recovery-link value="${escape(recoveryUrl(target))}"></label><button type="button" class="secondary-button" data-copy-recovery>COPIAR LINK</button></section><footer><button type="button" class="secondary-button" data-close-updates>VOLTAR</button></footer>`;
  let closed = false, busy = false, loadId = 0,stopDevices=()=>{};
  const close = () => {closed = true; loadId++;stopDevices(); dialog.close(); dialog.remove();};
  const current = () => !closed && isCurrent();
  const status = dialog.querySelector('[data-admin-update-status]');
  const buttons = [...dialog.querySelectorAll('[data-request-update],[data-cancel-update],[data-refresh-devices]')];
  const run = async operation => {
    if (busy || !current()) return;
    busy = true; buttons.forEach(button => {button.disabled = true;});
    status.textContent = 'Consultando o servidor…';
    try {await operation();}
    catch {if (current()) status.textContent = 'Não foi possível confirmar a operação. Confira a conexão e o acesso de administrador e tente novamente.';}
    finally {busy = false; if (current()) buttons.forEach(button => {button.disabled = false;}); else if (!closed) close();}
  };
  const refresh = async () => {
    const sequence = ++loadId;
    const [snapshot,publishedRelease]=await Promise.all([data.readUserAppUpdates(actorUid,profile.uid),readRelease(target).catch(()=>null)]);
    if (!current()) {close(); return;} if (sequence !== loadId) return;
    const request = updateRequest(snapshot.request, target);
    dialog.querySelector('[data-request-state]').textContent = request ? 'Exigência ativa · versão mínima ' + request.minimumRelease : 'Nenhuma exigência ativa para esta pessoa.';
    const paintDevices=devices=>{if(!current()){close();return;}if(sequence!==loadId)return;dialog.querySelector('[data-device-list]').innerHTML = devices.filter(device => device.target === target).map(device => {
      return `<article class="app-device-row"><strong>${escape(device.platform)} · ${escape(deviceInstallationLabel(device))} · ${escape(device.deviceId.slice(0, 8))}</strong><span>${escape(deviceVersionLabel(device))} · compilação ${escape(device.loadedRelease)} · ${escape(devicePublishedState(device,publishedRelease))}</span>${request ? `<small>Solicitação: ${deviceUpdateState(device,request)}</small>` : '<small>Versão recebida registrada, mesmo sem exigência ativa.</small>'}<small>Último acesso: ${escape(accessLabel(lastAccess(device)))}</small></article>`;
    }).join('') || '<p>Nenhum aparelho confirmou conexão com este controle. Use o link de recuperação no aparelho antigo.</p>';};
    paintDevices(snapshot.devices);stopDevices();stopDevices=data.watchAppInstallations?.(actorUid,profile.uid,paintDevices,()=>{if(current())status.textContent='Acompanhamento interrompido. Use CONFERIR CONFIRMAÇÕES para tentar novamente.';else close();})||(()=>{});
    status.textContent = 'Consulta confirmada no servidor.';
  };
  dialog.querySelector('[data-request-update]').onclick = () => run(async () => {
    const release = await readRelease(target);
    if (!current()) return;
    await data.requestUserAppUpdate(actorUid, profile.uid, release); await refresh();
  });
  dialog.querySelector('[data-cancel-update]').onclick = () => run(async () => {await data.cancelUserAppUpdate(actorUid, profile.uid); await refresh();});
  dialog.querySelector('[data-refresh-devices]').onclick = () => run(refresh);
  dialog.querySelector('[data-copy-recovery]').onclick = async () => {
    const input = dialog.querySelector('[data-recovery-link]');
    try {await navigator.clipboard.writeText(input.value); if (current()) status.textContent = 'Link copiado. Abra no aparelho que precisa atualizar.';}
    catch {input.focus(); input.select(); status.textContent = 'Selecione e copie o link acima.';}
  };
  dialog.querySelector('[data-close-updates]').onclick = close;
  dialog.addEventListener('cancel', event => {event.preventDefault(); close();});
  root.body.append(dialog); dialog.showModal(); await run(refresh);
  return close;
}

export async function openAllAppUpdates({actorUid, target, isCurrent, root = document, services, readRelease = latestAppRelease}) {
  const data = services || await import('./fi-admin-data.js');
  if (!isCurrent()) return () => {};
  const dialog = root.createElement('dialog'); dialog.className = 'admin-app-updates';
  dialog.setAttribute('aria-labelledby', 'all-app-updates-title');
  dialog.innerHTML = '<h2 id="all-app-updates-title">ATUALIZAÇÃO PARA TODOS</h2><p>A exigência será registrada para todos os usuários com acesso ativo neste app. Cada aparelho deverá confirmar a versão na próxima abertura. Formulários em uso continuam abertos.</p><p data-all-preview role="status">Conferindo os usuários e a versão publicada…</p><p>Para consultar confirmações ou tratar um caso específico, use “Atualização do aparelho” no perfil da pessoa.</p><button type="button" class="primary-button" data-all-send disabled>EXIGIR ATUALIZAÇÃO PARA TODOS</button><p data-all-status role="status" aria-live="polite"></p><footer><button type="button" class="secondary-button" data-all-close>VOLTAR</button></footer>';
  let closed = false, sending = false, completed = false;
  const close = () => {if (sending) return; closed = true; dialog.close(); dialog.remove();};
  const current = () => !closed && isCurrent();
  dialog.querySelector('[data-all-close]').onclick = close;
  dialog.addEventListener('cancel', event => {event.preventDefault(); close();});
  root.body.append(dialog); dialog.showModal();
  const status = dialog.querySelector('[data-all-status]'), button = dialog.querySelector('[data-all-send]');
  try {
    const [users, release] = await Promise.all([data.listAppUpdateUsers(actorUid), readRelease(target)]);
    if (!current()) {close(); return close;}
    dialog.querySelector('[data-all-preview]').textContent = users.length + ' usuário(s) com acesso ativo · versão mínima ' + release + ' · app ' + target + '.';
    button.disabled = !users.length;
    button.onclick = async () => {
      if (sending || completed || !current()) return;
      sending = true; button.disabled = true; dialog.querySelector('[data-all-close]').disabled = true;
      try {
        const result = await requestUpdatesForUsers({users, release, isCurrent: current,
          sendBatch: (uids, version) => data.sendAppUpdateBatch(actorUid, uids, version),
          onProgress: ({sent, total}) => {if (current()) status.textContent = sent + ' de ' + total + ' solicitações confirmadas no servidor.';}
        });
        completed = true;
        if (current()) status.textContent = 'Exigência registrada para ' + result.sent + ' usuário(s). Aguardando a confirmação individual de cada aparelho.';
      } catch (error) {
        if (current()) status.textContent = (error.sent || 0) + ' de ' + (error.total || users.length) + ' solicitações confirmadas. A operação não terminou; confira a conexão. As solicitações já confirmadas permanecem ativas.';
      } finally {sending = false; if (current()) {button.disabled = completed; dialog.querySelector('[data-all-close]').disabled = false;} else close();}
    };
  } catch {if (current()) status.textContent = 'Não foi possível conferir todos os usuários ou a versão. Feche e tente novamente.'; else close();}
  return close;
}

export async function openAppUpdatePanel({actorUid, target, isCurrent, root = document, services, readRelease = latestAppRelease, onExit = () => {}}) {
  const data = services || await import('./fi-admin-data.js');
  if (!isCurrent()) return () => {};
  const dialog = root.createElement('dialog'); dialog.className = 'admin-app-updates app-updates-command fi-admin-dialog';
  dialog.setAttribute('aria-labelledby', 'app-updates-command-title');
  dialog.innerHTML = '<header><h2 id="app-updates-command-title">CONTROLE DE ATUALIZAÇÕES</h2><p>Versão e último acesso por aparelho</p></header><section class="fi-admin-dialog__body"><div class="app-updates-command__controls"><button type="button" class="primary-button" data-panel-all>ATUALIZAR TODOS OS USUÁRIOS</button><button type="button" class="secondary-button" data-panel-refresh disabled>CONFERIR CONFIRMAÇÕES</button><label>Buscar usuário<input type="search" data-update-search placeholder="Nome, sigla ou e-mail"></label><p data-panel-status role="status" aria-live="polite">Carregando usuários…</p></div><div data-panel-list role="region" aria-label="Usuários por grupo" tabindex="0"></div></section><footer><button type="button" class="secondary-button" data-panel-close>VOLTAR</button></footer>';
  let closed = false, child = () => {}, users = [], sequence = 0, loading = true, categoryLoadFailed = false;
  const deviceStops = [];
  const current = () => !closed && isCurrent();
  const stopDevices = () => {for (const stop of deviceStops.splice(0)) stop();};
  const close = () => {if (closed) return; closed = true; sequence++; stopDevices(); child(); dialog.close(); dialog.remove();};
  const exit = () => {const notify = current(); close(); if (notify) return onExit();};
  const status = dialog.querySelector('[data-panel-status]'), list = dialog.querySelector('[data-panel-list]');
  const search = dialog.querySelector('[data-update-search]');
  const refresh = dialog.querySelector('[data-panel-refresh]');
  const all = dialog.querySelector('[data-panel-all]');
  const applySearch = () => {
    const term = searchText(search.value.trim());
    let count = 0;
    for (const group of list.querySelectorAll('[data-update-group]')) {
      let matches = 0;
      for (const row of group.querySelectorAll('[data-update-user]')) {
        row.hidden = !row.dataset.search.includes(term);
        if (!row.hidden) matches++;
      }
      group.hidden = matches === 0;
      count += matches;
    }
    const progress = loading ? ' · Conferindo aparelhos…' : '';
    const categories = categoryLoadFailed ? ' · Cadastro dos grupos indisponível.' : '';
    status.textContent = count ? count + ' usuário(s)' + progress + categories : 'Nenhum usuário encontrado.' + categories;
  };
  const render = async () => {
    if (!current()) {close(); return;}
    stopDevices();
    const ticket = ++sequence;
    loading = true;
    refresh.disabled = true;
    const groups = new Map(memberGroups.map(([id]) => [id, []]));
    const byUid = new Map(users.map(user => [user.uid, user]));
    for (const user of users) {
      const group = memberGroups.find(([id]) => user.memberCategories?.includes(id))?.[0] || 'other';
      groups.get(group).push(user);
    }
    const scrollTop = list.scrollTop;
    list.innerHTML = memberGroups.map(([id, title]) => {
      const members = groups.get(id);
      if (!members.length) return '';
      const cards = members.map(user => {
        const name = userName(user), info = [user.sigla, user.email].filter(Boolean).join(' · ');
        return `<article class="app-update-user" data-update-user data-search="${escape(searchText([name, info].join(' ')))}"><strong>${escape(name || 'Nome não cadastrado')}</strong><small>${escape(info)}</small><div data-user-devices="${escape(user.uid)}">Aguardando consulta…</div><button type="button" class="secondary-button" data-panel-user="${escape(user.uid)}">ATUALIZAÇÃO INDIVIDUAL</button></article>`;
      }).join('');
      return `<section data-update-group aria-labelledby="app-update-group-${id}"><h3 id="app-update-group-${id}">${title}</h3>${cards}</section>`;
    }).join('');
    applySearch();
    list.scrollTop = scrollTop;
    list.querySelectorAll('[data-panel-user]').forEach(button => {button.onclick = async () => {
      if (!current()) return;
      child();
      child = await openUserAppUpdates({actorUid, target, profile: byUid.get(button.dataset.panelUser), root, services: data, readRelease, isCurrent: current});
      if (!current()) child();
    };});
    const hosts = new Map([...list.querySelectorAll('[data-user-devices]')].map(host => [host.dataset.userDevices, host]));
    const publishedRelease = await readRelease(target).catch(() => null);
    const ordered = [...groups.values()].flat();
    for (let offset = 0; offset < ordered.length; offset += 4) {
      if (!current()) {close(); return;} if (ticket !== sequence) return;
      await Promise.all(ordered.slice(offset, offset + 4).map(async user => {
        const host = hosts.get(user.uid);
        let snapshot;
        try {snapshot = await data.readUserAppUpdates(actorUid, user.uid);} catch {}
        if (!current()) {close(); return;} if (ticket !== sequence) return;
        if (!snapshot) {host.textContent = 'Consulta indisponível. Nenhuma confirmação presumida.'; return;}
        const request = updateRequest(snapshot.request, target);
        const paintDevices = rows => {
          if (!current()) {close(); return;} if (ticket !== sequence) return;
          const devices = rows.filter(device => device.target === target);
          const latest = devices.reduce((value, device) => Math.max(value, lastAccess(device)), 0);
          host.innerHTML = `<p><strong>Último acesso:</strong> ${escape(accessLabel(latest))}</p><p>${request ? 'Exigência ativa' : 'Sem exigência ativa'}</p>` +
            (devices.map(device => `<div class="app-device-row"><span>${escape(device.platform)} · ${escape(deviceInstallationLabel(device))} · ${escape(device.deviceId.slice(0, 8))}</span><strong>${escape(devicePublishedState(device, publishedRelease))}</strong>${request ? `<span>Solicitação: <b data-device-request-state>${deviceUpdateState(device, request)}</b></span>` : ''}<small>${device.displayMode === 'standalone' ? 'Versão instalada' : 'Versão em uso'}: ${escape(deviceVersionLabel(device))} · compilação ${escape(device.loadedRelease)}</small><small>Acesso neste aparelho: ${escape(accessLabel(lastAccess(device)))}</small></div>`).join('') || '<p>Nenhum aparelho confirmado neste controle.</p>');
        };
        paintDevices(snapshot.devices);
        const watchFailed = () => {
          if (!current()) {close(); return;}
          if (ticket === sequence) host.insertAdjacentHTML('beforeend', '<small>Atualização ao vivo indisponível.</small>');
        };
        try {
          const stop = data.watchAppInstallations?.(actorUid, user.uid, paintDevices, watchFailed);
          if (stop) deviceStops.push(stop);
        } catch {watchFailed();}
      }));
    }
    if (!current()) {close(); return;}
    if (ticket !== sequence) return;
    loading = false;
    refresh.disabled = false;
    applySearch();
  };
  all.onclick = async () => {if (!current()) return; child(); child = await openAllAppUpdates({actorUid, target, root, services: data, readRelease, isCurrent: current}); if (!current()) child();};
  search.oninput = () => {list.scrollTop = 0; applySearch();};
  refresh.onclick = () => {void render();};
  dialog.querySelector('[data-panel-close]').onclick = exit;
  dialog.addEventListener('cancel', event => {event.preventDefault(); exit();});
  root.body.append(dialog); dialog.showModal();
  try {
    const [roster, assignments] = await Promise.all([
      data.listAppUpdateUsers(actorUid),
      data.listMemberCategoryAssignments?.().catch(() => {categoryLoadFailed = true; return [];}),
    ]);
    users = roster;
    if (assignments) {
      try {users = mergeMemberCategoryAssignments(roster, assignments);}
      catch {categoryLoadFailed = true;}
    }
    users = [...users].sort((a, b) =>
      Number(!userName(a)) - Number(!userName(b)) || names.compare(userName(a), userName(b)) || a.uid.localeCompare(b.uid));
    await render();
  }
  catch {if (current()) status.textContent = 'Não foi possível consultar os usuários. Feche e tente novamente.'; else close();}
  return close;
}
