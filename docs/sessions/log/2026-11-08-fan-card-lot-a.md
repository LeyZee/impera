# 2026-11-08 — ADR 0085, lot (a) : la fiche du fan, contrat, base, règles et routes

**Session** : Agent · **Branche** : `claude/project-thread-e0j3ow` · **Ordre** : fil « fiche fan remplie par l'IA », après « ok 0085 » de Charles (08/11, 16 h 59)

Fait :
- Contrat `packages/contracts/src/fan-card.ts` : `FanCardFieldSchema` (20 codes, les 7 du canevas KYC gardés), `FAN_CARD_FIELDS` (groupe, libellé, aide, catégorie, forme, façon d'apprendre), `FanCardViewSchema` et `SetFanCardFieldBodySchema` (`strict`), valeurs fermées d'`intensity` et `lead`. `StoredFactKindSchema` ajoute `noted`.
- Migration 0142 : `fan_facts.kind` gagne `noted`, colonne `noted_by` et son check. RLS inchangée.
- Domaine `fans` : une case est un seul emplacement quelle que soit sa catégorie ; force noté > dit > deviné ; « à vérifier » ; retrait par une ligne vide ; filtre du § 8 (`neverKept`).
- Routes `GET /v1/fans/:id/card` et `PUT /v1/fans/:id/card/:field`, déclarées au harnais d'isolation.

Pas fait : lot (b) (`fans.read_card`, `KYC_ASKABLE`, filtre par rôle du bloc des notes), lot (b2) (« proposer fragile »).

Décisions :
- Celui qui peut lire la fiche peut la corriger : un chatteur dont la fenêtre est ouverte sur elle, ou qui tient une conversation du fan, écrit aussi. Sinon le chatteur qui parle au fan ne pourrait pas corriger ce qu'il lit (§ 6). Ce n'est pas la règle des limites, où seule la liste de la créatrice écrit.
- La vue donne l'identifiant du chatteur (`notedBy`) et le message source (`sourceMessageId`), pas le nom ni la phrase. Les deux lectures viendront par un port quand l'écran les demandera.

Découvertes :
- `conversations/infra/db/fan-insights.ts` (Qui sont tes fans) ne lit que `kind = 'declared'` : une valeur corrigée par un chatteur (`noted`) n'y compte pas. Un `kind in ('declared', 'noted') and value <> ''` suffirait, mais ce fichier n'est pas à Agent.
- Religion, opinions, origine et santé détaillée ne se trouvent pas par motif : le prompt du lot (b) doit les tenir dehors.

Candidats à suppression : aucun.
