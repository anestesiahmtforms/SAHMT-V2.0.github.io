# Manual de Biossegurança HMT no FB

O botão do manual aparece acima dos históricos vacinal e de dosimetria em Biossegurança. Abre um leitor HTML no próprio app; voltar retorna ao menu Biossegurança. O documento mantém identificação de edição, autoria, aprovação, textos, tabelas, ilustrações e aviso de reprodução do material fornecido. O sumário navega no documento isolado, sem alterar a rota do aplicativo.

## Conteúdo e publicação

O texto completo e as ilustrações permanecem fora do repositório e do pacote público. Uma conversão revisada é armazenada exclusivamente em `institutionalBiosafetyManuals/hmt` no FB. O importador recebe DOCX, HTML e metadados privados, verifica os hashes, estrutura segura, dimensões, tamanho máximo, revisão e data. A aplicação usa precondições de versão, guarda cópia anterior privada e verifica a leitura posterior.

```sh
node scripts/import-biosafety-manual.mjs --source PRIVATE_DOCX --html PRIVATE_HTML --metadata PRIVATE_JSON
```

O comando apenas verifica até receber `--apply`. O limite de HTML é 900.000 bytes, incluindo imagens incorporadas, abaixo do limite de documento do Firestore. A conversão deve conferir integralidade dos parágrafos e também caixas de texto, linhas flutuantes de tabelas e dimensões originais de imagens. Não deve publicar silenciosamente uma extração textual que omita figuras ou fluxogramas. Uma revisão de conteúdo parte de nova edição institucional.

## Acesso e isolamento

`POST /v1/biosafety-manual` aceita apenas `GET_MANUAL` com `input: {}`. Exige autenticação Google verificada do FB e perfil atual com UID/e-mail correspondentes, ativo e autorizado. Não há seleção de documento, URL externa, UID, nem operações de edição no endpoint. A flag `BIOSAFETY_MANUAL_ENABLED` é explicitamente necessária. Respostas são `no-store`.

As regras FB negam acesso direto do cliente à coleção, inclusive para administradores. O Worker usa o serviço existente e retorna o manual somente após verificar o perfil e o hash do conteúdo. O leitor não usa armazenamento local; limpa o iframe ao encerrar ou invalidar a sessão. O iframe tem sandbox vazio, sem scripts nem acesso à origem do app. O próprio HTML usa CSP que permite apenas imagens raster incorporadas e estilos locais, sem recursos externos. Links do sumário usam `about:srcdoc#...` para manter a navegação dentro do documento.

## Verificação

`test:biosafety-manual` verifica integridade, importação segura, autenticação, revogação e contrato da rota. `test:biosafety-manual-browser` verifica posição/ícone do botão, telas de 320 a 1440 pixels, sumário, retorno e limpeza da leitura após mudança de sessão. `test:vaccination-rules` inclui a coleção privada. As fixtures contêm apenas conteúdo sintético. O fluxo existente do GitHub Pages publica o leitor; o conteúdo exige importação privada e o endpoint exige deploy do Worker.
