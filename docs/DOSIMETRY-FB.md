# Biossegurança e histórico individual de dosimetria

Gestão de Pessoas abre Biossegurança, com os históricos vacinal e de dosimetria. O histórico oferece botões para 2025 e 2026. Cada botão abre um banner individual com os doze meses do ano selecionado; voltar retorna primeiro à seleção de anos. Valores numéricos usam mSv; ANR permanece um código abaixo do nível de registro indicado no relatório, nunca zero. Meses sem informação não recebem valores estimados.

## Origem e atualização

A importação atual é uma extração revisada visualmente dos PDFs de origem. Não existe sincronização automática com o Drive. Novos documentos exigem revisão e importação controlada. O PDF completo, nomes, e-mails, identificadores e resultados reais permanecem fora do repositório público. Fixtures e testes usam dados sintéticos.

O importador recebe caminhos privados para PDF, extração, vínculos e contatos oficiais:

```sh
node scripts/import-dosimetry.mjs --pdf PRIVATE_PDF --extraction PRIVATE_JSON --bindings PRIVATE_JSON --contacts PRIVATE_JSON
```

Sem `--apply`, o comando apenas prepara o plano privado. A aplicação verifica hash do PDF, identidade exata, disponibilidade do perfil, colisões, versão anterior e leitura posterior. Vínculos podem vir de nome oficial e e-mail ou de confirmação explícita do responsável. Divergências não são resolvidas por aproximação. Um PDF diferente exige revisão adicional; o importador recusa substituição silenciosa.

## Acesso

O Worker FB oferece somente `POST /v1/dosimetry` com `{"action":"GET_OWN","input":{"year":2026}}`, aceitando exclusivamente os anos numéricos 2025 e 2026, habilitado por `DOSIMETRY_ENABLED`. Exige token Google verificado do FB, perfil atual ativo e autorizado, e correspondência entre UID e e-mail do perfil e do registro importado. O cliente não pode escolher outro nome, UID, e-mail ou arquivo. Mesmo administradores consultam somente o próprio registro nesta rota.

Os registros ficam na coleção privada `occupationalDosimetry`, sem acesso direto de clientes Firebase, incluindo administradores. O Worker utiliza a conta de serviço existente. A resposta contém apenas a linha do próprio profissional e metadados necessários à exibição; não fornece o PDF coletivo nem URLs do Drive. O nome editável da conta Google não seleciona registros. O ano do documento armazenado deve coincidir com o ano solicitado. Os documentos usam IDs distintos por conta e ano; importar um ano não sobrescreve o outro. A interface rejeita respostas de outro ano, ignora respostas antigas após troca de banner e limpa o histórico ao invalidar a sessão e não persiste resultados no armazenamento local.

Nenhum novo plano de faturamento, OAuth do Drive ou compartilhamento foi necessário. Logs e infraestrutura existentes continuam sujeitos às suas políticas; esta consulta é identificada e individual.

## Verificação e publicação

`test:dosimetry` valida valores, importação e isolamento entre contas; `test:dosimetry-browser` valida navegação, doze meses, telas de 320 a 1440 pixels e invalidação de sessão. `test:vaccination-rules` comprova a negativa de leitura, consulta e escrita direta. A publicação requer deploy do Worker e build/publicação FA/FB pelo fluxo existente do GitHub Pages. A coleta de vacinas permanece no módulo anterior.
