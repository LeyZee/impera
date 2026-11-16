# CRE-04 Qui a écrit : chacun de ses messages envoyés porte son auteur, dans sa lecture d'une conversation
Statut : review (code en PR ; l'écran est à Design après fusion)
Phase : espaces (ADR 0042, 0065)
Dépend de : CR-02 (lecture de ses conversations, `/v1/creator-space`), ADR 0065 § 1
Branche : `task/cre-04-message-author`

## Objectif
Dans sa lecture d'une conversation (Ventes), chacun de ses messages envoyés dit qui l'a écrit : le nom affiché du chatteur (celui de « Qui répond à tes fans »), « Automatique » pour un message de l'IA, « Écrit sur Reveal » pour un message parti hors d'Impera. Le message d'un fan ne porte pas d'auteur. Rien d'autre de l'IA ni de l'équipe ne sort.

## Contexte à lire
ADR 0021, 0042 § 2, 0065 § 1, 0031 (lectures bornées sur la connexion admin) ; `packages/contracts/src/creator-space.ts` ; `apps/api/src/modules/conversations/infra/db/creator-reader.ts` ; `docs/architecture/message-flow.md` § 3 (auteur `ai | human` à l'envoi).

## À faire
- [x] Contrat : `writtenBy` sur `CreatorMessageSchema`, union discriminée `strict` (`chatter` avec `displayName`, `ai`, `platform`, `agency`), `null` pour un message du fan et seulement pour lui ; les mots de l'écran restent hors du contrat.
- [x] Domaine `conversations` : règle pure `writtenBy` (auteur interne, brouillon, correcteurs) et tests unitaires.
- [x] Lecture : `messages.author` et `messages.draft_id` lus par sa porte et jamais rendus ; le correcteur d'un brouillon lu dans le journal (`draft_edited`, dans sa créatrice, côté agence) et son nom affiché sur la connexion admin, après que sa porte a montré que la conversation est la sienne.
- [x] Intégration : les trois sortes, le cas du propriétaire et le message du fan ; la réponse ne porte ni brouillon, ni décideur, ni compte du chatteur.
- [ ] Écran (Design, après fusion) : les mots « Automatique », « Écrit sur Reveal », le nom du chatteur, et ceux du cas `agency`.

## Critères d'acceptation
- Un message du fan : `writtenBy` nul. Un brouillon parti tel quel ou un envoi d'Impera reconnu : `ai`. Un brouillon corrigé par un membre : son nom affiché. Un message sans brouillon écrit par un humain : `platform`.
- Un champ de trop (`author`, `draftId`, un identifiant du chatteur) fait échouer le contrat.

## Hors périmètre
- Nommer le chatteur d'un message écrit directement sur Reveal : la base ne le sait pas (il faudrait le lire chez Reveal ou le rapprocher d'un brouillon placé, ADR 0086 § 5).
- L'écran (`apps/web`), sauf la correction minimale des fixtures de test que le contrat impose.

## Notes de session
- 2026-11-16 : pas de migration. Le nom vient de `team_members.display_name`, la même source que la vue `creator_on_duty`, lu sur la connexion admin comme les noms des collègues (ADR 0031), borné à un nom par brouillon corrigé de sa conversation.
- Question pour Charles : un brouillon corrigé par le propriétaire (pas de fiche de membre) rend `agency` ; quels mots à l'écran (« L'agence » ? son prénom ?) ?
