# SAHMT Etiquetas AI — Cloudflare Worker

Worker HTTP sem dependência de Firebase Cloud Functions. O projeto Firebase e o OpenAI Secret continuam isolados no servidor; o navegador envia somente a imagem que a pessoa escolheu ler, após a ação explícita **LER ETIQUETA**.

## Contrato

- `GET /health`: status técnico sem dados de usuário.
- `POST /v1/labels/extract`: exige `Authorization: Bearer <Firebase ID Token>`, `X-Firebase-AppCheck: <App Check Token>` e JSON `{ imageDataUrl, numericImageDataUrls }`.
- CORS admite somente `https://anestesiahmtforms.github.io`; origens diferentes recebem `403`.
- O Firebase ID Token é verificado com as chaves públicas rotativas do Firebase Auth. O perfil `users/{uid}` é lido via Firestore REST usando o mesmo token do usuário, portanto as Firestore Security Rules continuam aplicadas. O Worker não usa service account.
- O App Check é verificado criptograficamente com JWKS oficiais; exige `RS256`, `typ: JWT`, `kid`, assinatura válida, issuer/audience do projeto, token dentro da validade e o Web App ID deste SAHMT.
- JWKS não são fixadas no código. O Worker mantém cache temporário por isolate; App Check nunca excede seis horas, respeitando um `max-age` menor enviado pelo Firebase. Um `kid` desconhecido força uma atualização antes da rejeição.
- O perfil precisa existir, estar ativo e com acesso, além de ter `labelsWrite`, `labelsManage`, `permissions.admin` ou o papel `administrador_app`.
- A imagem principal e até três recortes passam por limite, formato e assinatura de arquivo. A Responses API usa `gpt-6-luna`, `store: false`, `reasoning.effort: none` e Structured Outputs. A resposta volta como rascunho; o Worker não grava em Firestore.
- Erros do OpenAI, identificadores, fotos e tokens nunca são escritos em logs. Não há service account nem OpenAI key no cliente.

## Cloudflare

O secret `OPENAI_API_KEY` precisa existir no ambiente Cloudflare desse Worker. O valor não é lido, impresso ou enviado ao GitHub. Para publicar esta versão usando uma sessão Wrangler já autenticada, a partir da raiz do repositório:

```powershell
npx.cmd wrangler deploy --config worker-label-ai/wrangler.toml
```

O nome do Worker permanece `sahmt-label-ai`, mantendo o endpoint `https://sahmt-label-ai.anestesiahmtforms.workers.dev`. Se o secret ainda não estiver vinculado ao Worker, configure-o pelo campo de secret do painel Cloudflare ou use `npx.cmd wrangler secret put OPENAI_API_KEY --config worker-label-ai/wrangler.toml` e cole a chave somente no prompt privado do Wrangler. Não informe a chave ao Codex.

Depois do deploy, confira `/health` e rode os testes locais com `npm run test:label-ai-worker`. O teste não envia imagens, tokens, dados clínicos ou chamadas à OpenAI real.
