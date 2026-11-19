# 2026-11-19 — Navigation, lot 1 (deuxième partie) : sélecteur de créatrice — en cours

Fait : le sélecteur de créatrice des ADR 0134 § 3 en tête du menu du propriétaire et du manager actif (`shell/CreatorScope.tsx`, mémoire dans `agent/scope.ts`), « Toutes » pour les vues de l'agence. Le Dashboard lit ce choix (ses pastilles « Toute l'agence » et créatrices disparaissent pour ces comptes ; un lien qui nomme une créatrice règle le sélecteur puis l'adresse lâche son nom), Suivi ne lit que la créatrice choisie, Fans n'a plus sa propre liste quand une créatrice est choisie, et sur Créatrices l'adresse reste le choix : la fiche règle le sélecteur sur elle, la liste sur « Toutes », et le lien du menu porte la créatrice choisie. Sur un téléphone le sélecteur se lit en tête de ces quatre écrans. `Select` accepte un visage devant le libellé (`lead`).
Pas fait : la barre de sous-onglets commune, « Dans mon téléphone » sur Planning, la carte de progression du chatteur, le point sur « Plus » : suite du lot.
Décisions : la pastille de Suivi dans le menu compte toujours toutes les créatrices, pour qu'aucune urgence ne se cache derrière le choix. Les comptes sans sélecteur (chatteur, créatrice) ne changent pas.
Découvertes : après un choix à la souris, `Select` rend le focus au champ avec son anneau visible, comme partout ailleurs ; à revoir dans le lot des contrôles.
Candidats à suppression : aucun.
Vérifié : typecheck ✓, tests web ✓. Vu à l'écran : voir le lot de captures de la PR.
