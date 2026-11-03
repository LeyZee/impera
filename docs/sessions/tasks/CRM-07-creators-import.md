# CRM-07 Importer les créatrices depuis Reveal, après revue du propriétaire

Statut : todo (ADR 0069 acceptée par Charles le 03/11/2026, 19 h 58)
Phase : API CRM (ADR 0050)
Dépend de : CRM-01 (clé et `listModels`) ; rien d'autre
Branches : task/crm-07-a-creators-import-api, task/crm-07-b-creators-import-screen
Propriétaires proposés : Bilan (lot a : contrats, `connectors`, base) ; Extension (lot b : écran)

## Objectif

Avec la clé posée, le propriétaire relit les modèles Reveal sans lien, et en un clic relie chacune à une créatrice existante ou la crée. Rien ne se crée sans lui.

## Contexte à lire

ADR 0069 (tout), ADR 0050 § 3 et § 4, ADR 0054, ADR 0010 (aucune donnée réelle). Code : `connectors/infra/reveal-crm/adapter.ts` (`listModels`), `packages/db/src/schema/sales-feed.ts` (`sales_feed_models`, lignes mises de côté), `persona/infra/db/creator-directory.ts` (création d'une créatrice, `name_key` unique), `apps/web/src/settings/sales-feed/Links.tsx`.

## À faire

### Lot a (Bilan)

- [ ] `PlatformModel` gagne `status` (valeur inconnue lue `other` et signalée, comme ADR 0050 § 3) et `avatarUrl` ; schéma Zod de `/v1/models` mis à jour.
- [ ] Proposition calculée par le code pour chaque modèle sans lien : `link` (nom par `creatorNameKey` ou pseudo d'un compte existant), sinon `create` ; `preselected` seulement pour `validated` et actif.
- [ ] Route propriétaire (mot de passe redemandé) « importer la sélection » : par ligne, créer créatrice + compte Reveal + lien (`linkedBy: member`) ou relier ; idempotente sur l'identifiant du modèle ; nom déjà pris refusé ligne par ligne sans faire tomber le lot ; ventes mises de côté libérées comme un lien à la main.
- [ ] Photo copiée dans notre stockage (pas d'adresse Reveal gardée comme source).
- [ ] État « écartée » d'une ligne, réversible ; migration seulement s'il ne tient pas dans `sales_feed_models` (numéro demandé au coordinateur).
- [ ] Modèle disparu de `/v1/models` ou passé `banned` : alerte, rien de supprimé.
- [ ] Journal d'audit : création et ligne écartée (identifiant du modèle seulement).
- [ ] `FakeReveal` : modèles inventées pour chaque statut, un pseudo déjà pris, un nom en double.

### Lot b (Extension)

- [ ] Réglages › Ventes Reveal : bloc « N créatrices trouvées sur Reveal », une ligne par modèle (photo, nom, pseudo, statut, action proposée modifiable), cases, « Importer la sélection », liste repliée « Écartées ».
- [ ] Badge « N nouvelles créatrices sur Reveal » pour le propriétaire seul.
- [ ] Sur la fiche d'une créatrice importée : ce qui reste à faire (pourcentage, fuseau, persona, invitation).
- [ ] Captures Nuit et Jour, téléphone et ordinateur, montrées à Charles avant fusion.

## Critères d'acceptation

- Aucune créatrice n'est créée sans l'appel du propriétaire (test).
- L'import ne touche ni persona, ni pourcentage, ni agent, ni invitation (test).
- Rejouer l'import ne crée rien de plus (test).
- Une modèle `banned`, `refused`, `pending` ou inactive n'est pas présélectionnée (test).
- Chaque écriture d'une créatrice passe par `withTenant` de cette créatrice (intégration).

## Hors périmètre

Historique au-delà de 31 jours (export du dashboard), persona, capture de session, invitation de la créatrice.

## Notes de session
