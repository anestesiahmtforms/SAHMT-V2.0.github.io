# Abertura e ampliação no leitor — versão 225

## Abertura

O motor PDF começa a carregar enquanto o serviço prepara a sessão autorizada. Antes, o download do motor aguardava a resposta completa do serviço.

O serviço agrupa a consulta de perfil, público, catálogo e configuração do treinamento em um `batchGet` por projeto, usando o roteador existente. No FB, seis viagens sequenciais viram uma. Cada documento continua sendo lido: isto reduz latência de rede, não transforma seis documentos em uma leitura faturável. As permissões são consultadas novamente a cada ação, sem cache global. Respostas incompletas, duplicadas ou de outro caminho são rejeitadas.

A configuração já lida dentro da transação é reutilizada na mesma transação, evitando uma consulta repetida. A concessão do formulário continua fazendo sua verificação final de acesso.

## Ampliação com dois dedos

O gesto dentro da página amplia o próprio documento entre 100% e 300%. Durante o movimento, reutiliza o bitmap; ao soltar os dedos, renderiza uma vez na resolução adequada. O gesto não deve ampliar a interface inteira nem gerar um clique de fechamento. O diálogo não aceita cancelamento implícito: o botão FECHAR permanece disponível.

Rolagem com um dedo, controles +/−/AJUSTAR, contagem de páginas e limites de memória são preservados. Nenhuma chamada de rede é feita pelo zoom. Páginas só são contabilizadas fora do gesto, após renderização bem-sucedida.

## Validação

Testes do serviço cobrem consulta agrupada, acesso revogado e resposta incompleta. A regressão de navegador cobre PDF real, gesto de dois dedos, permanência do diálogo, ausência de chamadas extras no zoom e liberação após leitura. A validação física do gesto no iPhone depende do aparelho do usuário; o teste automatizado reproduz os eventos de toque em navegador local.
