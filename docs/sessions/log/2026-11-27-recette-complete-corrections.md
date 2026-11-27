# 2026-11-27 — Recette complète du 27/11 : corrections — done

Fait : les constats de la recette complète du 27/11 (main 4ff57d6a), sur une copie locale et un jeu inventé.
- C1. « Du trafic à l'argent » ne montre plus de taux au-dessus de 100 % : `passRate` rend `null` quand une étape compte plus de fans que la précédente, et le pilotage le dit en une phrase.
- C4. Une validation différée (5 s) part à la fermeture de l'onglet : `Hold` passe `leaving` au flush de `pagehide`, la paie envoie alors tout en parallèle ; « tout cocher » se décoche pendant l'attente.
- C5. Sauvegardes ne dit plus que la paie attend un essai de restauration.
- G4, G13. La modèle et l'agence se préviennent : notification à l'agence (propriétaires et managers de sa liste) quand elle écrit, à elle quand l'agence répond ; la vente de la modèle porte son montant dans le titre.
- G8. Le gain de la quinzaine du chatteur dit ce qui attend la validation au lieu d'une baisse.
- G9. L'arrivée d'un fan se lit sur la plus ancienne de ses dates.
- G10, F4. La révélation des récompenses attend la fin du shift ; « Aussi gagné » plus lisible.
- G14. Suivi : rendre la main à tous les fans d'un groupe (IA indisponible, budget) en un geste.
- G15. Le planning ne présélectionne un membre que s'il est seul possible.
- G17, F5, G20. Débordement du champ de passation, titre « Réponses à relire », lien « Mots surveillés de … ».
- G19. Les alertes de vente donnent le montant et qui a vendu.
- G3. « Tes chiffres » cache une case sous 10 fans au lieu d'écrire « moins de 10 ».
- G6. « À faire » demande au chatteur d'installer et relier l'extension tant qu'aucun navigateur n'est relié.
- P2. La clé d'accès (Face ID) est proposée juste après les codes de secours, à l'activation.
- P7. Deux textes au masculin rendus neutres.
- F1, F2, F6. Pas de cadre de focus sur le titre de page ; cases de Ma journée à 44 px au téléphone ; une semaine pas encore calculée répond 204 au lieu de 404.
Pas fait : G1, F3 (attendent les réponses de Charles sur la story et le nombre de scripts) ; G7 (QR code de la double authentification : demande une dépendance, à accepter) ; G5 et l'écran d'accueil par rôle (maquette d'abord) ; C2, C3, G2, G11, G18 sont dans une autre PR ouverte.
Décisions : C6 retiré, le compte en « ventes lues » ne fait plus saisir de montant ; G11, G12, G16 et deux points de G20 laissés tels quels (voulus ou propres au bac à sable).
Découvertes : P6, « Mot de passe oublié » n'envoie le lien que par Telegram.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, tests unitaires des fichiers touchés ✓ ; intégration en CI (pas de Docker ici).
