# 2026-11-06 — La liste du design system garde son focus quand elle s'éteint

- **Fiche** : D-01 (design system), suite de #566 (les listes) ; vu en relisant #568 (Playground, choix de la persona).
- **Fait** : le champ de `Select` pose `aria-disabled` au lieu de `disabled`. Un formulaire qui éteint la liste pendant l'envoi d'un choix (le Playground) laissait tomber le focus sur la page, juste après qu'Entrée l'avait rendu au champ. Éteint, le champ reste atteignable au clavier, n'ouvre rien et ne choisit rien ; `.nv-select__field[aria-disabled='true']` porte le grisé.
- **Reste** : rien.
- **Découvertes** : aucune.
