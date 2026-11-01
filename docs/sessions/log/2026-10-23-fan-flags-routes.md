# 2026-10-23 — Mémoire du fan : routes des drapeaux pour l'humain (P3-02, PR 5) — done

Fait : `GET /v1/fans/:id/flags?creatorId=` (propriétaire, chatteur, créatrice) et `PUT` du même chemin (propriétaire, chatteur) dans le module `fans`. Contrats en ajout seul dans `contracts/fans.ts` : `FanFlagsViewSchema` (`{ fanId, flags }`) et `SetFanFlagBodySchema` (poser un interrupteur ou l'âge confirmé, geler avec `freezeReason`, plafonner avec `limitMinor`, ou lever n'importe quel drapeau ; `reason` facultative, 1 à 500 caractères). L'auteur de l'événement est `human:<id de la session>`. Le serveur date l'âge confirmé et le début d'un gel (`requestedChange`) ; une confirmation garde sa première date, un gel pour la même raison garde son début (rien n'est écrit). Erreur `fan_not_found` (404) dans le module, lancée aussi par l'écriture des faits. Montage d'une ligne dans `composition-root.ts`.

Pas fait : l'écran (Extension) ; la pose par la politique sur un risque (PR suivante).

Décisions : chemin `/v1/fans/:id/flags?creatorId=`, comme `/v1/conversations/:id`, parce que la créatrice fixe la portée RLS. La créatrice lit les limites, ne les change pas : c'est la main du chatteur.

Découvertes : aucune.

Candidats à suppression : aucun.

Vérifié : `pnpm check`, `pnpm test`, intégration du module `fans` et des routes contre Postgres 16.
