# 2026-10-30 — REG-08 : plus de phrase sur la mémoire du serveur dans Modèles IA (Bilan) — done
Fait : la ligne d'un service branché dans Réglages › Modèles IA › Services ne finit plus par « · gardée en mémoire jusqu'au redémarrage ». L'API l'ajoutait au message quand le serveur tourne sans `CREDENTIALS_ENCRYPTION_KEYS`, ce qui n'arrive qu'en développement (la production refuse de démarrer sans, `config.ts`). Le journal de démarrage le dit toujours à qui lance le serveur (`ProviderKeysInMemory`), et `runbooks/local-dev.md` aussi. `keepsKeysInMemory` est retiré des dépendances du module `providers`. Reste de la recette design (REG-08).
Pas fait : rien ; l'écran ne change pas de code.
Décisions : retirer la phrase plutôt que la reformuler : elle parle du serveur, pas du service, et ne concerne qu'un poste de développement (règle « zéro bruit »).
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : typecheck api, eslint du module, unitaires `providers` 65/65, `pnpm check`.
