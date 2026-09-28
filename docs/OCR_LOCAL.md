# Leitura local de Etiquetas

> Referência histórica da leitura local anterior. O fluxo atual em V2 usa a função autenticada `readLabelImage` e a IA no servidor; consulte [ETIQUETAS_IA_V2.md](ETIQUETAS_IA_V2.md). A configuração da chave e o deploy da função ainda são necessários antes de a leitura IA operar em produção.

O conteúdo abaixo documenta uma implementação substituída e não deve ser seguido para o fluxo atual. Tesseract foi removido das dependências npm; os arquivos históricos em `public/vendor/ocr/` ainda estão no checkout, mas não são carregados pela interface atual.

## Fluxo

- A leitura começa somente quando a pessoa toca em **Ler dados da foto neste aparelho**. A importação de `tesseract.js` também é dinâmica; abrir o PWA, autenticar ou abrir outra área não baixa nem inicializa o mecanismo.
- A câmera pode ser aberta por ação explícita em modal, com preferência pela traseira. A captura é convertida em um arquivo JPEG em memória e encaminhada à mesma prévia local; fechar o modal ou sair da área encerra todas as trilhas da câmera. O seletor de foto/arquivo continua disponível como alternativa. Os testes automatizados usam uma trilha de câmera simulada para verificar captura, fallback e encerramento; ainda falta validar permissões, foco e uso contínuo em Android e iPhone físicos.
- A foto é limitada a 12 MB e preparada em memória a no máximo 2200 px. A pessoa pode ler a foto inteira ou marcar uma área com arraste e redefinir para a foto inteira. O recorte e a prévia permanecem em memória; a imagem selecionada é lida pelo Web Worker local com os recursos do motor e do modelo português servidos pelo próprio Pages. A foto não é enviada a uma API nem salva no Firestore, IndexedDB, cache do aplicativo ou log.
- O OCR sugere nome, convênio, cirurgia, atendimento, tipo e credor quando encontra rótulos explícitos. Número de prontuário não é usado como nome. Número parcialmente lido ou sem rótulo pode não ser encontrado. A interface trata todo resultado como rascunho e exige conferência humana antes de salvar; o OCR nunca grava sozinho.
- Sem os recursos locais disponíveis, a etiqueta continua utilizável por preenchimento manual.

## Dependências locais e procedência

- `tesseract.js` 7.0.0, licença Apache-2.0, pacote travado em `package-lock.json`.
- Worker e três variantes LSTM-only WebAssembly de `tesseract.js-core` 7.0.0 estão em `public/vendor/ocr/`. O modo LSTM-only é o padrão usado por `createWorker`; os três motores de reconhecimento legado foram removidos porque o SAHMT não ativa esse modo. O navegador verifica SIMD e baixa só uma das variantes LSTM. `lang/por.traineddata` vem de `tesseract-ocr/tessdata_fast`, commit `87416418657359cb625c412a48b6e1d6d41c29bd`, licença Apache-2.0. SHA-256 do modelo: `C4932B937207A9514B7514D518B931A99938C02A28A5A5A553F8599ED58B7DEB`.
- A implementação segue o worker do navegador e os caminhos locais recomendados pelo [guia de instalação local do Tesseract.js](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md). O carregamento sob demanda acompanha a recomendação de desempenho do [projeto Tesseract.js](https://github.com/naptha/tesseract.js/blob/master/docs/performance.md) para aplicações em que OCR só é necessário em parte das sessões.

## Homologação restante

Fazer leituras controladas em fotos autorizadas e sem expor os dados, em Android e iPhone. Conferir o alinhamento do recorte em retrato e paisagem, rotação, reflexo, layout Consulta/SADT, textos e, sobretudo, cada dígito de cirurgia/atendimento (incluindo zero cortado versus oito). A saída atual é uma sugestão por OCR local e não reproduz a interpretação visual multimodal da IA V1. Ajustar heurísticas somente com exemplos autorizados e registrar erros conhecidos antes de habilitar em produção.
