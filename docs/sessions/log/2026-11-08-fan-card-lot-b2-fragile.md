# 2026-11-08 — ADR 0085, lot (b2) : « Le marquer fragile ? » dans « À traiter »

**Session** : Agent · **Branche** : `claude/project-thread-e0j3ow` · **Ordre** : « go » de Charles (08/11, 23 h 06) sur le lot (b2) de l'ADR 0085 acceptée ; migration 0159 attribuée par le coordinateur

Fait :
- Règle en code (`supervision/domain/fragile.ts`, `fragileProposal`) : un attachement fort sur sa fiche (liste fermée de mots), avec de la détresse (passation « détresse » de moins de 30 jours, ou une humeur de détresse sur sa fiche) ou des dépenses qui montent vite (sur 7 jours, au moins 2 fois sa moyenne par semaine des 8 semaines d'avant et au moins 50 €). Une proposition écartée ne revient pas avant 30 jours, sauf nouveau signe de détresse. Seuils dans `FRAGILE_PROPOSAL`.
- « À traiter » : nouvelle ligne ambre `fragile_proposed`, dans la dernière conversation du fan, calculée à la lecture (`fragileWaiting`, `dashboard-reader.ts`). La phrase dit quels signes, jamais une valeur de sa fiche (§ 10). Masquée sur Arrêt comme les autres lignes ambre.
- « Écarter » : `POST /v1/fans/:id/fragile/dismiss` (mêmes droits que changer ses limites), qui écrit `fan_fragile_dismissed` dans `domain_events` avec la personne en auteur. « Marquer fragile » reste `PUT /v1/fans/:id/flags`.
- Migration 0159 : le type d'événement entre dans les deux contrôles de type, et un index partiel lit le dernier écart par fan.
- Suivi : la proposition s'affiche dans « Avant de lui écrire » au-dessus de la fiche, avec « Marquer fragile » et « Écarter » ; un chatteur qui ne peut pas changer ses limites la lit sans les boutons.
- Tests : `fragile.test.ts` (règle), `fan-fragile.integration.test.ts` (détresse, dépenses, écart puis retour, marquage, 403 et 404), deux tests dans `TrackingPage.test.tsx`.
- Docs : glossaire (« Proposition fragile », « À traiter »), `data-model.md`.

Captures Nuit/Jour, PC et téléphone vues ; défauts corrigés : « Rien à signaler » et le titre répétés à côté de la proposition, délai « 0 min ».

Pas fait : les seuils attendent « ok fragile » de Charles.

Décisions :
- Rien n'est stocké pour une proposition : elle se recalcule à chaque lecture, seul l'écart est un événement. Aucune table nouvelle.
- Les dépenses sont lues dans ses messages payants débloqués (comme les meilleurs fans du Dashboard), ses dollars convertis au dernier taux BCE connu.

Découvertes : aucune.

Candidats à suppression : aucun.
