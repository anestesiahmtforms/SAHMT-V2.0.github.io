export function showOccurrenceConfirmation(host,message) {
  const banner=document.createElement('dialog');
  banner.className='occurrence-confirmation';
  banner.setAttribute('aria-label',message);
  banner.innerHTML='<strong></strong><form method="dialog"><button class="primary-button" type="submit">OK</button></form>';
  banner.querySelector('strong').textContent=message;
  banner.addEventListener('close',()=>banner.remove(),{once:true});
  host.append(banner);
  banner.showModal();
}
