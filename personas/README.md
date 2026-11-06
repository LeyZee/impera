# personas/

Une persona par créatrice, en YAML versionné (ADR 0010), validée par `StoredPersonaSchema` : format 2, la fiche de Desirali (ADR 0079), ou format 1, encore lu (`docs/reference/persona-schema.md`).

**Le dépôt ne contient que des placeholders** (`messalina/v0.0.0.yaml` au format 1, `messalina/v0.1.0.yaml` au format 2) et la créatrice inventée `demo` (`v0.3.0.yaml` au format 2). La vraie persona vit hors dépôt (dépôt privé séparé ou coffre) ; `.gitignore` refuse `v1*.yaml` et au-delà. Vérification : `pnpm persona:validate <fichier>`. Chargement : `pnpm persona:load <fichier> [--creator <id>] [--activate]`. Modification : `docs/playbooks/edit-the-persona.md`.
