# Treinamentos HTML — regras funcionais aprovadas

Registro das decisões do usuário em 25/10/2026. Este documento consolida o
comportamento desejado; não representa implementação ou publicação do novo
modelo. O usuário converteu os documentos de referência para Google Docs e
confirmou as quatro pastas oficiais para o acervo.

## Pastas oficiais de referência

Referências confirmadas novamente pelo usuário em 25/10/2026:

- [Diretrizes](https://drive.google.com/drive/folders/1tntfwdWsjIAtFxl9m7lJTqNFggoTgqip).
- [Documentos administrativos](https://drive.google.com/drive/folders/1nr2ez2dBa24ck62AG5ZP9F5-Dmq4vEiq).
- [Protocolos](https://drive.google.com/drive/folders/1yyxztSUyMks2xt9Np7OGTfuP0BqnnmoL).
- [ROPs - Anestesiologia HMT](https://drive.google.com/drive/folders/1dRLWZZwY-_34JB-ppi_W266kpFvyLCBj).

O inventário de preparação já abrange essas quatro pastas. Conferir a revisão
atual de cada documento antes da futura importação, mantendo os vínculos dos
textos, bancos de questões e instrumentos de auditoria. A confirmação das
referências não representa importação ou ativação dos treinamentos.

## Unidade de treinamento

Cada item HTML representa um treinamento completo: texto, ciência da leitura,
cinco questões de avaliação e etapa de sugestões opcionais. O modelo deverá
atender os treinamentos compatíveis do PWA, dispensando Google Forms e Apps
Script nesse novo fluxo de participação.

O termo “gestor da questão”, usado na definição, refere-se ao gestor desse item
HTML completo, e não ao responsável por uma das cinco perguntas da avaliação.

## Participação e tentativas

- Cada participante terá no máximo duas tentativas no treinamento.
- A maior nota das tentativas concluídas será preservada; as notas não serão
  somadas.
- A segunda tentativa exigirá novamente todo o fluxo: leitura integral do texto,
  ciência, avaliação com cinco questões e etapa de sugestões.
- O preenchimento da sugestão será opcional nas duas tentativas.
- A repetição não duplicará a pontuação de ciência.
- O controle de tentativas e de pontuação deverá ser confirmado pelo servidor,
  inclusive para acessos por aparelhos diferentes. A proposta registrada é
  contabilizar a tentativa na confirmação do envio da avaliação, evitando
  consumo por mera abertura ou interrupção.

## Gestor e administrador

- O administrador poderá indicar individualmente o gestor de cada treinamento.
- O gestor responsável poderá editar e publicar diretamente o texto e as cinco
  questões, sem aprovação prévia do administrador.
- O administrador poderá reeditar e publicar o texto e as questões, alterar o
  gestor responsável e corrigir a pontuação das sugestões a qualquer momento.
- O acesso de edição e análise do gestor ficará restrito ao treinamento sob sua
  responsabilidade.
- Alterações deverão preservar histórico de autor, data e valores anteriores.

Atualização autorizada em 25/10/2026: publicar os 66 materiais imediatamente,
mantendo a gestão somente com os administradores; gestores por treinamento
serão indicados posteriormente. Campo de gestor vazio representa gestão
administrativa e não concede edição a outros usuários. Pendências de revisão
continuam registradas no editor; publicar por decisão administrativa não equivale
a declarar revisão institucional concluída. A decisão e sua autoria são preservadas.

## Sugestões e pontuação única

- As sugestões recebidas serão consultadas e tratadas somente dentro da área
  “Editar treinamento”, junto da revisão do conteúdo e das questões.
- O gestor poderá aproveitar as sugestões na revisão do material, preservando o
  texto original enviado pelo participante.
- A decisão de conceder pontos será exclusivamente manual, pelo gestor
  responsável ou pelo administrador. Envio e uso da sugestão em uma revisão não
  concederão pontos automaticamente.
- Cada participante poderá receber pontuação por sugestões uma única vez no
  mesmo item HTML. Uma segunda tentativa não criará outra concessão.
- Gestor e administrador compartilharão o mesmo controle: nenhum poderá repetir
  a concessão já registrada, inclusive em ações simultâneas.
- A troca de gestor não reiniciará esse direito.
- O máximo será de 2 pontos. O administrador poderá corrigir o valor entre 0 e 2.
- A correção substituirá o valor vigente do mesmo registro; não será uma nova
  premiação. Exemplo: corrigir 2 para 1 deixará 1 ponto, sem somar outro crédito.
- Os pontos concedidos continuarão refletidos no Desempenho do participante.

## Cache do conteúdo

- O dispositivo guardará o conteúdo após seu primeiro carregamento/leitura para
  evitar baixar novamente o mesmo texto do Firestore.
- A segunda tentativa utilizará o conteúdo local e repetirá todas as etapas
  obrigatórias de participação.
- A proposta é identificar o cache por conta, treinamento e versão, verificando
  autorização e atualização antes de reutilizar o material.
- Uma publicação alterada deverá ser reconhecida pelo PWA para atualização da
  cópia local. O gabarito não fará parte do conteúdo entregue ao participante.

## Proteção contra cópia, impressão e captura

O usuário solicitou incluir no projeto proteção dos textos contra cópia e print.
O requisito será aplicado à visualização dos materiais de treinamento pelos
participantes. A implementação ainda será realizada junto do leitor HTML.

- Restringir seleção, cópia, recorte, arraste e menu de contexto do conteúdo
  protegido na interface, incluindo os atalhos correspondentes quando o
  navegador permitir interceptá-los.
- Na impressão ou em salvar como PDF pelo navegador, ocultar o conteúdo do
  treinamento e mostrar uma mensagem de material protegido, usando estilos de
  impressão específicos do leitor.
- Incluir marca d'água legível e discreta com identificação do usuário e data,
  como medida de desestímulo à redistribuição e às capturas de tela.
- Entregar o conteúdo somente após verificar conta e autorização; participantes
  não receberão acesso aos documentos de referência do Drive pela interface.
- Restringir as medidas à leitura protegida. O editor autorizado do gestor e do
  administrador, os campos de respostas/sugestões e os relatórios operacionais
  conservarão as funções necessárias à edição, acessibilidade e uso normal.

Limites técnicos que devem permanecer explícitos: os controles da interface e
os estilos de impressão não constituem DRM ou bloqueio absoluto de extração.
Um PWA comum não pode garantir impedir screenshots/gravações feitos pelo sistema
operacional, extensões, ferramentas externas ou fotografia com outro aparelho.
Não anunciar bloqueio universal de Print Screen nem usar detecção de teclado ou
de perda de foco como prova de que houve captura. O conteúdo entregue ao
navegador e mantido no cache local também não é inacessível a um usuário
tecnicamente habilitado. Manter o cache por conta e versão e nunca incluir nele
gabaritos, segredos ou credenciais de servidor.

## Preparação dos documentos e decisões posteriores

O trabalho começará pela nova pasta de referência do Drive que o usuário enviará,
usando os materiais atualizados como fonte inicial. A primeira etapa será
Protocolos, com as subpastas Protocolos da Anestesiologia e Protocolos da
Instituição. As demais áreas com treinamentos e pontuação adotarão o modelo
gradualmente. A preparação deverá identificar e tratar os vínculos do fluxo antigo
de PDF/Forms, preservando configurações operacionais e registros aproveitáveis.

Os documentos Google Docs fornecidos pelo usuário serão a fonte inicial para
conversão em conteúdo HTML.
Foi proposta uma área de edição visual com Conteúdo, Avaliação e Sugestões
recebidas, além de rascunho, visualização e publicação. O formato e a fidelidade
da conversão deverão ser avaliados com os arquivos reais.

## Edição no PWA e referência no Drive

O usuário escolheu realizar as alterações pelo editor do PWA, evitando a
necessidade de acessar o Drive para editar. Isso abrange tanto o texto quanto o
banco de questões mantido em documento Google Docs na pasta de referência.

A direção escolhida é PWA → Drive: após a publicação de alterações, um serviço
autorizado deverá atualizar os respectivos documentos de referência, sem usar
Apps Script nem fazer chamadas ao Drive durante a leitura dos participantes.
O vínculo entre o item do PWA e seus arquivos de texto/banco deverá ser explícito.

O banco completo de questões e as cinco questões selecionadas para a avaliação
serão tratados como conjuntos distintos. A seleção ou revisão das cinco questões
não deverá apagar as demais questões do banco. O editor deverá permitir trabalhar
nesse banco de questões pelo PWA.

Foram propostos histórico, verificação de conflitos e indicação de sincronização
concluída, pendente ou com erro. O formato escolhido para a referência no Drive
é Google Docs, após a conversão realizada pelo usuário. A fidelidade da conversão
de texto, tabelas e imagens entre o editor do PWA e os documentos deverá ser
conferida com os materiais reais.

## Auditoria vinculada a cada ROP

Em 25/10/2026, o usuário incluiu uma nova pasta com 22 ROPs, organizada em seis
áreas. Cada tema possui matéria de estudo, avaliação com cinco questões e um
modelo operacional de auditoria. Os 66 Google Docs foram inventariados no
acervo privado de preparação; acrescentam 110 questões ao conjunto anterior.
O acervo consolidado de preparação tem 66 itens de treinamento e 545 questões,
além de 22 modelos de auditoria. Esses modelos não são questões de avaliação.

O usuário solicitou incorporar o modelo de auditoria a um botão em cada HTML da
ROP correspondente e definiu expressamente que o botão aparecerá **somente para
gestor e administrador**. O gestor usa o vínculo individual ao treinamento; o
administrador pode acessar todas as ROPs autorizadas no ambiente institucional.
O participante não verá nem abrirá esse painel. A verificação do vínculo e da
permissão deverá ocorrer também no servidor, em cada leitura e gravação.

A prévia implementada adota um banner “Auditoria desta ROP” e um painel com seis
etapas: identificação, testes da ROP, coleta de casos, verificações de apoio,
evidências e ações, revisão e conclusão. Essa organização é uma decisão de
implementação para tornar o preenchimento contínuo e compreensível. O conteúdo
dos testes T e das verificações A/V vem do modelo específico fornecido.

- T usa resultados C, NC, P e NA. NA exige justificativa e identificação de quem
  validou a não aplicabilidade; C e NC exigem referência da evidência.
- NC e P exigem descrição e ação relacionada, com responsável e prazo. O
  encerramento de uma ação exige registro da implementação e da eficácia,
  validador e data. A auditoria pode concluir como não conforme com ações abertas.
- A e V permanecem verificações separadas. Perguntas formuladas no sentido de
  detectar um erro não convertem uma resposta afirmativa em conformidade.
- Na coleta, C e NC formam o denominador da adesão. NO (não observado) e NA
  (não elegível, justificado) são informados separadamente. Denominador zero
  não produz taxa. A adesão da amostra não substitui a conclusão dos testes.
- Conclusão de auditoria não concede pontos nem modifica a nota do treinamento.
  Conclusões preservam o registro; uma nova auditoria não apaga a anterior.
- Coletas usam referências anônimas. Documentos de circulação geral não devem
  carregar identificadores pessoais dos pacientes.

A prévia guarda rascunhos e conclusões apenas no navegador e permite exportação
JSON. O seletor de perfil serve somente para conferência local. Não representa
autenticação ou autorização em produção. Nenhuma auditoria foi gravada no
Firestore; nenhum treinamento foi ativado. A integração real deverá implementar
identidade verificada, isolamento por treinamento, armazenamento compartilhado,
controle de conflitos e histórico de autor/data/versão.

Os modelos citam manuais Qmentum 2022 e Serviços de Anestesia 2023. A pasta não
inclui esses manuais: correspondência exata dos requisitos, páginas, limites e
edição contratada permanece sujeita à conferência institucional. Os textos
didáticos e os instrumentos não foram apresentados como manuais oficiais do
acreditador. As questões têm gabarito coerente, mas precisam de revisão dos
distratores repetidos e do padrão previsível das letras corretas antes do uso.

## Detalhes ainda a especificar para o novo leitor

Não há treinamento iniciado a migrar. A política de novas tentativas após
revisões futuras não foi definida e não deve ser presumida como aprovada.
Armazenamento das imagens, detalhes da validação do servidor e implementação
do editor ainda deverão ser especificados antes de construir o novo fluxo.

## Suspensão do fluxo anterior

Em 25/10, o usuário substituiu a estratégia de somente bloquear funções pela
exclusão definitiva do leitor PDF/e-book, sua ponte e seus preparadores. A área
Gestão de Documentos está em FB, junto do módulo Desempenho, que receberá os
resultados dos novos treinamentos. Preservar usuários, histórico e regras de
pontuação de Desempenho. A exclusão de código não autoriza apagar dados.

O usuário confirmou que **os conteúdos HTML ficarão no Firestore de FB** e
enviará as referências reais dos arquivos antes da importação. As prévias locais
não devem ser tratadas como catálogo publicado. O cache por versão no dispositivo
continua previsto para evitar leituras repetidas; gabaritos e validação de notas
exigem acesso restrito no servidor. Nenhum conteúdo novo foi importado nesta etapa.

A discussão e o novo modelo não autorizam reativar as leituras PDF de Gestão,
a sincronização automática de PDFs ou seus preparadores no Apps Script.
Permanece válida a suspensão registrada em
`management-pdf-reading-pause-2026-10-24.md`, independentemente da recuperação
da disponibilidade do Apps Script.
