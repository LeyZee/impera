# 2026-11-19 — PUB-01 Canal Telegram : la croix d'un créneau trop petite — done

**Session** : canal Telegram · **Branche** : `claude/project-thread-km6hfy`

Fait : la croix qui retire un créneau ou un exemple du canal est un bouton rond de 36 px à fond doux, à côté de champs de 44 px, au lieu d'un signe de 22 px presque invisible (remarque Design du 17/11). Sa zone de toucher reste à 44 px (test des cibles tactiles mis à jour). La croix d'un exemple est centrée sur la première ligne du champ.
Pas fait : rien.
Décisions : la croix des fiches persona (`.ps-entry__remove`) ne change pas ; seul le canal, où elle côtoie des champs pleine hauteur, a la grande.
Découvertes : la pile de recette locale demande maintenant `DATABASE_SERVICE_URL` et un `nirvana_admin` avec CREATEROLE (migration 0191).
Candidats à suppression : aucun.
Vérifié : tests web du canal et des cibles tactiles ; captures Nuit/Jour PC/téléphone dans /mnt/project-files/recette/2026-11-19/canal-croix/ ; pnpm check.
