# FA: entrada com cache de apresentação

> Execução nesta sessão. Especificação fornecida e confirmada pelo proprietário em 08/11/2026: FA só entrada, botões e autenticação; Home usa cache local; consulta de Escala somente após abrir FJ. Não restaurar pontuação, Forms nem centralização.

**Objetivo:** remover consultas antecipadas dos quatro módulos e manter a abertura da Home independente deles.

**Arquitetura:** o shell e suas imagens continuam no Service Worker existente. `home-entry-cache.js` mantém somente uma projeção de Escala/férias já lida pelo módulo, por UID e data, em armazenamento local. Nenhuma API de rede, credencial, permissão ou fila de escrita entra nesse cache. `#/schedule` realiza as consultas FJ explicitamente; `#/home` só lê a projeção. Perfis FG/FH são carregados ao abrir seus módulos.

**Limites escolhidos na implementação:** 14 datas por usuário, sete dias de validade, 128 KiB estimados por usuário. Sem dados de pacientes, contatos pessoais ou marcadores de confirmação operacional. Fonte FJ fixa. O perfil FA permanece validado pelo servidor; a cópia local nunca autoriza operações. Revogação no módulo é verificada quando ele é aberto; uma prévia local não comprova permissão atual em FJ.

- [x] Confirmar log de remoção: 20 acionadores, zero restantes para a conta executora.
- [x] Comparar editor FA e versões publicadas 45/54/55; registrar hashes sem sobrescrever fontes remotas divergentes.
- [x] Remover rota/interface de pontuação FA na fonte local e testar link antigo.
- [x] Implementar cache limitado, isolado e com tolerância a falha de armazenamento.
- [x] Separar Home local e consulta explícita de Escala; validar ausência de fallback FA na abertura explícita.
- [x] Adiar leitura de perfis Checklist/Etiquetas até entrada no módulo.
- [x] Testar vazio, retorno, expiração, troca de conta, revogação e resposta tardia.
- [ ] Homologar navegação real e layout no navegador.
- [ ] Publicar frontend após validação e verificar os arquivos servidos.
- [ ] Completar auditoria de todos os consumidores e configurações FA–FJ.
- [ ] Comparar 24 horas completas após o corte com a janela anterior.

**Decisão sobre Apps Script novo:** não criar um projeto vazio apenas para substituir o antigo. O cache é cliente. Avaliar a necessidade de um backend mínimo somente se uma dependência ativa de autenticação exigir isso. As versões históricas do Apps Script ainda precisam de prova dos consumidores antes de sua exclusão.
