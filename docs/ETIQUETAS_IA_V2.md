# Leitura de Etiquetas por IA no V2

## Fluxo no PWA

1. A pessoa captura a etiqueta pelo enquadramento central da câmera.
2. O aparelho reduz a imagem e cria recortes auxiliares para os códigos numéricos; não grava a imagem em Firestore, IndexedDB ou no Storage.
3. Ao tocar em **LER ETIQUETA**, o PWA chama `readLabelImage` com a sessão Firebase autenticada. A função confere o perfil e a permissão, envia a imagem para a OpenAI Responses API e devolve somente campos estruturados para revisão.
   A tela informa, junto ao botão, que a imagem será enviada à IA OpenAI e que o resultado exige revisão antes de salvar; não há confirmação extra que atrase a ação solicitada.
4. O resultado abre o formulário de Etiquetas como rascunho. A pessoa confere e conclui explicitamente **Salvar registro**; a captura nunca cria um registro automaticamente.
5. A escrita e as edições seguem no Firestore, com versão e trilha de auditoria. O relatório diário mostra responsável, data/hora e histórico; o mensal é resumido e oferece PDF/WhatsApp.

## Configuração privada necessária

O código da função usa `defineSecret('OPENAI_API_KEY')`. A chave não fica no JavaScript do PWA, no GitHub, em Apps Script, `.env`, na planilha ou nesta conversa. Quando o projeto Firebase estiver apto a implantar Cloud Functions, configurar no terminal local, dentro da pasta do projeto:

```powershell
npx.cmd firebase functions:secrets:set OPENAI_API_KEY --project sahmt-17a16
```

O Firebase CLI solicita o valor no terminal. Cole a chave somente nesse prompt privado. Em seguida, implante as Rules e a função:

```powershell
npx.cmd firebase deploy --only firestore:rules,functions:readLabelImage --project sahmt-17a16
```

As funções Firebase usam Secret Manager e cada função precisa vincular explicitamente o segredo; alterar o valor exige novo deploy para a função usar a nova versão. Consulte [configuração segura de ambiente do Cloud Functions for Firebase](https://firebase.google.com/docs/functions/config-env?hl=pt-br).

## Estado de implantação

Este checkout contém a interface, o callable e a validação das Rules. A construção local do PWA foi concluída. A função não fica ativa só por enviar os arquivos ao GitHub Pages: ainda exige secret privado e deploy no Firebase. O projeto `sahmt-17a16` teve o faturamento desabilitado na tentativa anterior de deploy; enquanto isso não mudar no Console do Google Cloud/Firebase, o deploy da função permanece bloqueado. Não habilitar plano ou faturamento sem decisão do proprietário.

Antes de habilitar para usuários, executar uma leitura com uma imagem autorizada sem dados reais, validar o resultado de cada tipo de etiqueta V1, conferir os logs para garantir ausência de imagem/chave e verificar consumo/cotas da conta OpenAI.
