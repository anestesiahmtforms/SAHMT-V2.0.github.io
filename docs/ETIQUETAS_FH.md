# Etiquetas em FH

Etiquetas utiliza `sahmt-etiquetas-fh`, o Worker `sahmt-fh-etiquetas` e o Apps Script próprio da conta `etiquetassahmt@gmail.com`. O login permanece em FA. Cada sessão FH conserva o UID de FA, fica apenas em memória e exige uma autorização renovável de cinco minutos.

O destino inclui usuários, perfis, etiquetas, histórico, catálogo de plantonistas e arquivos de recuperação das etiquetas. O programa de migração copia os documentos com conferência de conteúdo e condições de versão; mantém cópias protegidas e os originais em FA. Recuperações apontam para FH. Edições pelo aplicativo gravam o histórico na mesma operação.

A planilha privada é [Etiquetas — FH — Registros](https://docs.google.com/spreadsheets/d/18Gdo73lCkh_mwXQwVkw6AkasbYw-Q7Up4eyOCqZcm9Y/edit). No [Apps Script de FH](https://script.google.com/d/14IrTLzvSvk9UNK3VKxUElpqi4A9AZkTL7hwmkGPcH6MxZxdSYUMgvTZJ/edit), `Setup.gs → prepararEtiquetasFH` prepara a planilha sem gravar no Firestore. `Activation.gs → ativarEtiquetasFH` exige um recibo de migração final antes de instalar o controle de edições e a atualização incremental a cada cinco minutos.

O leitor de imagens recebe a sessão própria de FH e o App Check da aplicação compartilhada de FA. Consulta somente o perfil de FH e usa `OPENAI_API_KEY` armazenada como segredo no próprio Worker. O Worker permanece inativo durante a preparação. A credencial administrativa do intercâmbio de sessões permite apenas consultar documentos em FH.

A retirada de FA limita-se às etiquetas e a `appConfig/labelStaff`: bloqueia produtores nativos, filas antigas e acessos dos clientes aos dados anteriores. Checklist, autenticação central e a separação FI/FJ permanecem ativos. Antes da conciliação final, a migração exige fila vazia, leitura do código publicado, término das execuções anteriores e confirmação das regras fechadas na origem.

Verificações locais: `npm run test:fh`, `npm run test:fh-rules` e `npm run test:fi-fj`. A publicação utiliza `VITE_FH_LABELS_ENABLED=true` e o endereço fixo de FH para a leitura de imagens. Falhas de sessão FH não provocam gravações alternativas em FA.

Uma credencial temporária de operação permite apenas consultar as contagens da fila durante a migração; ela é removida ao concluir. Dados pessoais, tokens e chaves privadas não integram o repositório. O estado administrativo e as cópias de segurança permanecem protegidos no computador do operador.
