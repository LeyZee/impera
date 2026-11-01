# 2026-10-27 — La bande du désir n'est plus coupée dans le Suivi (P3-12) — done
Fait : en recette locale, avec plusieurs créatrices, « Nora Vidal · A écrit à l'instant · joueur » perdait la bande sous les points de suspension, à 1 440 px comme à 400 px. `subline` rend le texte et la bande à part ; la ligne coupe le nom et l'heure, jamais la bande.
Pas fait : rien.
Décisions : aucune.
Découvertes (hors web, remontées au coordinateur) : `lastInboundAt` prend l'heure d'ingestion et non celle du message sur Reveal, si bien qu'un message relu cinq heures après dit « A écrit à l'instant » ; la note de passation `llm_unavailable` porte une raison technique (« llm_unavailable : no voice key ») que le lecteur affiche telle quelle.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, pnpm test ✓ (web : view.test.ts, TrackingPage.test.tsx) ; à l'œil sur la pile locale, 1 440 et 400 px.
