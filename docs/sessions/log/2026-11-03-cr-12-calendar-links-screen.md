# 2026-11-03 — CR-12 Calendrier des shifts, lot c2 (Moi › Agenda) — in_progress
Fait : écran `screens/me/MyCalendarLinkPage.tsx` (`/moi/agenda`, onglet « Agenda » de Moi pour le chatteur et le manager) : créer le lien, l'adresse montrée une seule fois (Apple Agenda en `webcal://`, Google Agenda par `cid`, copie), puis depuis quand il marche, le remplacer ou le couper après confirmation ; `scheduling/calendar-link.ts` compose les trois adresses sur l'origine du tableau de bord ; lectures et écritures dans `scheduling/api.ts` ; messages des deux codes d'erreur dans `scheduling/model.ts`.
Pas fait : l'essai à l'œil dans Apple Agenda et Google Agenda (après déploiement : Google lit l'adresse depuis ses serveurs) ; la couche de la créatrice (CR-05).
Décisions : l'onglet vit dans Moi (ADR 0045 § 5, « dans Moi ») et pas dans Planning ; l'adresse disparaît dès « C'est fait » et ne revient jamais, l'écran ne dit plus que la date ; « Couper » et « Remplacer » disent d'abord ce qu'ils font, sans fenêtre.
Découvertes : les boutons `nv-btn--sm` font 34 px de haut sur téléphone ici comme dans Moi › Sécurité ; une passe téléphone commune les mettrait à 44 px.
Candidats à suppression : aucun.
Vérifié : tests web `MyCalendarLinkPage` 2 ✓, `calendar-link` 2 ✓, `shell` ✓ ; captures Nuit/Jour, 390 et 1 440 px, quatre états, mouvement réduit.
