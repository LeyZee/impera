# 2026-11-16 : ADR 0129, mesurer les scripts de vente

- **Fiche** : ADR 0129 (fil « Mesurer l'efficacité des scripts »), acceptée (« ok 0129 », 16/11 12h31 UTC, trois questions réglées par les recommandations).
- **Fait** : ADR 0129 : entonnoir par étape et branche (envoyée, lue, achetée ou répondue), revenu par fan exposé, trois sortes de pertes (pas lu, lu puis silence, lu et répond sans acheter), texte, média et prix séparés seulement par comparaison (branches, variantes, versions d'étape), désir au lancement, ce qui suit, minimum de fans et intervalles de Wilson ; écran « Performances » dans l'onglet « Scripts ». Glossaire : trois termes. Aucun code.
- **Tests** : aucun (documentation seule).
- **Reste** : Bilan (migration, connecteur), Agent et Médias, Design (captures et vidéo).
- **Découvertes** : `memberLastReadAt` et les totaux par étape de Reveal (`sentCount`, `paidBundlesCount`, `paidBundlesTotalAmount`) sont lus par `wire.ts` mais jamais stockés ; `platform_sales` n'a aucun lien vers le pack ni le script ; `platform_script_steps` est réécrite sans historique.
