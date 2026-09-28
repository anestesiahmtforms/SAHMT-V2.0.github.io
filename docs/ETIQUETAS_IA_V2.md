# Leitura de Etiquetas por IA no V2

## Fluxo no PWA

1. A pessoa captura a etiqueta pelo enquadramento central da câmera.
2. O aparelho reduz a imagem e cria recortes auxiliares para os códigos numéricos; não grava a imagem em Firestore, IndexedDB ou no Storage.
3. Ao tocar em **LER ETIQUETA**, o PWA chama `readLabelImage` com a sessão Firebase autenticada. A função confere App Check, perfil, permissão e o parâmetro servidor `SAHMT_LABEL_AI_PROCESSING_APPROVED`, então envia a imagem para a OpenAI Responses API e devolve somente campos estruturados para revisão. O parâmetro servidor e a variável de build `VITE_LABEL_AI_ENABLED` ficam desativados por padrão. O backend usa `gpt-6-luna` com raciocínio desativado para priorizar latência e custo numa extração delimitada; o modelo aceita imagem e saída estruturada.
   A tela informa, junto ao botão, que a imagem será enviada à IA OpenAI e que o resultado exige revisão antes de salvar; não há confirmação extra que atrase a ação solicitada.
4. O resultado abre o formulário de Etiquetas como rascunho. A pessoa confere e conclui explicitamente **Salvar registro**; a captura nunca cria um registro automaticamente.
5. A escrita e as edições seguem no Firestore, com versão e trilha de auditoria. O relatório diário mostra responsável, data/hora e histórico; o mensal é resumido e oferece PDF/WhatsApp.

## Privacidade e autorização institucional

As imagens de etiquetas podem conter identificadores e informações de saúde. Não habilite a leitura com imagens reais de pacientes até a instituição autorizar esse tratamento e confirmar com a OpenAI os controles contratuais aplicáveis. Para PHI sujeita à HIPAA, a OpenAI exige BAA e provisionamento de retenção modificada para usar a API; `store: false` sozinho não elimina os logs de abuso, que podem reter conteúdo por até 30 dias. A política oficial está em [controles de dados da API](https://developers.openai.com/api/docs/guides/your-data) e [elegibilidade HIPAA](https://help.openai.com/en/articles/20001069-chatgpt-healthcare-and-regulated-workspace-functionality).

Até a liberação institucional, mantenha `VITE_LABEL_AI_ENABLED` ausente/falso no GitHub Actions e `SAHMT_LABEL_AI_PROCESSING_APPROVED=false` no backend. A validação de imagem, UI de registro manual e demais funções de Etiquetas continuam disponíveis.

## Configuração privada necessária

O código da função usa `defineSecret('OPENAI_API_KEY')`. A chave não fica no JavaScript do PWA, no GitHub, em Apps Script, `.env`, na planilha ou nesta conversa. Quando o projeto Firebase estiver apto a implantar Cloud Functions e a instituição tiver autorizado o tratamento dos dados, configurar no terminal local, dentro da pasta do projeto:

```powershell
npx.cmd firebase functions:secrets:set OPENAI_API_KEY --project sahmt-17a16
```

O Firebase CLI solicita o valor no terminal. Cole a chave somente nesse prompt privado. Antes de chamar a função, registre o domínio do Pages no App Check, injete `VITE_APP_CHECK_SITE_KEY` no ambiente de build do Pages, publique o cliente e confirme tokens válidos. `readLabelImage` exige App Check e Firebase Auth; sem a chave pública/configuração de domínio, a função rejeita a chamada. Em seguida, implante as Rules e a função:

```powershell
npx.cmd firebase deploy --only firestore:rules,functions:readLabelImage --project sahmt-17a16
```

As funções Firebase usam Secret Manager e cada função precisa vincular explicitamente o segredo; alterar o valor exige novo deploy para a função usar a nova versão. Consulte [configuração segura de ambiente do Cloud Functions for Firebase](https://firebase.google.com/docs/functions/config-env?hl=pt-br).

`store: false` na Responses API impede guardar o estado da resposta para recuperação posterior, mas não desliga os registros de monitoramento contra abuso: a OpenAI informa retenção de até 30 dias por padrão. Retenção zero ou monitoramento modificado dependem de elegibilidade e aprovação da conta; imagens também podem ser retidas para revisão manual em casos raros. Consulte os [controles de dados da API OpenAI](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint) antes de liberar o fluxo para dados reais.

## Estado de implantação

Este checkout contém a interface, o callable (com App Check obrigatório) e a validação das Rules. A construção local do PWA foi concluída. A função não fica ativa só por enviar os arquivos ao GitHub Pages: exige Blaze/faturamento habilitado, secret privado, App Check configurado no projeto e cliente Pages publicado com a chave pública, além do deploy no Firebase. O projeto `sahmt-17a16` está no Spark; enquanto isso não mudar por decisão explícita do proprietário, a leitura por IA permanece indisponível. As outras rotas do app continuam usando Firestore diretamente e não dependem dessa callable.

Antes de habilitar para usuários, executar uma leitura com uma imagem autorizada sem dados reais, validar o resultado de cada tipo de etiqueta V1, conferir os logs para garantir ausência de imagem/chave e verificar consumo/cotas da conta OpenAI.
