# 2026-11-16 — Recette agence du 16/11, PIL-01 : lien du Dashboard vers une créatrice introuvable — in_progress

Fait : un lien `/?creatrice=<id>` vers une créatrice archivée ou inconnue affichait les chiffres et le sélecteur de mode de la première créatrice de la liste, sous l'adresse de l'autre. Le Dashboard lit maintenant la créatrice que l'adresse nomme ou rien (`useLiveDashboard(period, shown, exact)`, état `missing`) : « Créatrice introuvable », aucune lecture de `GET /v1/dashboard`, aucun chiffre, aucun sélecteur de mode, un seul bouton de sortie (« Voir toute l'agence » pour le propriétaire et un manager actif, « Revenir au Dashboard » sinon). Test instable réparé à la demande du coordinateur (main rouge après #770, sans lien avec elle) : `ScriptsSection.test.tsx` lisait « Corrigée » sans attendre la réponse du serveur, parce que le texte attendu était déjà dans le champ en cours d'enregistrement ; il attend maintenant « Corrigée ». Tests : état introuvable (rien d'une autre, pas de lecture, sortie), créatrice nommée et listée.
Pas fait : rien.
Décisions : aucune.
Découvertes : la pastille de l'agent sur la fiche d'une créatrice archivée (`/creatrices?creatrice=`) retombe aussi sur la première de la liste ; elle la nomme et n'agit pas, laissée telle quelle. `followCreator` garde en mémoire un identifiant inconnu venu de l'adresse ; sans effet, la liste retombe sur la première.
Candidats à suppression : aucun.
Vérifié : pnpm check, pnpm test (voir la PR).
