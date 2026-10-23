# ROP training release in FB

The owner-only jobs use immutable, private Drive manifests and existing FB
profiles, area assignments and document access groups. They do not grant roles,
create identities or award credits. QMENTUM and operational data remain in FA.

## Material preparation

Each theme has one reading PDF and a protected review folder containing its
editable material and question bank. Only the five scored questions are mapped
for review; acknowledgement fields and reserve questions are outside that bank
publication patch. Existing question-review assignments are preserved.

The PDF synchronizer appends these exact bindings to its existing catalog. A
bounded initial queue covers edits made while installation batches were running.
The existing incremental Drive trigger is reused; it does not scan Firestore.

## Reading release

`prepararLeituraRopsFbV1` arms the bounded configuration job. Setup and activation
check the installed `doPost` reading dispatch first.
The deployed receiver must forward `diretrizes-reading-v1` to the reading handler;
an expired signed request can verify this transport without any identity or Firestore access.
Initializing state is durable before policy effects. Existing credit scopes are retained and content
changes create a new version. Forms use the existing evaluation configurator and
repeat-policy adapter. Publication removes responder grants while preserving
editors, so participant access remains conditional on the reading receipt.

`ativarLeituraRopsFbV1` requires completed verification, current FB authorization,
the deployed reader service and the expected public PWA cache version. Catalog
activation is committed before enabling reading. Repeated activation is safe.

The PWA gates only records carrying the server-owned `readingGateRequired` flag.
The FB rules preserve this flag during ordinary document edits.

Large signed PDF envelopes are handled in the existing SQLite Durable Object
class, using the unchanged identity and HMAC relay. The outer Worker streams the
response. PDF bytes and credentials are not stored in SQLite; no new namespace,
paid plan or background Firebase polling is introduced.
