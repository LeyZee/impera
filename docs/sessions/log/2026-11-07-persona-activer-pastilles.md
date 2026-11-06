# 2026-11-07 — Persona, bouton « Activer » qui ne faisait rien et pastilles serrées — done
Fait : « Activer la version N » (en-tête) et « Réactiver la version N » (Ses versions) ouvrent une fenêtre : titre, ce qui change pour ses fans (et à la place de quelle version), « Annuler » / « Activer ». Si la connexion a plus de 10 minutes, la même fenêtre demande ensuite le mot de passe et le code. Les pastilles Passions et Personnalité sont de nouveau espacées et un texte long passe à la ligne au lieu d'être coupé ; la croix reste dans la pastille.
Pas fait : rien.
Décisions : la confirmation en deux clics sur le même bouton disparaît. Le premier clic ne faisait que changer son texte pendant 4 s, sans rien envoyer : relevé sur le poste de Charles (aucune requête d'activation entre 19:55 et 20:12 UTC). Une fenêtre ne disparaît pas toute seule.
Découvertes : la règle `.nv-field__control { display: block }` du design system écrase toute classe de composant posée sur le même élément ; le composant doit viser les deux classes.
Candidats à suppression : aucun.
Vérifié : tests web de la persona, tsc et eslint sur les fichiers changés, captures Nuit et Jour, ordinateur et téléphone, validées (« ok captures activation »).
