# Enregistrements FakeReveal

Réponses de Reveal découpées dans une capture anonymisée (`scripts/anonymize-har.mjs`, runbook `docs/runbooks/reveal-recording.md`). Un fichier par endpoint et par capture, nommé `<endpoint>.<date>.json`, au format lu par `../fidelity.test.ts` :

```json
{
  "endpoint": "conversations.list",
  "capturedOn": "2026-10-28",
  "request": { "method": "GET", "path": "/…" },
  "response": { "status": 200, "body": {} }
}
```

Règles (`docs/conventions/hygiene.md`, ADR 0010) : versionnés et protégés ; aucun pseudo, identifiant ou texte réel (le script les remplace, la PR les relit, gitleaks tourne) ; un enregistrement qui ne passe plus le schéma de son endpoint change le schéma et FakeReveal dans la même PR.
