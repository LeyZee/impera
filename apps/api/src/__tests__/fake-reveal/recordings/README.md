# Enregistrements FakeReveal

Réponses de Reveal découpées dans une capture anonymisée (`scripts/anonymize-har.mjs`, runbook `docs/runbooks/reveal-recording.md`). Un dossier par jour de capture (`2026-11-10/`), un fichier par endpoint et par variante, nommé `<endpoint>[.<variante>].<date>.json`, au format lu par `../fidelity.test.ts` (tous les sous-dossiers) :

```json
{
  "endpoint": "conversations.list",
  "capturedOn": "2026-10-28",
  "request": { "method": "GET", "path": "/…", "body": {} },
  "response": { "status": 200, "body": {} }
}
```

Règles (`docs/conventions/hygiene.md`, ADR 0010) : versionnés et protégés ; aucun pseudo, identifiant ou texte réel (le script les remplace, la PR les relit, gitleaks tourne) ; un enregistrement qui ne passe plus le schéma de son endpoint change le schéma et FakeReveal dans la même PR.

En plus de l'anonymiseur, chaque fichier est relu à la main : tableaux réduits à deux éléments, textes remplacés par `texte_N`, liens par `https://media.example.test/<hash>`, codes par `code_masque`, et **les nombres de l'agence remplacés par des valeurs inventées** (part de l'agence, chiffre de la modèle, volume des transactions), comme les dates antérieures à 2026. `headers.md` décrit les en-têtes, sans aucune valeur de session.
