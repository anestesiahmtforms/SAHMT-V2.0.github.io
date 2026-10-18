# Validação isolada da revisão documental

## Escopo

Dois ciclos são conferidos com arquivos descartáveis privados: substituição
integral do material Word e publicação no mesmo PDF; revisão do DOCX de questões
e aplicação em um Forms exclusivo do teste, com uma resposta sintética anterior.
Não são editados os 40 materiais em uso, os formulários dos profissionais, seus
históricos, perfis, pontuações ou as configurações de produção.

## O que foi encontrado

O sincronizador de material DOC→PDF está instalado e ativo para os 40 vínculos.
O código de questões em `scripts/lib/management-question-document.js` ainda
produz um plano bloqueado para revisão e aprovação. A mera existência dos DOCX
com gabarito não implica atualização automática dos Forms.

`ManagementQuestionRevision.gs` acrescenta um parser Word nativo e um adaptador
de aplicação **exclusivamente isolada**. Não instala um observador de questões
de produção. Exige modo de validação, proprietário efetivo, formulário e DOC
exatos, pasta e marca da execução, conteúdo aprovado por hash e banco atual
compatível. Relê o DOC no Drive antes de aplicar; documento alterado após a
aprovação bloqueia a gravação. Todos os pontos são preservados. O Form precisa
estar fechado, e as questões são editadas sem excluir/recriar seus itens.

O serviço nativo FormApp não fornece o mesmo CAS de revisionId da Forms API.
Por isso esta prova, com proprietário único, não habilita automaticamente a
revisão concorrente de Forms de produção. A integração futura deve vincular a
designação vigente do gestor e a aprovação da versão do documento.

## Execução real preparada

Em **SAHMT V2.0 – Integração Spark**, atualizar o editor e executar uma vez
`validarRevisaoDocumentalIsoladaV1`, em `ManagementRevisionValidation.gs`.
Os IDs da pasta de testes e de seus arquivos ficam somente no instalador privado
`ManagementRevisionValidationConfig`; não são incluídos no Git ou frontend.

A configuração pública de compartilhamento de um arquivo não é alterada para
expor os testes: a raiz e seus conteúdos ficam privados. As marcas da execução
usam `properties`, legíveis pelos aplicativos autorizados do proprietário, em
vez de `appProperties`, que são específicas de cada cliente OAuth. Nenhuma marca
contém dado pessoal ou segredo.

### Material e PDF

1. Converte o primeiro DOCX com o conversor real de produção.
2. Grava um estado exclusivo do PDF descartável e substitui completamente o DOCX
   pelo texto da segunda versão, preservando seu ID.
3. Agenda uma continuação após 150 segundos, respeitando a estabilização de dois
   minutos do sincronizador.
4. Chama o mesmo `gpdfSyncPair_` de produção. Exige uma conversão, uma cópia de
   recuperação e uma atualização condicional do mesmo PDF.
5. Repete a leitura e exige `PDF_SYNC_UNCHANGED`, sem nova gravação.
6. Remove somente o estado temporário desse PDF; configuração/fila dos 40 pares
   permanecem intactas.

### Questões e Forms

1. Cria um Forms de teste com duas questões e dois pontos por questão.
2. Usa o controle de audiência existente para permitir somente o proprietário
   durante a submissão de uma resposta artificial, e fecha o formulário.
3. Vincula as tabelas dos DOCX de teste aos IDs nativos criados pelo Google.
4. Confirma que o DOCX original corresponde ao banco e que um hash divergente
   bloqueia a aplicação antes de qualquer edição.
5. Aplica a revisão aprovada de uma questão, alternativas e gabarito.
6. Confere IDs, pontos, resposta anterior, carimbo e eventual pontuação armazenada;
   repete a revisão e exige zero alterações.
7. Conserva o Forms fechado e não publicado. O teste não instala acionador de
   recebimento ou de pontuação nesse formulário.

Uma falha no teste de Forms não cancela a prova independente do PDF. O resultado
fica parcial, com etapa e categoria seguras. Corpos HTTP, tokens e respostas dos
participantes não são registrados.

## Códigos

- `REVISION_VALIDATION_WAITING_SOURCE_STABILITY`: aguardar a continuação automática.
- `REVISION_VALIDATION_PASSED`: provas do servidor aprovadas; conferir o PDF externamente.
- `REVISION_VALIDATION_PARTIAL`: uma prova passou; analisar a outra antes de concluir.
- `REVISION_VALIDATION_PAUSED`: falha segura; nenhum acionador de continuação permanece.

O resultado privado permite acompanhamento pela ferramenta. Após a conclusão,
baixar o PDF descartável, confirmar o texto V2 e a ausência do texto V1,
renderizar as páginas e revisar visualmente. O encerramento tenta mover somente
a raiz descartável para a lixeira, com verificação de proprietário e marca
exatos. Se o Drive recusar exclusivamente por `appNotAuthorizedToChild`, a raiz
é identificada como concluída e conservada privada, com confirmação do acesso
exclusivo do proprietário. Não são ampliadas permissões para realizar a limpeza.

## Evidência disponível antes da execução

56 testes locais aprovados para parser, preservação de IDs/pontos, aprovação
imutável, falhas, retomada, fechamento, isolamento e repetição sem gravação.
Quatro DOCX descartáveis foram convertidos realmente pelo Google e suas quatro
páginas foram renderizadas e conferidas. O renderizador local não encontrou
LibreOffice no runtime; a conferência visual utilizou a exportação do Drive e
o Poppler empacotado, sem automatizar aplicativos de desktop.

Três fontes novas foram instaladas e relidas, preservando as 40 anteriores e
o manifesto. Nenhuma versão Web App ou PWA foi publicada. O controle do
navegador estava desabilitado em Work; a execução nativa dependeu do clique do
operador. Essas evidências de preparação foram complementadas pela prova real
abaixo. Com a regressão de proteção de pastas, o conjunto local soma 78 testes
aprovados.

## Resultado real em 18/10/2026

Às **00:03:54 (America/Sao_Paulo)**, o resultado privado retornou
`REVISION_VALIDATION_PASSED`, sem continuação automática pendente:

- Forms descartável: uma questão revisada, IDs e pontos preservados, gabarito
  atualizado e a resposta sintética anterior preservada (uma antes e uma depois).
- Aprovação inválida bloqueada; reaplicação com zero gravações; Forms fechado
  e não publicado após o teste.
- Material Word integralmente substituído: `PDF_SYNC_UPDATED`, no mesmo ID do
  PDF, com uma conversão, uma atualização e uma cópia anterior conferida.
- Repetição: `PDF_SYNC_UNCHANGED`, sem nova gravação.
- PDF baixado: texto novo presente, texto antigo ausente; uma página renderizada
  e conferida visualmente, sem cortes.
- Zero escritas de produção e zero leituras do Firestore pela prova.

A conferência independente às **00:04:34** confirmou os 66 editáveis, as 57
pastas restritas e os 40 vínculos de produção, com os 40 PDFs inalterados,
sincronização ativa e um único acionador.

O encerramento retornou `REVISION_VALIDATION_FIXTURES_ARCHIVED_PRIVATE`.
O Drive recusou a exclusão da pasta por `appNotAuthorizedToChild`, pois alguns
filhos foram criados pelo Apps Script. A pasta foi identificada como concluída,
permanece privada e acessível somente ao proprietário; não foi excluída.

**Limite da conclusão:** o ciclo de questões foi validado em Forms descartável.
A aplicação automática dos DOCX de questões aos Forms de produção continua
bloqueada; esta prova não ativou esse fluxo nem concedeu acessos de gestores.
O sincronizador de material DOC→PDF dos 40 pares permanece ativo.
