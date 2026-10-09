# Adapter SQLite do orçamento de Gestão

`scripts/lib/management-budget-sqlite-store.js` persiste uma linha privada por projeto em transação síncrona, com serialização JSON estrita e limite explícito de bytes. O transform não pode ser assíncrono. Cancelamento antes do commit faz rollback; commit concluído tarde conserva débito e não devolve recibo admissível. Estado persistido null, arrays, primitivos ou inválido falha fechado, sem criar saldo novo.

Os 26 testes locais usam node:sqlite real em memória: reinício do adapter, chamadas concorrentes numa conexão, rollback, isolamento de mutação, corrupção e prazos. Essa prova não certifica roteamento de várias instâncias de Durable Object, limites de CPU/bytes nem disponibilidade Cloudflare. O host deve usar namespace privado único por projeto e autoridades independentes, conforme contrato do ledger. Nenhum binding, rede, Firestore, migração ou publicação é criado pela factory.

## Ensaio do runtime local

A continuação executou cinco checks no workerd/Miniflare com um Durable Object SQLite real exclusivamente local: inicialização separada FA/FB, cinco reservas concorrentes com IDs únicos e débito total conservado, reserva independente FB, recriação dos adapters sem perder estado SQLite e pausa FA por observação antiga mantendo FB admitido. O tráfego externo foi bloqueado, o perfil e ambiente isolados e não havia credencial Google. O processo local foi encerrado e a porta liberada após o ensaio.

A prova privada fica em `.local-preview/management-split/do-smoke/proof.json`. Ela comprova a composição no runtime local com autoridades e medições sintéticas; não certifica reinício de processo, implantação, namespace distribuído produtivo, autoridade real de métricas, CPU, capacidade ou login Firebase.
