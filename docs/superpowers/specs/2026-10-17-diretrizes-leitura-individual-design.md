# Diretrizes: leitura no app e liberação individual do formulário

## Objetivo aprovado

Ao abrir uma Diretriz, o participante lê o PDF no app e conclui a etapa de leitura antes de obter acesso ao Google Form correspondente. O link direto do formulário também deve permanecer bloqueado para participantes sem conclusão válida. O usuário aprovou este desenho em 17/10/2026.

## Escopo e alternativas

Adotar leitor próprio de PDF e concessão individual de acesso no Google Forms pelo servidor. Apenas esconder o link não atende ao bloqueio externo. Substituir todos os Forms por formulários nativos ampliaria o escopo e afetaria integrações existentes; não faz parte desta mudança.

Aplicar inicialmente às Diretrizes. Preservar perguntas, respostas, referências originais dos materiais, regras de pontuação e revisão exclusiva do gestor. A leitura não concede pontos automaticamente. Não reintroduzir autenticação entre FA, FB e FC.

## Experiência

O título da Diretriz abre um leitor centralizado, dimensionado ao display, com navegação, progresso, rolagem e FECHAR no rodapé. A apresentação usa o PDF associado ao material original. Não usar o iframe do Drive como fonte de eventos de leitura, pois seu conteúdo é de outra origem e não oferece a observação necessária.

Apresentar CONCLUIR LEITURA E ABRIR FORMULÁRIO somente após todas as páginas terem sido apresentadas na sessão válida. Pausar a contagem de tempo quando a página estiver oculta. Não adotar tempo mínimo arbitrário como prova de compreensão. Exibir o formulário apenas depois da confirmação de acesso pelo servidor. Se houver falha, preservar o progresso confirmado e oferecer retomada explícita, sem duplicar concessões.

O registro atesta conclusão da etapa de leitura, não compreensão, atenção contínua ou identidade física da pessoa diante da tela. Telemetria do navegador pode ser manipulada; o sistema não promete impedir um participante determinado de simular leitura.

## Componentes e confiança

1. Leitor PDF próprio: renderiza páginas, acompanha visibilidade e envia progresso em lotes, sem gravar tokens ou dados pessoais em logs.
2. Serviço autenticado FA: valida assinatura e claims do token, perfil ativo, autorização atual e associação confiável entre documento, PDF e formulário. Não aceita UID, e-mail, quantidade de páginas ou versão declarados pelo cliente como autoridade.
3. Entrega privada do PDF: acessível somente após autorização, com origem Drive restrita a arquivos do catálogo, sem proxy de URLs arbitrárias, credenciais no frontend ou publicação irrestrita. A implementação deverá validar o transporte de bytes com os limites do ambiente existente antes de habilitar o fluxo; o preview do Drive não serve como substituto silencioso.
4. Registro de leitura confiável: persistido pelo servidor no FA, vinculado a UID, documento, versão do material, formulário e sessão. Escrita direta pelo cliente deve ser negada. Contém início e conclusão pelo relógio do servidor, progresso agregado e estado da concessão; não contém tokens.
5. Adaptador Google Forms: aproveita os controles existentes de permissões publicadas individuais, preservando proprietário e editores. Executa concessão idempotente e verifica o resultado antes de informar sucesso.

A interface pública deve limitar corpo, frequência, duração e concorrência. Comunicação privilegiada entre Worker e Apps Script deve usar autenticação HMAC, expiração, nonce e resposta autenticada. Nenhum endpoint público deve confiar apenas em CORS ou no e-mail enviado pelo navegador.

## Protocolo lógico

- Iniciar: servidor autentica FA, resolve catálogo e versão do PDF, cria sessão curta com identificador opaco e informa total de páginas confiável.
- Progresso: servidor valida proprietário da sessão, validade, versão e sequência; agrega páginas sem leituras ou escritas por segundo. Eventos duplicados são idempotentes e não transferíveis entre usuários.
- Concluir: servidor confirma autorização atual, sessão e cobertura de páginas, persiste conclusão e inicia concessão individual ao e-mail Google verificado e correspondente ao perfil autorizado.
- Abrir: somente retornar a URL oficial do formulário após verificar a permissão individual. Falha ou propagação pendente resulta em estado pendente, nunca em sucesso presumido.

Estados: EM_LEITURA → LEITURA_CONCLUIDA → LIBERACAO_PENDENTE → LIBERADO. Falhas não apagam conclusão válida. Troca de usuário encerra o contexto local e impede reaproveitamento da sessão anterior. Conclusão repetida não gera novas pontuações ou concessões duplicadas.

## Versões, revogação e limites do Google Forms

A versão deve representar o conteúdo do PDF, não apenas seu título ou caminho. Alteração do material invalida a conclusão anterior para a nova versão.

Permissões de respondente do Google Forms são por conta e formulário, não por versão do PDF. Antes de ativar uma nova versão, retirar as concessões de participantes da versão anterior e verificar a retirada; se a reconciliação falhar, manter o formulário fechado. A mesma política deve impedir que a rotina existente de publicação volte a conceder acesso a todo o grupo.

Na liberação, revalidar acesso ativo. A revogação posterior de um usuário exige reconciliar sua permissão no Google Forms; bloquear apenas o app não revoga um link já liberado. Preparar reconciliação orientada às alterações de autorização, sem varredura periódica de todos os perfis. Documentar e testar a janela entre detecção e confirmação da revogação.

Proprietários e editores conservam seus acessos técnicos e não estão sujeitos à mesma barreira de respondentes. Não remover privilégios técnicos para simular bloqueio absoluto.

## Implantação controlada e reversão

Manter a funcionalidade desligada durante a implementação. Não retirar agora o acesso dos participantes aos formulários existentes. Validar primeiro um fluxo isolado com conta aprovada, incluindo tentativa de acesso direto antes e depois da conclusão.

Na transição, salvar o inventário privado de permissões, fechar o formulário durante a reconciliação, retirar somente concessões publicadas incompatíveis com a política e reabrir após comprovação. Nunca transformar acesso restrito em anyone/domain/group aberto. Preservar originais, perguntas, respostas, editores e histórico.

A reversão desliga o novo fluxo e restaura somente a audiência restrita previamente aprovada a partir do inventário, com verificação. Registros de leitura permanecem preservados. Configuração externa, publicação e alteração efetiva de permissões exigem execução controlada posterior; este documento não representa implantação.

## Validação exigida

- Usuário autorizado conclui leitura e recebe somente seu acesso; outro usuário não o herda.
- Link direto negado antes da liberação e permitido depois, com a conta correta.
- Progresso incompleto, sessão expirada, adulteração, replay e troca de UID são rejeitados.
- Conta inativa ou revogada não recebe concessão.
- Versão alterada exige nova conclusão e não reaproveita concessões antigas.
- Falhas de PDF, rede, Apps Script e propagação de permissões preservam estado e falham de modo seguro.
- Concorrência e reenvios não duplicam conclusão, pontuação ou permissão.
- Rotina antiga de publicação não contorna a política individual.
- Proprietários/editores preservados; logs sem tokens, URLs temporárias ou dados pessoais.
- Build, testes locais e prova autenticada real são evidências distintas; nenhuma será apresentada como substituta das demais.

## Critério de aceite

Leitor utilizável no celular dentro do app, avanço preservado por usuário e versão, liberação verificada no Google Forms, bloqueio externo real para participantes ainda não liberados e ausência de alterações em pontuação ou autenticação principal. Validar limites de PDF, cotas e permissões com o ambiente gratuito; não habilitar faturamento como solução automática.
