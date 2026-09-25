export function bindLabelCamera(form) {
  const openButton = form.querySelector('#label-camera-open');
  const closeButton = form.querySelector('#label-camera-close');
  const captureButton = form.querySelector('#label-camera-capture');
  const dialog = form.querySelector('#label-camera-dialog');
  const video = form.querySelector('#label-camera-video');
  const status = form.querySelector('#label-camera-status');
  const fileInput = form.querySelector('#label-ocr-file');
  if (!openButton || !dialog || !video || !captureButton || !fileInput) return () => {};
  const controller = new AbortController();
  const {signal} = controller;
  let stream = null;
  let requestGeneration = 0;
  const stopStream = () => {
    requestGeneration++;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    video.srcObject = null;
    captureButton.disabled = true;
  };
  const startCamera = async () => {
    const generation = ++requestGeneration;
    if (!navigator.mediaDevices?.getUserMedia) {
      status.textContent = 'Este navegador não oferece câmera direta. Use o campo Foto ou arquivo da etiqueta.';
      return;
    }
    captureButton.disabled = true;
    status.textContent = 'Solicitando acesso à câmera…';
    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({audio: false, video: {facingMode: {ideal: 'environment'}, width: {ideal: 1920}, height: {ideal: 1080}}});
      if (generation !== requestGeneration || !dialog.open) {
        nextStream.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = nextStream;
      video.srcObject = stream;
      await video.play();
      if (generation !== requestGeneration || !dialog.open) return;
      captureButton.disabled = false;
      status.textContent = 'Enquadre a etiqueta e toque em Capturar foto.';
    } catch (error) {
      if (generation !== requestGeneration) return;
      stopStream();
      const detail = error.name === 'NotAllowedError' ? 'Permita o acesso à câmera nas configurações do navegador.'
        : error.name === 'NotFoundError' ? 'Nenhuma câmera compatível foi encontrada.'
          : 'Não foi possível iniciar a câmera neste aparelho.';
      status.textContent = `${detail} Você ainda pode escolher uma foto ou arquivo.`;
    }
  };
  const onOpen = () => {
    if (!dialog.open) dialog.showModal();
    void startCamera();
  };
  const onClose = () => dialog.close();
  const onCapture = () => {
    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    if (!sourceWidth || !sourceHeight) {
      status.textContent = 'A câmera ainda está ajustando a imagem. Tente novamente em alguns segundos.';
      return;
    }
    if (typeof DataTransfer !== 'function') {
      status.textContent = 'Este navegador não permite transferir a captura ao leitor. Use o campo Foto ou arquivo.';
      return;
    }
    const scale = Math.min(1, 2200 / Math.max(sourceWidth, sourceHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) {
      status.textContent = 'Não foi possível preparar a captura. Tente novamente ou escolha uma foto.';
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    captureButton.disabled = true;
    canvas.toBlob((blob) => {
      canvas.width = 0;
      canvas.height = 0;
      if (!fileInput.isConnected) return;
      if (!blob) {
        status.textContent = 'Não foi possível preparar a captura. Tente novamente ou escolha uma foto.';
        captureButton.disabled = false;
        return;
      }
      const file = new File([blob], `sahmt-etiqueta-${Date.now()}.jpg`, {type: 'image/jpeg', lastModified: Date.now()});
      const transfer = new DataTransfer();
      transfer.items.add(file);
      stopStream();
      dialog.close();
      fileInput.files = transfer.files;
      fileInput.dispatchEvent(new Event('change', {bubbles: true}));
    }, 'image/jpeg', 0.92);
  };
  const onDialogClose = () => stopStream();
  const onBackdrop = (event) => { if (event.target === dialog) dialog.close(); };
  openButton.addEventListener('click', onOpen, {signal});
  closeButton?.addEventListener('click', onClose, {signal});
  captureButton.addEventListener('click', onCapture, {signal});
  dialog.addEventListener('close', onDialogClose, {signal});
  dialog.addEventListener('click', onBackdrop, {signal});
  return () => {
    controller.abort();
    stopStream();
    if (dialog.open) dialog.close();
  };
}
