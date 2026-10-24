# Auditoria de sessões e navegação FA–FE — shell 240

## Escopo e diagnóstico

Auditoria local do código de autenticação, navegação, inicialização Firebase e recuperação do PWA. Os testes usam identidades e registros sintéticos; não houve leitura ou alteração de documentos de produção, regras, usuários ou configuração dos projetos.

| Instância | Projeto | Uso encontrado nesta versão |
| --- | --- | --- |
| FA | `sahmt-17a16` | Shell e módulos operacionais, identidade principal |
| FB | `sahmt-gestao-5ae66` | PWA independente de Gestão e Desempenho, em `/gestao/` |
| FC | `indicadores---sahmt` | Registros de Ocorrências e QMENTUM |
| FD | `rotinas-8a617` | Autenticação configurada; painel de resultados ainda sem operações de dados |
| FE | `outros-48120` | Autenticação configurada; painel de enquetes/consultas ainda sem operações de dados |

A autenticação já utilizava persistência do SDK, com preferência por IndexedDB e alternativas localStorage/memória. As instâncias Auth e Firestore existentes são reutilizadas. O problema encontrado não foi a ausência de uma opção de persistência Auth.

## Falhas reproduzidas e correções

1. **Restauração em fila:** FB e FC lentos ocupavam os dois lugares da fila de restauração, atrasando FD e FE. A conferência das quatro sessões existentes agora ocorre independentemente. A conexão com credencial Google continua com concorrência limitada a dois destinos.
2. **Estado pronto reiniciado na manutenção:** uma sessão confirmada mudava para `restoring` em cada varredura. A apresentação permanece `ready` durante a conferência e muda para pendente quando ocorre uma falha real. A entrada no módulo continua conferindo a sessão e a identidade atuais.
3. **Conferências duplicadas e resultados antigos:** o observador Auth e a entrada do módulo podiam conferir simultaneamente o mesmo token. Agora compartilham uma operação limitada por prazo, vinculada ao objeto User. Uma substituição desse objeto não herda o resultado de uma verificação anterior. Uma operação expirada libera uma nova tentativa.
4. **FC fora da coordenação de entrada:** os módulos FC podiam mostrar login manual enquanto o coordenador FA–FE ainda fazia o login automático. Ocorrências e QMENTUM agora aguardam sua própria sessão coordenada antes da recuperação manual, sem repetir a conferência do token na abertura bem-sucedida.
5. **Erro de restauração confundido com falha final:** durante o login automático, uma sessão antiga pode falhar na restauração e ser reparada logo depois com a credencial disponível. A espera distingue essa etapa da falha final de conexão; uma falha definitiva do destino não aguarda projetos alheios.
6. **Redirecionamento de navegação anterior:** uma conferência FB atrasada podia enviar o usuário a Gestão ou Sincronização depois de ele escolher outra página. Geração da navegação e hash de origem impedem esse redirecionamento antigo.

`google-project-session.js` reúne a espera por identidade, prazo, descarte de navegação e limpeza de assinaturas. O runtime mantém a validação de UID, identidade Google, emissor, projeto e provedor. Logout e troca de conta continuam invalidando operações antigas. O shell passa a 240 para entregar os novos arquivos pelo ciclo de atualização já existente.

## Persistência e limites

As credenciais continuam sob responsabilidade do SDK Firebase. Nenhum token adicional é salvo pelo app. O Firestore permanece com o cache existente e a operação offline continua usando as filas e os caches próprios do aplicativo. Não foi habilitado armazenamento indiscriminado de documentos Firestore em disco.

Persistência de autenticação, cache de documentos e conexão de rede são mecanismos diferentes. A troca entre FA e o PWA independente FB carrega outra página: a sessão persistida é restaurada, mas o processo JavaScript e seus sockets não atravessam essa navegação. Suspensão pelo sistema e perda real de rede ainda podem exigir reconexão. As correções removem bloqueios e corridas locais reproduzidos; não demonstram a eliminação de toda latência no dispositivo do usuário.

## Verificação

- Suíte de domínio: 1.078 testes aprovados.
- Suíte de autenticação, incluindo entrada de módulos e navegação: 179 testes aprovados.
- Suíte de operação offline: 179 testes aprovados.
- Revisão independente: 62 testes direcionados aprovados após a correção da corrida encontrada na revisão.
- Navegador Edge, com acessos externos bloqueados: recuperação FB e preservação de rascunho; FC abre enquanto FB permanece restaurando, sem login manual; atualização dos dois shells preserva dados locais e rascunho de outra janela. Três testes aprovados.
- Compilação FA/FB com autenticação FA–FE e corte para FB habilitados; `check-fa-runtime.mjs` aprovado. O Vite mantém aviso de chunk maior que 500 kB.

Os totais das suítes se sobrepõem. Ainda é necessária observação após publicação no aparelho em que o sintoma ocorre. Esta entrega altera os arquivos locais; não publica nem modifica o backend.

Referências: [persistência Auth](https://firebase.google.com/docs/auth/web/auth-state-persistence), [cache e sincronização Firestore](https://firebase.google.com/docs/firestore/manage-data/enable-offline).
