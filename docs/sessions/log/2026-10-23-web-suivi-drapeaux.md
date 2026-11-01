# 2026-10-23 — Suivi : les limites du fan, lues et changées dans le lecteur — done
Fait : le lecteur de Suivi montre « Limites du fan » (`GET /v1/fans/:id/flags`, #142), repliées sur une ligne qui les nomme (« Aucune » sinon), en ambre et ouvertes quand une limite empêche l'agent d'écrire ou de vendre (« Ne plus lui écrire », « Ventes gelées »), et qui restent ouvertes quand on la lève. Interrupteurs pour « Ne plus lui écrire », « Ventes gelées » (posé à la main : `freezeReason: 'operator'` ; la date et la raison d'un gel s'affichent), « Rien d'explicite », « Fan fragile ». « Âge confirmé » demande deux clics (« Confirmer son âge », puis « Oui, il est majeur ») et se retire en un. « Plafond de dépenses » se tape en euros (« 49,90 » → 4 990 centimes, réaffiché « 49,90 € ») et se lève. Chaque changement part en `PUT` et l'écran affiche ce que le serveur répond ; un refus laisse tout en l'état avec la raison. Une créatrice lit, rien n'est cliquable.
Pas fait : la raison facultative (`reason`) d'un changement n'a pas de champ.
Décisions : aucune.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, pnpm test ✓ (web) ; `flags-model.test.ts`, `TrackingPage.test.tsx` (ambre, gel, âge en deux clics, plafond en centimes, refus, créatrice en lecture) ; rendu dans Chromium à 1440 et 400 px, sans défilement horizontal.
