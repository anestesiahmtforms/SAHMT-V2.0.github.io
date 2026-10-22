# Autenticação Google FA–FB–FC–FD–FE — pacote revisável

Estado em 22/10/2026: pacote revisável entregue e publicação desta atualização de autenticação autorizada pelo administrador após as provas locais. Esta nota registra a validação anterior à implantação; a entrega pública será acompanhada pelo GitHub Actions. A migração de dados permanece fora do pacote.

## Comportamento da entrega

O login FA permanece disponível. A chamada “ATUALIZAR O APP” permite confirmar a mesma conta Google e estabelecer sessões Firebase Auth independentes em FB, FC, FD e FE. O código confere UID e identidade Google e reutiliza as sessões persistidas pelo SDK. Uma falha de destino mantém os demais acessíveis. A saída encerra as cinco sessões.

A autenticação não consulta Firestore para manter sessões e não inclui broker, HMAC, lease ou consultas periódicas de perfil. As permissões e a leitura de dados dos módulos continuam sujeitas aos perfis e regras dos próprios projetos. O código não associa contas por e-mail nem cria contas de destino ausentes; cadastros precisam ter a identidade Google vinculada corretamente.

## Evidência real fornecida pelo administrador

Origem local: localhost:5197. Relatórios recebidos em 22/10/2026:

| Prova | Horário de São Paulo | Resultado |
| --- | --- | --- |
| Entrada | 15:50:45 | Uma confirmação Google; FA reautenticado; troca de credencial aprovada em FB/FC/FD/FE; UID e identidade Google correspondentes nos cinco projetos |
| Restauração | 15:55:52 | Cinco sessões restauradas após recarregar; zero confirmações Google e zero novas trocas |
| Saída | 15:57:33 | Logout completo; cinco sessões desconectadas |

Os três relatórios indicaram zero leituras e zero escritas Firestore. A prova cobre a conta administrativa e o navegador utilizado. A origem pública foi confirmada pelo usuário na configuração do cliente OAuth; não houve execução deste pacote em produção nem teste real em iOS nesta etapa.

## Validação local

- 134 testes de autenticação, persistência, isolamento de conta, falhas de destino, service worker e preservação de filas: aprovados.
- 1.065 testes de domínio: aprovados. Os carregadores de testes que extraem funções do app receberam o contexto de implantação FA, preservando suas verificações de acesso e roteamento.
- Build FA com autenticação habilitada: aprovado.
- Checagem `FA_RUNTIME_CLEANUP_VERIFIED`: zero módulos antigos de broker/lease alcançáveis e zero chunks antigos no build.
- Artefato `dist/`: sem aplicação independente `/gestao/` e sem a página local de prova.
- `git diff --check`: aprovado.

## Configuração preparada para publicação

Workflow `.github/workflows/pages.yml`, somente no pacote local em revisão:

- `VITE_GOOGLE_PROJECT_AUTH_ENABLED=true`.
- `SAHMT_FB_CUTOVER=false`.
- Flags antigos de integração e primeiro login especial: false.
- Build `node scripts/build-independent-apps.mjs --fa-only`.

Os componentes já preparados da migração para FB foram preservados na worktree. O pacote de autenticação não transfere Gestão, Desempenho, QMENTUM, Ocorrências ou qualquer documento entre projetos. Não modifica usuários, perfis, regras, IAM ou faturamento.

## Reversão

Definir `VITE_GOOGLE_PROJECT_AUTH_ENABLED=false` no workflow, reconstruir o pacote FA e publicar a reversão. Preservar sessões SDK, contas, IndexedDB, rascunhos e filas. Não usar limpeza de cache ou exclusão de dados como reversão.

Execução autorizada: aplicar o pacote, conferir a entrega no domínio público e observar o primeiro uso real. A validação local não deve ser apresentada como prova de execução pública ou de iOS.
