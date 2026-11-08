# 2026-11-08 — La fiche du fan dans le Suivi (ADR 0085, lot c) — en recette

**Session** : Extension et playground · **Branche** : `claude/extension-reveal-playground-45axcj`

Fait : la fiche du fan (contrat et routes du lot a, #662) se lit et se corrige dans le Suivi. L'essentiel (prénom, âge, ville, fantasmes, ce qu'il ne veut pas, ce qui se passe dans sa vie) est déplié en tête ; Lui, Ce qu'il aime chez elle et Intime sont pliés avec « N sur M ». Chaque valeur dit d'où elle vient (« Dit par lui », « Deviné », « Noté par Inès ») et une valeur devinée montre ses mots (« Il a écrit : « … » »). Ce que l'agent a lu contre une note d'un chatteur est en ambre, gardé d'un geste. Une adresse, un numéro, un e‑mail ou un compte ailleurs est refusé, rien n'est écrit. Un champ vide tient sur une ligne, son aide n'apparaît qu'à l'ouverture. La bande pliée dit « N à vérifier » au lieu de « Rien à signaler ». Dès 1320 px (demande de Charles, 08/11 18 h 32), le Suivi passe en trois colonnes : les fans, la conversation, et le fan toujours visible à droite, résumé et alertes fixes, le reste défilant.
Pas fait : rien sur ce lot.
Décisions : la fiche n'est montrée qu'à qui peut décider pour le fan (comme les questions à lui poser) ; jamais à la créatrice (ADR 0063).
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check, pnpm test (pre-push), captures Nuit/Jour PC/téléphone (`recette/2026-11-08/extension/fiche-fan/v2/`).
