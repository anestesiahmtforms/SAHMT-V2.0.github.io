const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export function renderFiAdminDialog({title, displayName, body}) {
  return `<main class="main-content fi-admin-page"><dialog class="fi-admin-dialog" data-fi-admin-dialog aria-labelledby="fi-admin-dialog-title"><header><div class="identity-card__user-row"><span>${escape(displayName)}</span><div id="outbox-status" class="sync-pill" role="status"></div></div><p class="eyebrow">CENTRAL ADMINISTRATIVA</p><h1 id="fi-admin-dialog-title" tabindex="-1" autofocus>${escape(title)}</h1></header><div class="fi-admin-dialog__body">${body}</div><footer><button type="button" class="secondary-button" data-fi-admin-back>VOLTAR</button></footer></dialog></main>`;
}

export function mountFiAdminDialog(dialog, {onExit, isCurrent = () => true}) {
  let disposed = false;
  const back = dialog.querySelector('[data-fi-admin-back]');
  const exit = () => {if (!disposed && isCurrent()) onExit();};
  const cancel = event => {event.preventDefault(); exit();};
  back.addEventListener('click', exit);
  dialog.addEventListener('cancel', cancel);
  dialog.showModal();
  dialog.querySelector('h1').focus({preventScroll: true});
  return () => {
    disposed = true;
    back.removeEventListener('click', exit);
    dialog.removeEventListener('cancel', cancel);
    if (dialog.open) dialog.close();
  };
}
