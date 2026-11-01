# Progresso — isolamento FC

Plano: `docs/superpowers/plans/2026-11-01-fc-integration-isolation.md`.
Base: `5bd3b44`; branch local `codex/fc-integration-isolation`.

- Diagnóstico parcial real concluído: seis Workers centrais, 20 imagens Drive com propriedade/permissões individuais, automação de login no código e flags do Worker central.
- Acesso FC: Cloudflare 403 na sessão central. Drive FC legível, criação de pasta negada por `insufficientParentPermissions`. Nenhum recurso de destino criado.
- Roteamento FC preparado nos três clientes. Configuração padrão desabilitada, mantendo os endereços atuais. Nenhuma alteração no coordenador Auth ou nas operações de planilhas de FA.
- Worker FC preparado com três rotas, URL Apps Script própria obrigatória e admissão SQLite própria; relays/autorização/recibos existentes reutilizados.
- TDD: testes novos inicialmente falharam por ausência do módulo; após módulos, três falhas comportamentais dos clientes foram observadas; integração dos clientes corrigida; suíte direcionada passou.
- Revisão independente encontrou duas lacunas de cobertura: teste novo fora do CI e ausência de sucessos completos via entrypoint FC. Ambas tratadas com inclusão no workflow e trocas assinadas das três rotas, verificando admissão/liberação e destino dedicado.
- Verificação atual: 215 testes direcionados aprovados, zero falhas; Worker compilado com `wrangler deploy --dry-run`, sem publicação, e build completo do PWA FA/FB/enquetes aprovado com origem FC fictícia de validação local. A primeira rodada ampliada encontrou dependências ausentes; a instalação pelo lockfile resolveu esse impedimento. Logs anteriores preservados em `fc-isolation/evidence/`.
- `git -c core.whitespace=cr-at-eol diff --check` aprovado. A opção reconhece CRLF já existente nos arquivos rastreados; não houve reformatação geral.
- Navegador: usuário informou a opção habilitada; reinicialização do controlador ainda retornou `Local browser use is disabled in Work settings`.
- Alternativa oficial: Wrangler 4.149.0 instalado pelo lockfile; autorização OAuth de perfil separado `sahmt-fc-isolation`, com armazenamento protegido no Windows e gravação de logs de credenciais desabilitada. A primeira tentativa expirou sem receber código; a segunda recebeu confirmação da Cloudflare, mas falhou ao persistir por falta do binding nativo. `@napi-rs/keyring@1.3.0` foi instalado no diretório nativo oficial do Wrangler; confirmar preflight de armazenamento antes da próxima autorização. Nenhuma sessão FC foi confirmada até aqui.
- Próximo passo: concluir autorização Cloudflare FC, inventariar a conta exata e obter acesso Google FC/Apps Script antes de criar serviços ou copiar arquivos. Ativação em produção continua dependente da aprovação explícita exigida pelo usuário.

Não executar scripts de consolidação/migração Firestore existentes neste repositório: eles movem dados de negócio e estão fora do escopo autorizado deste isolamento.
