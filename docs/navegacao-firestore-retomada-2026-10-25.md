# Retomada de conexão entre FA e FB — v246

## Problemas reproduzidos

- A segunda notificação de suspensão substituía os escopos já salvos por uma lista vazia. Os relatórios fechados deixavam de ser reabertos no retorno.
- O app não tratava `pagehide`. O retorno de uma página preservada no histórico dependia exclusivamente da entrega de `visibilitychange`.
- Uma recuperação anterior continuava válida enquanto a página estava oculta; outra recuperação podia permanecer associada à mesma promessa interrompida.
- Uma leitura que ultrapassasse o prazo permanecia associada à promessa rejeitada até a resposta original do SDK. Se interrompida durante a navegação, uma nova tentativa reutilizava indefinidamente o resultado antigo.
- A revalidação do perfil aguardava o envio da fila antes de permitir a retomada dos listeners.

## Correção

As notificações de saída preservam os escopos e suspendem o módulo uma única vez. `pagehide` e `visibilitychange` compartilham esse tratamento. A recuperação invalida operações antigas e só retoma a página visível, online e com a identidade atual. Os escopos continuam sujeitos às verificações existentes de usuário, permissão, rota e elemento conectado.

Leituras explicitamente interrompidas por saída da página ou perda de rede podem ser substituídas somente depois do timeout e da pausa existente. Consultas ainda ativas continuam compartilhadas. Respostas antigas não entregam dados aos observadores da consulta nova nem a removem. Uma resposta tardia de cota continua impondo a pausa global.

A fila continua sendo enviada em segundo plano, pelos mecanismos existentes de envio e deduplicação. Sua conclusão não é uma condição para retomar a navegação. A autenticação automática e os UIDs de FA, FB, FC, FD e FE não foram alterados. Nenhuma regra, dado remoto ou permissão foi modificado.

## Validação

- Regressões locais: 186 testes de autenticação/navegação; 184 de operação offline; 1.019 de domínio, sem falhas (as suítes têm sobreposição).
- Testes direcionados cobrem suspensão repetida, retorno sem evento de visibilidade, resposta de recuperação antiga, troca de identidade, fila interrompida, leitura substituída e manutenção da pausa por cota.
- Edge isolado: quatro ciclos FA → FB → voltar, restaurando o mesmo documento do histórico (`pageshow.persisted = true`), com uma reconexão de cada relatório por ciclo. Dados e sessão sintéticos; não é uma sessão autenticada de produção.
- Regressão Edge de FC → Home: aprovada com leituras lentas, reentrada e armazenamento local pendente.
- Compilação independente de FA e FB: aprovada. Shell atualizado para v246 em ambos os destinos.

O teste do navegador usa a ligação de eventos extraída do código de produção. O teste autenticado no dispositivo do usuário continua sendo a confirmação do comportamento nas condições reais de sua rede.
