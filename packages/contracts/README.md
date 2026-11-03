# @impera/contracts

La vérité partagée : identifiants typés, argent, enums, schémas Zod des entités, événements, jobs, connecteurs, persona, description de médias, réglages. Importé par api, web, extension, db, llm.

Règles : pas d'I/O, pas de dépendance autre que `zod` (et la génération d'UUID) ; tout type exporté a son schéma Zod ; les enums sont des unions de littéraux dérivées de `z.enum` ; un changement de contrat est un changement d'API : il se discute dans la PR et met à jour `docs/architecture/data-model.md`.
