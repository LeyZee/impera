# 2026-11-02 — ARC-02 : l'assemblage module par module
Fait : `apps/api/src/wiring/<module>.ts` pour les quinze modules, chacun construit son module, ses routes et ses jobs ; `composition-root.ts` passe de 891 à environ 350 lignes et garde l'ordre et les dépendances communes ; élément ESLint `api-wiring` importé par `composition-root.ts` seul.
Décisions : `TasksOf<préfixe>` type les jobs d'un fichier sur ceux de son module, la liste fusionnée reste typée sur tous les jobs ; les chemins (polices, personas) restent au composition root à cause du paquet tsup.
Pas fait : le découpage de la paie (ARC-03).
Découvertes : —
