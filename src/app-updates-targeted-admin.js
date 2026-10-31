import {deviceUpdateState, recoveryUrl, updateRequest, deviceInstallationLabel, devicePublishedState} from './app-updates-targeted.js';
import {requestUpdatesForUsers} from './app-updates-targeted-batch.js';
import {deviceVersionLabel} from './app-version.js';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export async function latestAppRelease(target, {fetchImpl = fetch, origin = location.origin} = {}) {
  const response = await fetchImpl(origin + '/SAHMT-V2.0.github.io/tools/app-release.json?t=' + Date.now(), {cache: 'no-store', redirect: 'error'});
  if (!response.ok) throw Error('APP_UPDATE_VERSION_UNAVAILABLE');
  const data = await response.json(), release = data.targets?.[target];
  if (data.schema !== 1 || !Number.isSafeInteger(release) || release <= 0) throw Error('APP_UPDATE_VERSION_INVALID');
  return release;
}
export async function openUserAppUpdates({actorUid, profile, target, isCurrent,
  root = document, services, readRelease = latestAppRelease}) {
  const data = services || await import('./app-updates-targeted-firebase.js');
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
      const date = device.lastSeenAt?.toDate?.();
      return `<article class="app-device-row"><strong>${escape(device.platform)} · ${escape(deviceInstallationLabel(device))} · ${escape(device.deviceId.slice(0, 8))}</strong><span>${escape(deviceVersionLabel(device))} · compilação ${escape(device.loadedRelease)} · ${escape(devicePublishedState(device,publishedRelease))}</span>${request ? `<small>Solicitação: ${deviceUpdateState(device,request)}</small>` : '<small>Versão recebida registrada, mesmo sem exigência ativa.</small>'}<small>Última conexão: ${date ? escape(date.toLocaleString('pt-BR', {timeZone: 'America/Sao_Paulo'})) : 'aguardando confirmação'}</small></article>`;
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
  const data = services || await import('./app-updates-targeted-firebase.js');
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
  const data = services || await import('./app-updates-targeted-firebase.js');
  if (!isCurrent()) return () => {};
  const dialog = root.createElement('dialog'); dialog.className = 'admin-app-updates app-updates-command';
  dialog.setAttribute('aria-labelledby', 'app-updates-command-title');
  dialog.innerHTML = '<header><h2 id="app-updates-command-title">CONTROLE DE ATUALIZAÇÕES</h2><p>iPhone e Android · confirmação por usuário e aparelho</p></header><section><button type="button" class="primary-button" data-panel-all>ATUALIZAR TODOS OS USUÁRIOS</button><p>Todos considera os usuários com acesso ativo neste app. Para um caso específico, use o botão no nome da pessoa. Aparelhos antigos precisam abrir o link de recuperação uma primeira vez.</p><label>Buscar usuário<input type="search" data-update-search placeholder="Nome, sigla ou e-mail"></label><p data-panel-status role="status" aria-live="polite">Carregando usuários…</p><div data-panel-list></div><div class="admin-user-actions"><button type="button" class="secondary-button" data-panel-previous>ANTERIORES</button><button type="button" class="secondary-button" data-panel-next>PRÓXIMOS</button><button type="button" class="secondary-button" data-panel-refresh>CONFERIR CONFIRMAÇÕES</button></div></section><footer><button type="button" class="secondary-button" data-panel-close>VOLTAR</button></footer>';
  let closed = false, child = () => {}, users = [], page = 0, sequence = 0,deviceStops=[];
  const current = () => !closed && isCurrent();
  const stopDevices=()=>{for(const stop of deviceStops.splice(0))stop();};
  const close = () => {if(closed)return;closed = true; sequence++;stopDevices(); child(); dialog.close(); dialog.remove();};
  const exit = () => {const notify=current();close();if(notify)return onExit();};
  const status = dialog.querySelector('[data-panel-status]'), list = dialog.querySelector('[data-panel-list]');
  const filtered = () => {const text = dialog.querySelector('[data-update-search]').value.trim().toLocaleLowerCase('pt-BR'); return users.filter(user => [user.displayName,user.email,user.sigla].join(' ').toLocaleLowerCase('pt-BR').includes(text));};
  const render = async () => {
    if (!current()) {close(); return;}
    stopDevices();
    const ticket = ++sequence, rows = filtered(), visible = rows.slice(page * 20, (page + 1) * 20);
    const publishedRelease=await readRelease(target).catch(()=>null);if(!current()){close();return;}if(ticket!==sequence)return;
    dialog.querySelector('[data-panel-previous]').disabled = page === 0;
    dialog.querySelector('[data-panel-next]').disabled = (page + 1) * 20 >= rows.length;
    status.textContent = rows.length + ' usuário(s) · página ' + (page + 1) + '. Conferindo aparelhos…';
    list.innerHTML = visible.map(user => `<article class="app-update-user"><strong>${escape(user.displayName || user.email)}</strong><small>${escape([user.sigla,user.email].filter(Boolean).join(' · '))}</small><div data-user-devices="${escape(user.uid)}">Aguardando consulta…</div><button type="button" class="secondary-button" data-panel-user="${escape(user.uid)}">ATUALIZAÇÃO INDIVIDUAL</button></article>`).join('');
    list.querySelectorAll('[data-panel-user]').forEach(button => {button.onclick = async () => {
      if (!current()) return;
      child(); child = await openUserAppUpdates({actorUid, target, profile: users.find(user => user.uid === button.dataset.panelUser), root, services: data, readRelease, isCurrent: current});
      if (!current()) child();
    };});
    // Bounded reads for the visible page; every row is a server-confirmed query.
    for (let offset = 0; offset < visible.length; offset += 4) {
      if (!current()) {close(); return;} if (ticket !== sequence) return;
      await Promise.all(visible.slice(offset, offset + 4).map(async user => {
        let snapshot;
        try {snapshot = await data.readUserAppUpdates(actorUid, user.uid);} catch {}
        if (!current()) {close(); return;} if (ticket !== sequence) return;
        const host = [...list.querySelectorAll('[data-user-devices]')].find(node => node.dataset.userDevices === user.uid);
        if (!snapshot) {host.textContent = 'Consulta indisponível. Nenhuma confirmação presumida.'; return;}
        const request = updateRequest(snapshot.request, target);
        const paintDevices=rows=>{if(!current()){close();return;}if(ticket!==sequence)return;const devices=rows.filter(device=>device.target===target);
        host.innerHTML = `<p>${request ? 'Exigência ativa' : 'Sem exigência ativa'}</p>` + (devices.map(device => `<div class="app-device-row"><span>${escape(device.platform)} · ${escape(deviceInstallationLabel(device))} · ${escape(device.deviceId.slice(0,8))}</span><strong>${escape(devicePublishedState(device,publishedRelease))}</strong>${request ? `<span>Solicitação: <b data-device-request-state>${deviceUpdateState(device,request)}</b></span>` : ''}<small>Versão recebida: ${escape(deviceVersionLabel(device))} · compilação ${escape(device.loadedRelease)}</small></div>`).join('') || '<p>Nenhum aparelho confirmado neste controle.</p>');};
        paintDevices(snapshot.devices);
        const stop=data.watchAppInstallations?.(actorUid,user.uid,paintDevices,()=>{if(!current()){close();return;}if(ticket===sequence)host.textContent='Acompanhamento indisponível. Use CONFERIR CONFIRMAÇÕES.';});if(stop)deviceStops.push(stop);
      }));
    }
    if (!current()) {close(); return;} if (ticket === sequence) status.textContent = rows.length + ' usuário(s) · página ' + (page + 1) + '. Consulta concluída.';
  };
  dialog.querySelector('[data-panel-all]').onclick = async () => {if (!current()) return; child(); child = await openAllAppUpdates({actorUid,target,root,services:data,readRelease,isCurrent:current}); if (!current()) child();};
  dialog.querySelector('[data-update-search]').oninput = () => {page = 0; void render();};
  dialog.querySelector('[data-panel-previous]').onclick = () => {page = Math.max(0,page - 1); void render();};
  dialog.querySelector('[data-panel-next]').onclick = () => {page++; void render();};
  dialog.querySelector('[data-panel-refresh]').onclick = () => {void render();};
  dialog.querySelector('[data-panel-close]').onclick = exit;
  dialog.addEventListener('cancel', event => {event.preventDefault(); exit();});
  root.body.append(dialog); dialog.showModal();
  try {users = await data.listAppUpdateUsers(actorUid); await render();}
  catch {if (current()) status.textContent = 'Não foi possível consultar os usuários. Feche e tente novamente.'; else close();}
  return close;
}
