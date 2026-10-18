# Publicação de materiais de treinamento em PDF

O original editável e o gabarito ficam na revisão protegida. O participante recebe o PDF sincronizado. A validação de publicação acompanha essa separação.

## Validações

- O resolvedor aceita somente um vínculo DOC→PDF da configuração privada do servidor. Confere pastas, proprietário, checksum, versão de origem e ausência de conversão ou revisão pendente.
- O link apresentado em Material de apoio deve ser o PDF validado. Uma referência remanescente ao DOC privado bloqueia a publicação.
- O PDF exige exatamente os leitores do público autorizado, além do proprietário e do administrador de referência. O administrador pode ser leitor; edição do PDF não é requisito para consumir treinamento.
- Permissões herdadas são avaliadas pelo acesso efetivo. Acesso público, pessoa adicional, editor desconhecido, expiração e proprietário divergente permanecem bloqueados.
- A exceção para a pasta compartilhada de ROPs mantém as validações de proprietário, localização e herança bloqueada. Também exige gabarito em pasta separada protegida, com acesso somente do proprietário e de revisores autorizados. Uma designação persistida precisa corresponder ao UID e à versão atuais no FA.
- A rotina não acrescenta destinatários, altera compartilhamentos ou cria usuários. A publicação do Forms continua no finalizador existente, com autorização FA, fechamento, CAS, reconciliação de respondentes e confirmação posterior.

## Verificação

Os testes cobrem vínculos ambíguos, origem/PDF alterados, versão pendente, proprietário divergente, link para DOC privado, leitores excedentes, editor desconhecido, gabarito exposto e designação revogada.

O estado global de processamento habilitado não comprova que cada formulário esteja publicado. A conclusão exige publicação READY, aceite confirmado, repetição configurada e público conferido por item. Formulários sem configuração ou com conteúdo divergente permanecem pendentes.

Nenhum teste automatizado é registrado como homologação humana. A liberação administrativa usa AUTOMATED_TESTS_ADMIN_APPROVED e humanHomologationPerformed=false.
