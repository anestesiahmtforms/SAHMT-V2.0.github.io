# Grupos de acesso da Gestão de Documentos

## Escopo desta alteração

Base conferida em `main`: `42d0a8c0c237f3a4053f8eff392f61e7f07915a0`.
A implementação está em checkout isolado. As três alterações do checkout original foram preservadas.

A Gestão de Documentos passa a separar **ACESSO GERAL** e **ACESSO RESTRITO**. A categoria do grupo restrito é **POLITICAS E REGIMENTOS**. A seleção usa e-mails normalizados da conta autenticada, sem inventar UIDs e sem criar perfis ou conceder permissões globais.

O inventário privado contém 56 leitores gerais, 31 restritos (também presentes no geral) e dois gestores. São cinco documentos gerais e nove restritos. Todos devem permanecer **inativos** até a decisão de publicação do gestor. Os e-mails reais e os inventários ficam fora do Git.

## Autorização

- Todo acesso exige perfil V2 ativo e aprovado. Leitores e gestores locais também precisam de `managementRead`.
- Leitores acessam somente documentos ativos de um grupo ativo cuja lista contém seu e-mail autenticado e verificado.
- Gestores por e-mail acessam e editam registros existentes de seus grupos; gestores vinculados por UID editam registros da própria área.
- Gestores locais não criam documentos/grupos, não alteram a lista de acesso e não transferem um documento de grupo ou categoria.
- A permissão administrativa `documentsManage` mantém a gestão dos grupos, a classificação e a criação de documentos.
- Reclassificação exige escolher outro grupo válido; remover o vínculo de documento já agrupado é bloqueado.
- Registros legados desta área sem grupo ficam disponíveis à gestão para classificação, sem acesso de leitores comuns. Outras áreas mantêm o comportamento anterior.
- IDs estáveis, autoria de criação e publicação, timestamps, revisão concorrente e proteção após mudança de sessão permanecem preservados.

O arquivo continua no Google Drive. O controle no PWA não substitui o compartilhamento do Drive. As pastas e os 14 arquivos foram conferidos: as listas iniciais de 55 leitores gerais e 31 restritos correspondem à leitura nas pastas; os dois gestores já têm edição/propriedade dos arquivos. O leitor acrescentado posteriormente ao acesso geral ainda precisa de compartilhamento no Drive. Nenhuma permissão do Drive foi alterada.

## Como usar depois da implantação

1. Entre como administrador e abra Gestão → Gestão de Documentos.
2. Abra **Grupos de acesso aos documentos**. Use **Editar grupo** para ajustar leitores e gestores, um e-mail por linha.
3. Em **Adicionar ou editar documento**, selecione o grupo. Documentos novos desta área começam inativos.
4. Para atualizar o conteúdo, abra o link e edite o arquivo original no Drive. Mantendo o mesmo ID, o vínculo no PWA continua válido.
5. Ative o documento quando estiver pronto para a equipe autorizada. A marca **Leitura requerida** continua sendo um metadado; esta alteração não cria comprovantes de ciência nem comentários por documento.

A lista de e-mails prepara a audiência, mas cada pessoa ainda precisa entrar e solicitar aprovação no app. Na consulta realizada em 02/10/2026, somente um e-mail das listas tinha perfil aprovado com acesso à Gestão; o segundo gestor ainda não tinha perfil V2. Nada foi provisionado automaticamente.

## Importação preparada

O comando de preparo não usa rede nem grava Firestore:

```powershell
node scripts/prepare-document-groups-import.js audiencia.json geral.json restrito.json saida.json
```

A saída contém dados privados e deve permanecer em pasta ignorada pelo Git. IDs de documentos são derivados de SHA-256 de área + ID do arquivo, compatíveis com os cinco registros já importados.

O preflight administrativo desta sessão encontrou:

| Operação prevista | Quantidade |
| --- | ---: |
| Criar grupos | 2 |
| Classificar documentos gerais existentes | 5 |
| Criar documentos restritos inativos | 9 |
| Total de escritas atômicas previstas | 16 |

O preflight fez **zero escritas em produção**. O plano, inventários, backup e ferramenta de migração estão em `.local-preview/` no checkout de trabalho. A ferramenta verifica a correspondência do ruleset de produção com o arquivo revisado, usa precondições de criação/versão, faz backup antes do commit e relê os grupos/documentos depois. Ela recusa arquivos duplicados, documentos existentes ativos, registros fora do inventário e classificação incompatível.

## Implantação após revisão do PR

1. Revisar o PR e confirmar a base `main` antes de integrar.
2. Implantar somente os quatro índices novos, preservando todos os anteriores:
   `npx.cmd firebase deploy --only firestore:indexes --project sahmt-17a16`.
3. Aguardar todos os índices novos ficarem `READY`.
4. Integrar a versão revisada e acompanhar a publicação do Pages. Publicar somente as Rules:
   `npx.cmd firebase deploy --only firestore:rules --project sahmt-17a16`.
5. Consultar a release `cloud.firestore` e comparar o conteúdo do ruleset com o arquivo revisado.
6. Reexecutar o preflight privado e aplicar o commit de migração revisado. Confirmar 2 grupos, 14 documentos, todos inativos, sem mudanças em usuários, outras áreas ou arquivos do Drive.
7. Homologar leitor geral, leitor restrito e gestor com contas fictícias aprovadas antes de ativar documentos reais.

Não foram publicados Rules, índices, Functions, Worker, Apps Script ou PWA nesta alteração. Uma aba antiga de usuário comum usando a consulta geral anterior será recusada pelas novas Rules; deve atualizar o PWA. A versão do cache passa de 163 para 164, mantendo IndexedDB e filas pendentes.

## Verificação

- Domínio: **489/489**, incluindo normalização, seleção 55/31 fictícia, queries, versões, IDs, guardas de sessão, importação e interface.
- Firestore Rules: **77/77**, incluindo **20** regressões de grupos/documentos, consultas reais por grupo, revogação, autoria, escopo, rascunhos e legado.
- Worker de Etiquetas: **12/12**; sem alteração no Worker.
- Functions: **19/19** com Auth, Firestore e Functions emulados no projeto de demonstração; sem alteração ou publicação de Functions.
- Build: concluído. O manifesto permanece com 27 entradas; módulos PDF continuam carregados sob demanda.
- Interface: 12 cenários Edge headless com dados fictícios, administrador/gestor/leitor em 320×568, 390×844, 768×1024 e 1440×900, sem controles extrapolando na horizontal. Não é teste em Android/iPhone físico.

| Bundle | Antes (gzip) | Depois (gzip) | Diferença |
| --- | ---: | ---: | ---: |
| Principal | 87.257 bytes | 89.206 bytes | +1.949 bytes |
| Dados | 23.256 bytes | 24.215 bytes | +959 bytes |

As consultas de grupos são iniciadas somente ao abrir a área de documentos. O leitor usa duas consultas para descobrir seus grupos e uma consulta por grupo autorizado; o aumento substitui a consulta ampla anterior para que a autorização seja aplicada pelo servidor. Não foi medido tempo de interação em aparelho físico.

## Limites e continuação

- A ciência e os comentários individualizados por documento continuam sendo uma etapa separada; não aparecem como implementados neste PR.
- A seleção de audiência não aprova automaticamente uma conta e não concede acesso geral à Gestão.
- O limite preexistente de versão 100 para metadados de documentos permanece.
- O build mantém o aviso preexistente de chunk Firebase maior que 500 kB. Não houve mudança de módulos pesados ou cache indiscriminado.