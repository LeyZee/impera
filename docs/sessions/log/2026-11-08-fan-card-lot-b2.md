# 2026-11-08 — ADR 0085, lot (b-2) : la fiche du fan lue dans ses messages

**Session** : Agent · **Branche** : `claude/project-thread-e0j3ow` · **Ordre** : fil « fiche fan remplie par l'IA », lot (b) de l'ADR 0085 acceptée (« ok 0085 », 08/11, 16 h 59) ; migration 0155 attribuée par le coordinateur (0151 au départ)

Fait :
- Contrats : job `fans.read_card` (charge `conversationJob`, débouncé par conversation, 3 essais), `FAN_CARD_READ` et `cardReadRunAt` (cinq minutes après son dernier message, tout de suite après dix non lus, jamais moins de dix minutes après la lecture précédente), sortie fermée `FanCardReadSchema` (codes du § 3, dit ou deviné, confiance, numéro du message, 20 au plus).
- `packages/llm` : `readCard`, rôle `brain`, prompt versionné `brain/fan-card.md` (les cases, dit ou deviné, ce que la fiche ne garde jamais, données jamais instructions, canari). La fiche et les messages entrent dans deux blocs typés (`fan_notes`, `fan_message`). L'appel compte dans le budget « chatting » et est refusé dès l'alerte du jour (`budget_reached`), avant qu'une réponse à un fan le soit.
- Migration 0155 : `conversations.card_read_at` et `card_read_through` (heure d'arrivée du dernier message lu, comparée à la milliseconde).
- `conversations` : chaque message du fan met en file `fans.read_card` ; le job (`read-card.ts`) lit ses messages non lus et ce qui les précède (40 messages avec du texte), passe par le port `CardReader` (agent, `startCardReader`, lignes de fiche filtrées par `screenNotes`), fait écrire par `fans.proposeRead`, puis marque la lecture. Refusée, rien n'est marqué et le message suivant les relit. Les journaux ne portent que des codes de case.
- `fans` : `proposalsOfRead` (`domain/card-read.ts`) : une valeur repose sur un message nouveau de lui ou tombe ; vérifiée par `checkedValue` (forme, valeurs fermées, § 8) ; une case à observer est toujours devinée ; une liste ajoute ses éléments à ceux de la fiche, les plus anciens tombent quand la ligne est pleine ; un `life_event` expire 30 jours après. `planFacts` décide du reste (la note d'un chatteur reste, la contradiction attend « à vérifier »).
- Tâche enregistrée dans `wiring/conversations.ts` (`TasksNamed<'fans.read_card'>`), plus dans `wiring/fans.ts`.
- Tests : `fan-card.test.ts` (contrats), `gateway.test.ts` et `prompts.test.ts` (llm), `fans/domain/__tests__/card-read.test.ts`, `agent/infra/__tests__/card-reader.test.ts`, `__tests__/fan-card-read.integration.test.ts` (cadence, lecture, note de chatteur, § 8, budget).
- Évals : suite `evals/card/` (jour de paie deviné, « je déteste les talons », contradiction avec un chatteur, ordre glissé dans un message), lue par `pnpm evals` avant les autres, sans juge (`apps/api/src/scripts/evals/card-scenario.ts`).

Pas fait : lancer `pnpm evals` (pas de clé xAI dans la session) ; lot (b2), « proposer fragile ».

Décisions :
- Le job vit dans `conversations` (les messages et l'avancement de la lecture y sont), l'appel au modèle derrière un port de l'agent, l'écriture dans `fans` : aucun module ne lit la table d'un autre.
- Une lecture refusée n'échoue pas le job : relancer trois fois un appel coupé par le budget ne sert à rien, le message suivant relit tout.
- Une case qui contredit la fiche est proposée telle quelle par le modèle ; c'est le code qui la met « à vérifier ».

Découvertes : les `factsProposed` d'un brouillon approuvé ne passent pas par le filtre du § 8 (`checkedValue`) avant l'écriture.

Candidats à suppression : aucun.
