# 2026-10-27 — P3-13 Gardes de voix — done
Fait :
- `agent/domain/guards.ts` : six gardes. `stage_direction` (bulle brute, astérisques et parenthèses d'action), `media_not_sent` (média annoncé alors que le brouillon n'en porte aucun ; offre et promesse pour plus tard permises), `platform_meeting_word` (liste versionnée `PLATFORM_MEETING_WORDS_VERSION`), `fake_emergency` (urgence près d'un mot de vente, ou demande d'argent), toutes bloquantes ; `repetition` (bulle déjà envoyée, même ouverture une troisième fois) et `closed_question_streak` souples.
- `GuardContext` (`hasMedia`, `previousTurns`) et `previousTurnsOf` (vingt derniers messages) ; `checkVoiceOutput(bubbles, settings, context)`, `AgentBubbleGuard.check(bubbles, context?)`.
- Moteur et playground passent le contexte (`guardContextOf`) ; libellés du playground ; trois scénarios d'éval `full`.
- `GUARD_CODES` et `GuardCodeSchema` dans les contrats (liste fermée, jamais un code retiré), `GuardCode` de l'agent en est le type ; test d'exhaustivité.
- Faux positifs relevés par Bilan corrigés : offre en question (« je t'envoie une photo ? », « tu veux je t'envoie… »), insistance entre astérisques (« *trop* »), « urgence » comme accroche, maladie passée sans lien avec la vente ; chacun a son test.
- Doc : `ai-engine.md` (Les gardes), glossaire (didascalie, mot de rencontre repéré, fausse urgence), fiche.
Pas fait :
- Passer le contexte depuis `approveDraft` (port `BubbleGuard`, Bilan) : d'ici là G5 ne relit pas `media_not_sent` ni `repetition` sur un brouillon approuvé.
- Libellés web des nouvelles gardes (`reader-model.ts`, Extension).
Décisions :
- Un brouillon du moteur ne porte jamais de média aujourd'hui : `hasMedia` vaut `false` dans le moteur.
- « Rendez-vous » et « se rencontrer » bloquent même hors promesse, comme le veut la fiche ; deux tests existants changent de sens.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check, pnpm test ; évals non lancées (pas de clé xAI ici).
