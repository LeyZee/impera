# 2026-11-13 OPS-09 Fournisseur d'IA payé par l'abonnement

- **Fiche** : OPS-09 (ADR 0091 § 6, « ok 0091 abonnement » du 13/11).
- **Fait** : refus pour quota épuisé reconnu par la passerelle (`quota_exhausted`, sans réessai ni clé marquée refusée, réponse du fournisseur jamais gardée) ; ligne `subscription` du registre ; carte « Inclus dans l'abonnement » et rouge « Quota épuisé » ; alerte `ai_quota_exhausted` une fois par épisode, vérification toutes les cinq minutes ; migration 0180. Puis « ok 0091 chiffres » : part couverte par l'abonnement sous Aujourd'hui, Ce mois-ci et la projection, hachurée dans le graphique.
- **Vérifié** : `pnpm check`, tests unitaires (llm, api, web), intégration `ai-usage` et `telegram` sur Postgres local.
- **Reste** : captures des chiffres (lot conso-ia-chiffres) à faire valider ; approbations Bilan (passerelle, migration, déclencheur) et Design (écran).
- **Découvertes** : la doc de xAI ne documente ni le code ni le corps d'un refus pour crédits ou quota épuisés ; la reconnaissance s'appuie sur les mots de la réponse (crédits, limite de dépense, quota) et sur 402. À recaler sur un vrai refus si un jour il arrive.
