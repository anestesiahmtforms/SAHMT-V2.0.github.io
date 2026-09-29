# Configuração e liberação da IA de Etiquetas

## Estado e requisitos

- Firebase project: `sahmt-17a16` (Spark).
- Cloudflare Worker: `sahmt-label-ai`.
- Endpoint de leitura: `https://sahmt-label-ai.anestesiahmtforms.workers.dev/v1/labels/extract`.
- CORS: somente `https://anestesiahmtforms.github.io`.
- OpenAI: `gpt-6-luna`; `OPENAI_API_KEY` é Secret Cloudflare e não deve ser lida, colada no chat, commitada ou colocada em variável Vite.
- Cloud Functions/Blaze não são necessários para esta leitura.

O `GET /health` responder `200` comprova apenas disponibilidade básica do endpoint; não prova que o código versionado atual está implantado nem testa Auth, App Check, perfil ou OpenAI.

## 1. Preparar App Check no Firebase

1. No [Firebase Console](https://console.firebase.google.com/project/sahmt-17a16/appcheck), selecione o app Web SAHMT com App ID `1:1072832154794:web:38e8e627d4189ebb0a14d3`.
2. Registre/configure o provedor **reCAPTCHA v3** para o domínio `anestesiahmtforms.github.io`. Se o Firebase Console oferecer uma nova chave de site, use a chave pública correspondente a esse domínio. Nunca use a chave secreta no PWA.
3. Mantenha o enforcement global do App Check conforme a política já adotada no projeto; o Worker valida obrigatoriamente cada token recebido, independentemente do enforcement global.
4. Teste a integração no domínio publicado e confirme que o app consegue obter tokens. Não use token de debug em produção.

## 2. Configurar variáveis públicas do GitHub Pages

No repositório `anestesiahmtforms/SAHMT-V2.0.github.io`, abra **Settings → Secrets and variables → Actions → Variables → New repository variable** e cadastre:

| Nome | Valor |
|---|---|
| `VITE_APP_CHECK_SITE_KEY` | Site key pública reCAPTCHA v3 do App Check acima |
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

Antes de abrir o recurso a usuários, publique o PWA com `VITE_LABEL_AI_ENABLED=true` e faça uma homologação controlada, usando etiqueta fictícia sem dados pessoais, uma conta Firebase ativa com `labelsWrite` (ou permissão administrativa), App Check real e a origem oficial. Confirme o rascunho e que nada é persistido até **Salvar registro**. Depois restaure o controle de habilitação conforme a decisão institucional.

## 5. Critérios de aceite e limites

- Firebase Auth inválido/ausente: `401`; perfil ausente, inativo, sem acesso ou sem permissão: `403`.
- App Check ausente/inválido: rejeição antes da chamada OpenAI.
- Payload/imagem inválida: `400` ou `413`; OpenAI indisponível: erro controlado e orientação para tentar de novo/registro manual.
- Formatos padrão, Consulta Pré-anestésica e SADT preservados; números duvidosos, inclusive zero versus oito, ficam vazios.
- Worker não grava registros nem usa service account. O Firestore lê o perfil com o ID Token do próprio usuário e mantém a aplicação das Security Rules.
- Não registrar imagens, conteúdo clínico, tokens ou segredo. `store:false` não equivale a garantia de retenção zero no provedor; confirme as políticas institucionais e contratuais antes de imagens reais.

Ainda dependem de acesso do proprietário ao painel Cloudflare/Firebase/GitHub: confirmar o deploy do Worker, obter e cadastrar a site key pública, publicar o Pages com App Check e completar o teste autenticado controlado. A leitura fica **não pronta para homologação final** até essas verificações.
