# EQ-27 Retour de fin de shift léger
Statut : in_review (« ok maquette relecture » et « ok rapport léger », Charles, 26/11/2026)
Phase : équipe (ADR 0170 § A et son amendement du 26/11)
Dépend de : EQ-23 (retour de fin de shift et incidents)
Branche : claude/project-thread-cohhca-shift-review

## Objectif
Le retour de fin de shift devient obligatoire sans s'accumuler : il ne demande que ce qu'Impera ne voit pas, se fait en 30 secondes, arrive pré-rempli des chiffres du shift, et « Rien à signaler » reste un seul geste. Il est demandé à la prise de poste suivante ; un seul peut être en attente, un plus ancien expire, compte « sans retour » et ne se rattrape jamais. Le rapport avec montant (comptes sans ventes relevées) ne change pas et garde ses rappels (ADR 0077).

## À faire
- [x] Contrat : chiffres du shift (ventes relevées, brouillons tels quels / corrigés / rejetés, passages à l'équipe, fans écrits), question fermée sur les brouillons quand assez sont corrigés, remontées « l'IA » et « une idée », lier une remontée à un fan du shift.
- [x] Colonne `draft_reason` (migration provisoire 0262, à renuméroter au train).
- [x] Lecture `conversationReadsForShifts.activity` exposée par l'`index.ts` des conversations, lue dans la transaction de la planification.
- [x] Domaine pur `feedback-due` : retour dû, expiré, garde de la prise de poste, « sans retour ».
- [x] `GET /v1/scheduling/shift-feedback/pending` ; « Je prends mon poste » refusé (`shift_check_in_feedback_due_conflict`) tant que le retour dû n'est pas fait ; un retour d'un shift expiré refusé.
- [x] Une remontée liée à un fan part en note dans sa fiche (job `conversation.record_facts`, clé d'idempotence par remontée).
- [x] Écrans : chiffres du shift, question fermée, « Lier à un fan » dans le panneau ; prise de poste qui ouvre le retour dû ; tuile et lignes « Sans retour » dans Équipe › Rapports.
- [x] Tests : domaine, contrat, intégration (chiffres, garde, expiration, conflits, job), écrans.
- [ ] Captures validées par Design ; OK de Sécurité (lecture administrateur, route, garde de prise de poste, job de note).
- [ ] Extension : sa prise de poste doit traiter `shift_check_in_feedback_due_conflict` (fil Extension prévenu).

## Plafond du rôle de service
`modules/scheduling` passe de 29 à 30 : le dernier shift ouvert de chaque membre et s'il a son retour, toutes créatrices confondues, borné aux membres nommés (le sien, ou ceux des shifts que ses droits lui montrent). Lecture seule, à relire par Sécurité.

## Reste
« Mon bilan », contestation, dossiers « À trancher » et primes proposées (ADR 0170 §§ B à D) : PR suivante, après l'accord avec le fil Agent sur les remarques par conversation.
