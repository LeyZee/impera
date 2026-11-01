# 2026-10-27 — EQ-01 : écran Équipe › Membres — done
Fait : Équipe › Membres dans `apps/web/src/screens/team/`, sur les contrats d'EQ-01 et d'EQ-10 (`team-members.ts`, `invitation-links.ts`). `/equipe` passe dans les sections prêtes : rail du propriétaire (Dashboard, Suivi, Entraîner, Équipe, Créatrices, Réglages, sous les titres Chatting et Agence ; « Plus » sur téléphone) et du manager (Dashboard, Suivi, Équipe).
- Liste : recherche sans accents ni casse (nom, e-mail, pays), onglets chatteurs et managers dans l'URL (`?onglet=managers`, `?membre=`), ceux qui travaillent d'abord, partis repliés, résumé « 3 actifs · 2 absents · 2 invitations en attente ».
- Fiche : commission en grand avec son préréglage, heure chez lui, créatrices, e-mail, fuseau, arrivée, accès (invitation valable, expirée ou mot de passe choisi) et notes internes.
- Ajout en trois étapes (qui, où, taux) : pays avec drapeau, Bénin, Madagascar et France en tête ; fuseau proposé par le pays et modifiable ; préréglage en un geste ou taux à la main ; part du net pour un manager. Puis le lien d'invitation à copier ou partager, avec une reconnexion si le serveur la demande.
- États : vide, serveur absent, manager en lecture (il n'ajoute personne et ne crée pas de lien).
Pas fait : modifier la fiche, le statut ou le taux daté ; gérer les préréglages ; les pages « Bienvenue » et « Nouveau mot de passe » (fil Équipe).
Décisions : rien n'est présélectionné à l'étape du taux quand des préréglages existent, pour qu'un taux soit toujours un choix. Le membre parti n'a ni accès ni lien : le serveur répond `member_left_conflict`, l'écran le dit.
Découvertes : Windows dessine les drapeaux en lettres (BJ, MG) ; la table pays → fuseau proposé vit dans `apps/web`, elle pourra passer dans le domaine du module `team` s'il en a besoin ; le champ de date suit la langue du navigateur.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, pnpm test ✓ (web : `model.test.ts`, `MembersPage.test.tsx`, `nav.test.ts`, `AppShell.test.tsx`). Captures Nuit et Jour, 1440 et 390, mouvement réduit : https://claude.ai/artifact/Q5z1EbnCmSgRWrq67o486t
