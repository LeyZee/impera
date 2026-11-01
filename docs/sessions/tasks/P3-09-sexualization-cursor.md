# P3-09 Curseur de sexualisation, minimum de KYC et âge confirmé

Statut : done (ID validé par Charles le 27/10 à 18h37)
Phase : 3
Dépend de : P3-02 (limites du fan), `PROPOSED-method-gaps.md`
Branche : task/P3-09-sexualization-cursor

## Objectif

Faire appliquer par le code, jamais par le prompt, les trois réglages de la méthode qui existent dans la fiche persona sans être lus : quand elle ouvre la sexualisation, quand elle suit un fan qui la lance, et rien d'explicite tant que son âge n'est pas confirmé.

## Contexte à lire

- `packages/contracts/src/persona.ts` : `strategies.sexualization.initiate_after_hours`, `strategies.kyc.min_hours_before_following`
- `apps/api/src/modules/agent/domain/situation.ts` (durée de la relation), `policy.ts`, `traps.ts` (le modèle d'une consigne remplacée par le code)
- `apps/api/src/modules/agent/infra/compose.ts` (`offerRefusal`, la consigne remplacée quand la politique refuse)
- `docs/sessions/tasks/PROPOSED-method-gaps.md`

## À faire

- [x] Une règle pure `sexualizationDecision` (domaine de l'agent) : à partir de la durée de la relation, des limites du fan et de la lecture du cerveau, elle dit « elle peut ouvrir », « elle suit », ou « elle recadre ».
- [x] Avant `initiate_after_hours` (ou âge inconnu), la voix reçoit la consigne de ne pas ouvrir la sexualisation, sans sous-entendu.
- [x] S'il sexualise avant `min_hours_before_following`, ou tant que son âge n'est pas confirmé, la voix reçoit une consigne de recadrage dans sa voix (elle ralentit, revient à lui), comme pour un piège.
- [x] Une garde de la voix sur le vocabulaire explicite, bloquante tant que `ageConfirmedAt` manque.
- [x] Le playground suit la même règle (horloge simulée, `advance`).
- [x] Tests unitaires sur chaque seuil, scénarios d'évals sur le recadrage.

## Décision de Charles (27/10, 18h38) : l'âge confirmé par sa déclaration

Aujourd'hui seul un humain pose `ageConfirmedAt`. Désormais, un âge de 18 ans ou plus dit clairement par le fan, sans aucun signe de mineur (texte ou média), le confirme par la politique (auteur `system`). Un humain peut le retirer, et le code le retire au moindre signe de mineur, comme aujourd'hui.

- [x] Règle pure : un fait déclaré `age` ≥ 18 (proposé par le cerveau, `kind: declared`), sans risque `minor_suspected` ni signe de mineur dans le tour, pose `ageConfirmedAt`.

## Critères d'acceptation

- `pnpm check`, `pnpm test` verts ; un scénario d'évals par seuil.

## Hors périmètre

Les relances (`P3-10-follow-ups.md`), les scripts (P6-01).

## Notes de session

27/10 (fil agent) : `domain/sexualization.ts` (`sexualizationDecision`, `declaredAdultAge`), appliqué dans `composeTurn` après un piège et avant l'offre ; sans limites connues, elle ne va jamais sur ce terrain (fail closed). La garde `explicit_before_age` ne s'applique qu'au composeur, tant que l'âge n'est pas confirmé (les bulles réécrites par un chatteur n'y passent pas : c'est un humain qui écrit). L'âge confirmé dans un message vaut pour le texte de ce même message ; l'offre attend le suivant (les limites sont lues avant le cerveau). Évals : `evals/scenarios/sexualization-too-early.yaml` (tier full).

27/10, relecture Bilan : un âge retiré (signe de mineur ou humain) pose `ageDisputed` dans la même transaction ; la déclaration du fan ne confirme plus rien tant qu'un humain ne l'a pas levé ou n'a pas reconfirmé l'âge (`confirmDeclaredAge`, sous verrou). `noExplicit` est lu : suggestive seulement, garde explicite sur chaque brouillon, elle n'ouvre jamais. Un âge déclaré compte à partir du message suivant : la réponse à « j'ai 25 ans » reste prudente. Un âge non enregistré est compté (`onLimitsNotSaved`, à brancher sur le journal dans la composition root).
