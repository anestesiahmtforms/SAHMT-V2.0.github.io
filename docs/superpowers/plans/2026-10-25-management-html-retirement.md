# Retirada do leitor PDF de Gestão em FB

> **For agentic workers:** implementar diretamente com superpowers:executing-plans. A retirada definitiva e o destino FB foram solicitados pelo usuário nesta conversa.

**Goal:** retirar o fluxo PDF/e-book/Forms da Gestão de Documentos e preparar a área para os treinamentos HTML.

**Architecture:** o shell deixa de importar o leitor PDF e de consultar o catálogo legado nessa área. FB continua usando sua autenticação e seu banco existentes. O endpoint legado passa a responder como retirado. Conforme a correção expressa do usuário, as implementações do leitor, ponte, preparadores e sincronizadores antigos são excluídas do repositório. Desempenho e registros históricos são preservados.

**Tech Stack:** JavaScript, Vite, Worker e Apps Script existentes, testes Node.

**Spec:** decisões em `docs/treinamentos-html-regras-aprovadas-2026-10-25.md` e solicitação expressa do usuário para aposentar o leitor desta área em FB.

## Restrições

- Não importar nem ativar os treinamentos novos nesta etapa.
- Preservar documentos de origem, usuários, permissões e registros históricos.
- Não alterar outros módulos, autenticação ou distribuição entre instâncias.
- O build não deve incorporar o e-book ou o worker PDF por variáveis antigas.

## Tarefas

- [x] Testar e retirar ações PDF/Forms nos cartões da área documental; exibir estado de preparação HTML.
- [x] Remover importação e aquecimento do e-book no shell; dispensar consulta e progresso do catálogo legado da área.
- [x] Remover o leitor dos builds e retirar variáveis de ativação do workflow de publicação.
- [x] Responder 410 no endpoint legado sem acessar Apps Script ou validar sessões de leitura.
- [x] Excluir preparadores e sincronizadores legados no repositório; manter apenas utilitários Drive compartilhados por funcionalidades preservadas.
- [x] Executar testes afetados e build FA/FB, conferir ausência do e-book no manifesto e registrar o que ainda depende de implantação remota.

## Destino confirmado

O usuário confirmou que FB contém Gestão de Documentos e Desempenho. Os HTML ficarão no Firestore de FB; as quatro pastas oficiais foram confirmadas pelo usuário e registradas nas regras aprovadas. Não ativar material a partir de prévias.

## Verificação local e limites de entrega

- 411 testes direcionados aprovados na verificação final, incluindo serviços compartilhados de Forms, ledger de pontuação, Desempenho, FB, Worker, auditoria ROP e retirada do leitor. Testes exclusivos dos instaladores e caminhos de validação retirados foram excluídos junto deles.
- Builds de FA e FB concluídos. Ambos os manifestos não contêm e-book, leitor legado, pdfjs ou seu worker. A geração de relatórios PDF de outros módulos permanece independente.
- Dependência pdfjs-dist e seus pacotes opcionais exclusivos removidos dos manifestos; dependências raiz do lockfile conferidas.
- Excluídos também o publicador Forms do antigo catálogo documental, a auditoria/migração desse modelo e seu instalador de repetição. Serviços genéricos de Forms deixam de descobrir referências, publicar ou importar respostas da área documental; não apagam histórico ou créditos.
- A revisão independente identificou dependências compartilhadas nas rotinas removidas. O transporte e a paginação de permissões Drive necessários à manutenção restante foram preservados em ManagementDriveSupport; caminhos e auditorias exclusivos de fixtures antigas foram retirados.
- Nenhum dado remoto, documento do Drive ou registro de pontuação foi excluído. Os HTML novos não foram importados.
- Alterações locais ainda não publicadas. O Apps Script remoto e eventuais acionadores remotos não foram alterados nesta etapa; a suspensão remota de 24/10 continua sendo o último estado confirmado. Uma publicação futura deverá aplicar as exclusões no Apps Script e retirar eventuais acionadores exclusivos das funções removidas, preservando os acionadores de Desempenho e dos demais módulos.
