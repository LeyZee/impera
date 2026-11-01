# P3-13 Gardes de voix : didascalies, média annoncé, mots de rencontre, fausse urgence, répétitions
Statut : in_progress (ID validé par Charles le 27/10 à 20h37, carte « Les 5 sans capture, désir en tête »)
Phase : 3
Dépend de : rien de bloquant (ni capture ni clé : les gardes sont du code pur, les évals tournent dès la clé xAI)
Branche : claude/project-thread-e0j3ow (fil Agent)

## Objectif
Ajouter aux gardes de `checkVoiceOutput` les fautes de voix que Desirely corrige déjà, pour qu'aucune ne parte chez un fan, que le brouillon vienne de l'agent ou d'un humain (G5).

## Contexte à lire
`apps/api/src/modules/agent/domain/guards.ts` (`BLOCKING_PATTERNS`, `checkVoiceOutput`, `meeting_promise`, `forbidden_term`), le port `guard.check` du module `conversations` (G5), `docs/architecture/ai-engine.md` (Les gardes), ADR 0021, méthode de chatting §5 (hors dépôt), `docs/reference/desirely-analysis.md` (§ Voix).

## Gardes à ajouter
1. **`stage_direction`** (bloquante) : didascalies et actions entre astérisques ou parenthèses (« *sourit* », « (rires) », « *t'envoie un bisou* ») ; Desirely le documente comme un défaut à corriger. Elle se lit sur le texte brut de la bulle, pas sur `normalise(bubble)` qui efface la ponctuation. Les emojis restent permis.
2. **`media_not_sent`** (bloquante) : la bulle annonce un envoi (« je t'envoie une photo », « regarde ce que je viens de t'envoyer ») alors que le brouillon ne porte aucun média ; l'inverse, un média joint sans phrase qui l'amène, reste permis.
3. **`platform_meeting_word`** (bloquante) : les mots que les plateformes repèrent même dans un refus (« rdv », « rendez-vous », « rencontre réelle », « se rencontrer », « IRL », « se voir en vrai » et leurs variantes ; « en vrai » seul reste permis, c'est un tic de langage, et « rencontrer » ou « se voir » sans contexte de rencontre aussi : « j'ai rencontré une copine », « on se voit au prochain live ») ; la garde `meeting_promise` bloque la promesse, celle-ci bloque le mot. La liste est une donnée versionnée en code, enrichie avec la capture Reveal.
4. **`fake_emergency`** (bloquante) : maladie, accident, hôpital, urgence, loyer, dette pour pousser une vente (le playbook l'interdit, p. 57 et 71 du PDF) ; un fait de vie neutre (« je suis crevée ») reste permis.
5. **`repetition`** (avertissement puis bloquante après calibration) : une bulle déjà envoyée à ce fan dans les vingt derniers messages, ou la même ouverture trois fois de suite (« coucou toi », « hey bébé ») ; comparaison sur le texte normalisé, sans modèle.
6. **`closed_question_streak`** (avertissement) : trois questions fermées de suite dans la découverte (le playbook demande de rebondir et d'ouvrir) ; sert la calibration, ne bloque pas.

## À faire
- [x] Les six codes dans `GuardCode`, leurs motifs et leurs tests (un cas qui passe, un cas bloqué, un faux positif connu par garde, dont « j'ai rencontré une copine » pour `platform_meeting_word`). Contexte `GuardContext` (`hasMedia`, `previousTurns`), lu par le moteur (un brouillon du moteur ne porte jamais de média) et le playground.
- [x] Élargir le port `guard.check` en ajout (Bilan) : `AgentBubbleGuard.check(bubbles, context?)` l'accepte déjà, avec `GuardContext` ; reste à le passer depuis `approveDraft` : il reçoit aujourd'hui les seules bulles ; `media_not_sent` a besoin des médias du brouillon et `repetition` des bulles déjà envoyées à ce fan. Sans cela, G5 ne repasse pas ces deux gardes à l'approbation humaine et elles ne protègent que les brouillons de l'agent. Fait : `approveDraft` passe les vingt derniers messages (`GuardReadContext`) et la racine de composition les remet à `guardContextOf` (aucun média sur un brouillon) ; `repetition` reste douce, donc l'affaire du chatteur à l'approbation.
- [x] Les codes de garde en liste fermée `GUARD_CODES` dans `packages/contracts` (`GuardCodeSchema`), comme `DESIRE_SIGNALS`, avec un test « tout code émis est dans la liste et réciproquement » (demande d'Extension, accord de Bilan sur #226 : un code n'en sort jamais). Fait par Bilan : `DraftGuarded` et le port `BubbleGuard` sont typés en `GuardCode[]`.
- [x] La raison lisible de chaque garde côté web (`GUARD_LABELS` de `apps/web/src/screens/tracking/reader-model.ts`, où vivent les libellés des gardes ; `causes.ts` ne porte que les causes de passation) : Extension, dans sa PR après l'écran de la note de désir : les quatre gardes bloquantes, en groupes nominaux (« Ce message ne peut pas partir : … ») ; pas de libellé pour les deux souples. Celles du playground sont faites (`playground/domain/labels.ts`).
- [x] Scénarios d'éval : refus de rencontre sans mot repéré, média annoncé sans pièce, ouverture non répétée (`tier: full`).

## Critères d'acceptation
- `pnpm check`, `pnpm test` verts ; aucune garde existante affaiblie ; les évals existantes ne régressent pas.

## Hors périmètre
Le style (longueur, emojis, tics) déjà couvert par `bubble_too_long`, `too_many_bubbles` et la persona.

## Notes de session
- 2026-10-27 (fil Agent) : gardes, contexte et scénarios faits. `repetition` et `closed_question_streak` restent souples jusqu'à la calibration. Deux tests existants changent de sens, voulu par la fiche : « un jour peut-être qu'on se rencontrera » et « Rendez-vous le 06/12 » sont désormais bloqués par `platform_meeting_word`.
- 2026-10-27 (fil Extension) : libellés web faits. Ils sont passés dans `apps/web/src/agent/guards.ts`, à côté de `causes.ts` et `desire.ts`, en `Record<GuardCode, string>` sur la liste fermée de #228 : exhaustifs, souples compris, puisque le contrat veut un libellé pour chaque code qu'un écran peut montrer. Un code inconnu de l'écran est tu, jamais affiché brut.
