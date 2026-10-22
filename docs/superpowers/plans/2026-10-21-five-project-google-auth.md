# Entrada Google em cinco projetos — implementação revisável

Pedido: uma interação Google, cinco sessões independentes, sem migração de dados nesta etapa. FA continua funcionando se um destino falhar. Configuração e correspondência de identidades são pré-condições de ativação. QMENTUM e a migração de Gestão permanecem no estado anterior, sem corte de produção.

## Contrato

- FA `sahmt-17a16`; FB `sahmt-gestao-5ae66`; FC `indicadores---sahmt`; FD `rotinas-8a617`; FE `outros-48120`. Confirmar por API antes de gerar configuração Web.
- Uma confirmação explícita pelo botão Google oficial do GIS, depois da sessão FA. O token Google é revalidado pela reautenticação da conta FA já existente e usado somente em memória para criar sessões nos demais projetos; nunca reutilizar token Firebase FA em outro projeto. SDK mantém sessões.
- Bloquear destinos sem configuração validada; verificar identidade Google e UID sem criar contas silenciosamente. Investigar `autoCreate:false` antes de utilizar o SDK nos destinos.
- Restaurar Auth antes de decidir que precisa de login, sem consultas Firestore para manter sessões. Concorrência limitada a dois destinos, tentativas transitórias limitadas, sem timers de manutenção.
- Marcador local de progresso por UID/instalação/release, sem tokens ou concessões de permissão. Revalidar com as sessões reais, nunca usar marcador como autenticação.
- Chamada ATUALIZAR O APP disponível a partir de 22/10/2026 00:00 America/Sao_Paulo, exclusivamente quando o pacote tiver sido validado e habilitado.
- Sair encerra todas as sessões, inclusive persistidas ainda não inicializadas. Troca de conta invalida trabalho em andamento; filas offline continuam vinculadas ao autor.
- Service worker não força ativação no meio da sessão nem apaga bancos/fila offline. Guardar assets antigos para abas já abertas.

## Etapas

1. Auditoria externa limitada: configurações, provedores, OAuth, Auth e perfis; relatório privado sem segredos no código/log.
   - Evidência visual do usuário em 22/10/2026 confirma o Web Client ID FA na lista de clientes externos permitidos de FB, FC, FD e FE.
   - Relatório real fornecido pelo usuário, observado em 22/10/2026 às 18:50:45.404Z (15:50:45 de São Paulo), origem localhost:5197: `AUTH_PROOF_CONNECTED`, uma confirmação Google, reautenticação FA aprovada e `exchange=passed` nos quatro destinos. Nos cinco projetos, `uidMatchesFa=true` e `googleIdentityMatchesFa=true`; zero leituras/escritas Firestore. Isso comprova o fluxo para a identidade piloto naquela origem; não comprova todos os usuários, persistência, logout ou origem de produção.
   - Segundo relatório fornecido pelo usuário, observado em 22/10/2026 às 18:55:52.694Z (15:55:52 de São Paulo), após recarregar a página: `AUTH_RESTORE_OBSERVED`, cinco sessões conectadas com correspondência de UID/identidade Google, zero confirmações Google e `exchange=not_attempted` nos quatro destinos. Restauração SDK confirmada nessa sessão de navegador; não é prova específica de iOS nem da origem de produção.
   - Terceiro relatório fornecido pelo usuário, observado em 22/10/2026 às 18:57:33.927Z (15:57:33 de São Paulo): `logout=complete` e os cinco projetos `disconnected`. `AUTH_SOURCE_REQUIRED` e a ausência de correspondência da identidade piloto são esperados porque o usuário acabou de sair. Saída conjunta confirmada nessa sessão de navegador.
   - Após configurar o cliente Web FA, o usuário confirmou que `https://anestesiahmtforms.github.io` ficou salva nas origens JavaScript autorizadas. Isso confirma a configuração declarada da origem pública; a execução real nessa origem e em iOS ainda não foi observada nesta etapa.
2. Coordenador independente do SDK + testes de falha, concorrência, restauração, saída e troca de usuário.
3. Adaptador Firebase direto + verificação de conta existente + registro de configurações verificadas, mantendo a ativação desligada até evidência real.
4. Painel de atualização, progresso e retomada; integração com login/saída existentes sem bloquear perfil/Home.
5. Coordenação segura do service worker; testes de preservação de filas e sessão.
6. Testes direcionados, build FA/FB, revisão e relatório. Prova de dispositivo real separada de mocks. Após a entrega revisável e as provas de entrada/restauração/saída, o administrador autorizou a publicação em 22/10/2026, mantendo a migração de Gestão desligada.

## Reversão

Desabilitar somente a flag da entrada Google múltipla; manter Auth FA e bancos/filas existentes. Não revogar sessões nem excluir dados para reverter a interface. O trabalho prévio de migração permanece preservado e não é ativado por esta alteração.

## Pacote de publicação preparado

O workflow prepara somente FA com `node scripts/build-independent-apps.mjs --fa-only`, `VITE_GOOGLE_PROJECT_AUTH_ENABLED=true`, `SAHMT_FB_CUTOVER=false` e os flags antigos de broker e primeiro login especial desligados. O pacote não contém a aplicação independente `/gestao/`; os componentes dessa migração permanecem na worktree. O build padrão FA/FB continua disponível separadamente para a migração preparada.

Reversão da ativação: trocar somente `VITE_GOOGLE_PROJECT_AUTH_ENABLED` para `false` no workflow e reconstruir/publicar o pacote FA. Não limpar IndexedDB, filas, perfis ou contas. Qualquer publicação depende da autorização específica posterior à entrega revisável. A prova realizada cobre a identidade administrativa Google vinculada; cadastros sem vínculo Google não são vinculados pelo e-mail automaticamente e precisam de tratamento próprio antes de ampliar seu acesso aos destinos. As sessões Auth não concedem permissões nem criam perfis.

## Prova local assistida

`tests/fixtures/five-project-google-auth-proof.html` é uma página exclusiva do servidor de desenvolvimento em loopback. Ela reutiliza o adaptador, o botão Google e as configurações reais; não entra no build de produção. A ativação da produção continua bloqueada até registrar prova real. A página aceita apenas a sessão FA do UID administrativo previamente autorizado e não oferece criação de conta, concessão de acesso nem consultas Firestore.

1. No mesmo navegador e na mesma origem local, abrir o app local, entrar com a conta administrativa autorizada e retornar à página de prova. A entrada usual do app pode consultar seu perfil FA; a página de prova não consulta Firestore.
2. Na prova, tocar no botão Google uma vez e escolher a mesma conta. Copiar o relatório. Para cada destino, `exchange=passed`, `uidMatchesFa=true` e `googleIdentityMatchesFa=true` comprovam a consulta Auth da conta existente e a conexão SDK correspondente. `connected` com `exchange=not_attempted` indica apenas sessão já persistida, sem nova prova de troca.
3. Reabrir a página e conferir as sessões salvas, sem outra confirmação Google. Depois testar a saída e copiar o segundo relatório. Todos os projetos devem ficar `disconnected` e `logout=complete`.
4. Se o Google recusar a origem, conferir no cliente OAuth Web FA a origem JavaScript exata `http://localhost:5197`. Isso é configuração do cliente Google, diferente da lista Firebase de clientes externos. A origem de produção `https://anestesiahmtforms.github.io` também precisa ser conferida antes da publicação.

O relatório contém somente estados, códigos sanitizados, contagens e correspondências booleanas. Não contém UID, e-mail, credencial Google, token Firebase ou conteúdo de perfil. O relatório comprova autenticação; não comprova autorização para ler dados de módulos nem funcionamento de dispositivos iOS.
