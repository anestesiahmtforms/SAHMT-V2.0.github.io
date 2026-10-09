# Gestão em FB: pacote para revisão

Esta preparação conserva a PWA como entrada única e mantém os módulos operacionais em FA. A implantação em FB ainda não foi aplicada.

## Projetos

| Referência | Projeto | Uso |
| --- | --- | --- |
| FA | `sahmt-17a16` | Login inicial, operação e apresentação de Desempenho. |
| FB | `sahmt-gestao-5ae66` | Destino preparado para Gestão. |

Os preflights de 8 de outubro de 2026 confirmaram Spark, faturamento desabilitado, Firestore `(default)` em São Paulo, Google Auth e domínio da PWA. São provas daquela verificação; antes de aplicar mudanças, o contexto deve ser conferido novamente.

## Resultado preparado

- Backup protegido e verificado: 365 documentos em 43 árvores selecionadas de FA. Em FB, as 44 árvores selecionadas estavam vazias. Isso não é uma exportação global nem um snapshot atômico com Authentication.
- Plano offline: **134 cópias propostas e 231 registros mantidos em FA**. Ensaio com dados em memória: 134 pares de documento/proveniência; repetição sem novas gravações e conflito interrompido.
- Auth: sete contas Google propostas para importação e 53 adiadas sem vínculo Google demonstrado. Nenhuma conta foi importada ou recebeu acesso.
- Nove campos de autoria histórica preservados com ator arquivado sem conta, membro ou concessão.
- 935 testes focados em 20 arquivos e build aprovados nesta preparação; os testes usam fixtures/adaptadores locais. Cinco checks adicionais de SQLite Durable Object local não comprovam servidor produtivo.

A [simulação v2](management-private-split-preview-v2.md) registra contagens, hashes, cobertura, vínculos e limites da prova. A [prévia de autorização](management-authorization-preview.md) separa evidência de origem de propostas, mantendo superfícies e concessões desativadas. A intenção humana mais recente sobre os dois atores foi preservada em arquivo cifrado separado, sem alterar a prévia anterior. Os arquivos com dados permanecem cifrados fora do Git, protegidos pelo perfil Windows atual; recuperação fora desse perfil ainda exige um plano portátil próprio.

## Acesso e sessão

A rota Gestão do código de referência é restrita a administradores. Membership, grupos de documentos ou permissões granulares isoladas não autorizam ampliar essa superfície. A preparação não reativa homologação, treinamentos ou permissões canceladas. A regra humana mais recente define um administrador e gestor geral designado, mantém os demais como usuários e preserva as permissões previamente definidas da conta de exceção. O vínculo dessas contas deve ser comprovado por UID e identidade Google; a intenção registrada não modifica perfis, roles ou grants por si só.

FA e FB exigem sessões próprias. O caminho proposto para um único login usa uma ponte dedicada, validação de identidade/direitos e token FB emitido no servidor. Host, gateway, identidade Google administrativa e consentimento nativo ainda não estão implementados. A alternativa de reconexão Google explícita também exige conciliação dos UIDs e permissões.

## Antes de aplicar

1. Firmar a escolha de login/host e preparar o gateway, IAM mínimo e a ação nativa específica para o ator correto.
2. Reconciliar a regra humana de administrador único e exceção com os vínculos de membro e projeções de permissões/público; conferir contexto fresco, revogação e orçamento de cada projeto antes das operações. Flags e relações históricas divergentes não autorizam acesso no destino.
3. Integrar Rules, sessões, produtores, cache/filas e consolidação de Desempenho; preservar destino e IDs das pendências FA.
4. Revalidar Drive/Forms e ensaiar pessoa real, logout, falha FB, duplicação, revogação e iPhone/Safari. Para os dois pontos de revisão do gestor, a unidade material/versão está confirmada; decisões elegíveis e modo de confirmação ainda precisam ser definidos no [contrato](management-manager-review-contract.md) antes de ativar créditos.
5. Apresentar as provas e reversão para a autorização de mudança produtiva exigida no pedido original. Após a migração, obter a validação humana antes de interromper os escritores antigos FA.

FA tem limite operacional aprovado de 45.000 leituras diárias, incluindo app e rotinas. FB tem controle independente. A captura de uso enviada pelo usuário autorizou uma janela específica de backup; essa janela já foi consumida. Nem a estimativa do painel nem a reserva local representam teto global exato ou consumo atual confirmado.

## Reversão

Antes de escritas em FB, a reversão consiste em manter o roteamento/código de referência; FA permanece preservado. Depois de novas escritas, bloquear consumidores de Gestão, conservar filas e recibos, capturar/reconciliar o delta FB e somente então decidir sobre reabrir escritores FA. Reverter apenas a tela não reconcilia dados de negócio. Não apagar dados, contas ou checkpoints.

O catálogo futuro mantém a decisão de 75 treinamentos, sem substituto para o ROP acidental. O processo anterior de liberação segue cancelado. Backup, simulação e publicação de código não comprovam disponibilidade do catálogo ou validação por participante real.
