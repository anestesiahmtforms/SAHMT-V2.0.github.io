# Configuração e liberação da IA de Etiquetas

## Estado e requisitos

- Firebase project: `sahmt-17a16` (Spark).
- Cloudflare Worker: `sahmt-label-ai`.
- Endpoint de leitura: `https://sahmt-label-ai.anestesiahmtforms.workers.dev/v1/labels/extract`.
- CORS: somente `https://anestesiahmtforms.github.io`.
- OpenAI: `gpt-6-luna`; `OPENAI_API_KEY` é Secret Cloudflare e não deve ser lida, colada no chat, commitada ou colocada em variável Vite.
- Cloud Functions/Blaze não são necessários para esta leitura.

Em 29/09/2026, o Worker foi publicado no Cloudflare (versão `2f609917-ffa3-46ab-aea3-fc573541ffac`), o app Web SAHMT PWA foi registrado no Firebase App Check com Fraud Defense e as três variáveis públicas do GitHub Actions foram cadastradas. `VITE_LABEL_AI_ENABLED` permanece `false` até a homologação autenticada; com esse valor, o PWA não inicializa o App Check nem consome avaliações ao abrir a página.

O `GET /health` responder `200` comprova apenas disponibilidade básica do endpoint; não prova que o código versionado atual está implantado nem testa Auth, App Check, perfil ou OpenAI.

## 1. Preparar App Check no Firebase

1. No Google Cloud Fraud Defense do projeto `sahmt-17a16`, crie uma chave Web baseada em pontuação, restrita ao domínio `anestesiahmtforms.github.io`. Mantenha a verificação de domínio ativa e não inclua `localhost` na chave de produção.
2. No [Firebase Console](https://console.firebase.google.com/project/sahmt-17a16/appcheck), selecione o app Web SAHMT com App ID `1:1072832154794:web:38e8e627d4189ebb0a14d3` e registre o provedor **Fraud Defense (reCAPTCHA Enterprise)** com essa chave pública. O reCAPTCHA clássico está descontinuado para novos cadastros. Não coloque chaves secretas no PWA.
3. Mantenha o enforcement global do App Check conforme a política já adotada no projeto; o Worker valida obrigatoriamente cada token recebido, independentemente do enforcement global.
4. Teste a integração no domínio publicado e confirme que o app consegue obter tokens. Não use token de debug em produção.

## 2. Configurar variáveis públicas do GitHub Pages

No repositório `anestesiahmtforms/SAHMT-V2.0.github.io`, abra **Settings → Secrets and variables → Actions → Variables → New repository variable** e cadastre:

| Nome | Valor |
|---|---|
| `VITE_APP_CHECK_SITE_KEY` | Chave pública Web do reCAPTCHA Enterprise registrada no App Check acima |
| `VITE_LABEL_AI_ENDPOINT` | `https://sahmt-label-ai.anestesiahmtforms.workers.dev/v1/labels/extract` |
| `VITE_LABEL_AI_ENABLED` | `false` até concluir deploy e homologação autenticada |

São variáveis públicas incorporadas ao bundle. Não cadastre `OPENAI_API_KEY` nesse local. O workflow de Pages já injeta essas três variáveis no build.

## 3. Publicar o Worker

O script versionado está em `worker-label-ai/worker.js`. A partir da raiz do checkout, com Wrangler autenticado na conta Cloudflare que possui o Worker:

```powershell
npx.cmd wrangler deploy --config worker-label-ai/wrangler.toml
```

O deploy preserva o Secret `OPENAI_API_KEY` existente no Worker. Se o Secret precisar ser criado ou rotacionado, use **Cloudflare Dashboard → Workers & Pages → sahmt-label-ai → Settings → Variables and Secrets → Add → Secret**. Não revele o valor no terminal compartilhado, em logs ou no GitHub.

## 4. Validar sem dados de pacientes

Do terminal PowerShell:

```powershell
Invoke-RestMethod 'https://sahmt-label-ai.anestesiahmtforms.workers.dev/health'
```

Com o domínio permitido, POST sem credenciais deve retornar `401`; a partir de origem não autorizada deve retornar `403`. A suíte local exercita tokens assinados de teste, permissões, origens, payload, erros e extração estruturada sem imagem real nem chave OpenAI:

```powershell
npm run test:label-ai-worker
npm run build
```

Para homologar o fluxo completo, habilite `VITE_LABEL_AI_ENABLED=true` apenas durante uma janela controlada no domínio oficial e use etiqueta fictícia sem dados pessoais, uma conta Firebase ativa com `labelsWrite` (ou permissão administrativa) e App Check real. Confirme o rascunho e que nada é persistido até **Salvar registro**. Se qualquer etapa falhar, retorne a variável a `false` e publique novamente; mantenha `true` somente após a homologação.

## 5. Critérios de aceite e limites

- Firebase Auth inválido/ausente: `401`; perfil ausente, inativo, sem acesso ou sem permissão: `403`.
- App Check ausente/inválido: rejeição antes da chamada OpenAI.
- Payload/imagem inválida: `400` ou `413`; OpenAI indisponível: erro controlado e orientação para tentar de novo/registro manual.
- Formatos padrão, Consulta Pré-anestésica e SADT preservados; números duvidosos, inclusive zero versus oito, ficam vazios.
- Worker não grava registros nem usa service account. O Firestore lê o perfil com o ID Token do próprio usuário e mantém a aplicação das Security Rules.
- Não registrar imagens, conteúdo clínico, tokens ou segredo. `store:false` não equivale a garantia de retenção zero no provedor; confirme as políticas institucionais e contratuais antes de imagens reais.

Ainda faltam a publicação do Pages com a configuração nova e a homologação autenticada com imagem fictícia. A leitura fica **desativada** enquanto `VITE_LABEL_AI_ENABLED=false`.
