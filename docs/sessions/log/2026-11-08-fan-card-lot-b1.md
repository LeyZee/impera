# 2026-11-08 — ADR 0085, lot (b-1) : ce que le cerveau demande, et ce que la voix ne lit jamais

**Session** : Agent · **Branche** : `claude/project-thread-e0j3ow` · **Ordre** : fil « fiche fan remplie par l'IA », lot (b) de l'ADR 0085 acceptée (« ok 0085 », 08/11, 16 h 59)

Fait :
- `KYC_ASKABLE` (contrats) : six cases, sans `desires`. Le code filtre `strategies.kyc.collect` avant le prompt (`askableSlots`, `persona-file.ts`) et `kycMissing` après le cerveau (`askableOnly`, `agent/domain/kyc.ts`), par code ou par libellé.
- `FAN_CARD_BRAIN_ONLY` et `isBrainOnlyFact` (contrats) : `payday`, `attachment`, `moods`. `conversations` range ces faits dans `brainNotes` (`fanNotesOf`), que `composeTurn` ajoute aux notes du cerveau seul ; la voix ne les reçoit jamais, et les mêmes filtres d'ordres (`screenNotes`) s'y appliquent.
- Tests : `agent/domain/__tests__/kyc.test.ts`, trois cas dans `draft-composer.test.ts` (rien de la paie, de l'attachement ni des humeurs dans l'entrée de la voix), `conversations/application/__tests__/fan-notes.test.ts`.

Pas fait : lot (b-2), le job `fans.read_card`, son prompt `brain/fan-card.md` et ses évals ; lot (b2), « proposer fragile ».

Décisions :
- Une note de chatteur laissée en rendant la main reste lue par les deux, même si sa clé ressemble à `payday` : c'est une note humaine, pas une case.
- Le prompt du cerveau ne change pas dans ce lot : `kyc_collect` ne contient plus `Envies`, et le code retire `desires` de sa sortie quoi qu'il en dise.

Découvertes : aucune.

Candidats à suppression : aucun.
