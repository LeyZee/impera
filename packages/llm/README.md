# @impera/llm

La passerelle `LlmGateway` (ADR 0009) : rôles `sense`, `brain`, `voice`, `judge` ; fournisseurs sur le Vercel AI SDK (`src/providers/`) ; prompts versionnés (`prompts/<role>/<name>.md`, en-tête YAML, hash) ; tarification (`src/pricing.ts`) ; cache des descriptions ; journal `llm_calls` et traces Langfuse ; `wrapUntrusted()`.

Règle unique : c'est le **seul** package qui importe un SDK de fournisseur (règle ESLint `boundaries/external`). Ajouter un fournisseur : `docs/playbooks/add-an-llm-provider.md`.
