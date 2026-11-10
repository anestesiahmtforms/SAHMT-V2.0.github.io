# Controle de leitura por pasta

## Requisito confirmado

Somente o administrador ativa e desativa pastas. Uma pasta desativada bloqueia a abertura e a leitura de todos os seus descendentes. Os nomes podem aparecer com os controles inativos. Para abrir, o administrador primeiro ativa a pasta. Reativar o pai preserva as subpastas desativadas individualmente. A autorização para alterar o estado é confirmada no servidor.

## Decisão de implementação

Guardar somente desativações explícitas e resolver todos os ancestrais antes de ler conteúdo. O índice de navegação guarda IDs, caminhos, títulos e os dados mínimos para aplicar as permissões de público. O serviço filtra IDs antes das consultas de conteúdo. O app descarta respostas antigas e fecha o leitor ao receber uma mudança de política. A tela de uma pasta já aberta pode manter os títulos em controles desabilitados.

## Entrega local em Treinamentos

Para acervos legados, o administrador usa **Preparar controle de pastas** uma vez com as pastas ativas. O Worker prepara o índice dentro de uma transação. A pontuação geral reúne registros de várias pastas, então a consulta fica indisponível enquanto houver desativações. As atividades em pastas ativas continuam registrando seus pontos. O total é recalculado quando a consulta volta a ficar disponível.

O frontend depende da regra FB de leitura exclusiva do documento `htmlTrainingSettings/folders`. Publicar essa regra e o Worker atualizado antes do frontend. Os módulos restantes e suas rotinas de segundo plano ainda dependem da integração da matriz de cobertura.

O ecossistema não tem um gateway único: dados, Firestore Rules, Workers, Apps Script, Durable Objects e leitores locais devem compartilhar o contrato e ser integrados individualmente. Filtros após leitura e botões que somente ocultam conteúdo não atendem ao requisito. Uma regra Firestore genérica de negação não revoga permissões concedidas por outros matches.

## Entregas e validação

1. Resolver comum de política e barreira antes/depois da operação assíncrona, com testes de hierarquia, estados independentes, falhas e revogação concorrente.
2. Corrigir o serviço e a navegação de Treinamentos: índice transacional, bloqueio anterior a leituras, profundidade variável, controles administrativos sem conteúdo bloqueado e testes instrumentando leituras reais do adaptador.
3. Integrar registro canônico aos caminhos de interface e aos leitores restantes da matriz `folder-read-control-coverage.md`; incluir cancelamento de listeners, filas, gatilhos, caches e sockets.
4. Publicador administrativo precisa confirmar a revisão em todas as fontes afetadas antes de apresentar desativação concluída. Falha parcial deve permanecer pendente e impedir sucesso falso.
5. Publicar e conferir Rules, frontends, Workers e versões Apps Script. Verificar no navegador e nos consumidores de produção que não há consultas de conteúdo bloqueado. Controle de política/autenticação continua podendo exigir operações; não prometer consumo zero nem economia quantitativa sem medição.

## Limites de comprovação

Testes locais não comprovam implantação remota. Versões antigas, consumidores externos e acionadores de outras contas precisam de inventário e conferência. Operações já enviadas antes de uma desativação não podem ser retroativamente desfeitas; o leitor deve impedir entrega de respostas após revogação e impedir operações posteriores.
