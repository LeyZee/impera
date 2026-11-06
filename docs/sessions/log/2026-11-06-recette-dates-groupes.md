# 2026-11-06 — Recette des champs jour par groupe d'écrans

- **Fiche** : D-01 (design system), suite de #569 : captures des champs jour dans chaque groupe d'écrans (Créatrices, Équipe, Paie, Planning, Agenda, Moi), défauts corrigés avant de les montrer.
- **Fait** :
  - Agenda : « Changer le moment » d'une tâche met Début et Fin côte à côte sur ordinateur, comme partout ailleurs ; un jour illisible se dit sous le champ une fois quitté (ajout, déplacement, suggestion), et plus seulement après un essai d'enregistrer.
  - Agenda : les propositions de l'agence « Sans date » s'affichaient seulement en liste (téléphone) ; elles sont aussi au-dessus de la semaine sur ordinateur et dans la vue du jour d'aujourd'hui (`UndatedSuggestions`, partagé).
  - Moi › Dossier : le bouton de fichier d'une pièce était celui du navigateur (« Choose File », en anglais) ; c'est maintenant une pastille du design system en français, avec le nom du fichier choisi dessous.
- **Relecture des fils de captures** :
  - Le champ jour prend toute sa colonne (il était bridé à 220 px, `.tm-date`) : aligné sur Début et Fin, sur le texte d'un congé, pleine largeur sur téléphone.
  - « 31/02 » est écrit comme un jour mais n'existe pas : les formulaires des captures le disent (« Ce jour n’existe pas. », `NO_SUCH_DAY`, `isDayShaped`), au lieu de rappeler comment écrire un jour. Le congé le dit sous le champ fautif, plus sous la paire.
  - Les numéros des étapes à venir (Nouveau membre, Relevé payé, sauvegardes, Telegram, facturation) ont une pastille neutre visible en Jour (`--nv-select`, le blanc du verre disparaissait sur la fenêtre).
  - Le « % » du pourcentage de l'agence est dans son champ, comme le € d'un relevé.
  - Sur une barre d'onglets qui défile (téléphone, persona), l'ombre de l'onglet allumé reste dans la barre au lieu d'être coupée en rectangle gris.
  - Ajouter (agenda) : titre et explication en haut des deux cartes « Une tâche » et « Une dispo ».
  - Le halo d'une pastille d'état première sur sa ligne (« À régler », « 1 modification ») s'aligne sur le bord du contenu de sa carte.
  - Sur téléphone, le fondu d'une barre d'onglets qui défile (Paie) est plus long et ses 20 derniers pixels sont vides : plus de mot coupé (« Expor… »), seulement l'amorce de l'onglet suivant (vu dans les captures de #573).
- **Relecture d'Équipe** : Moi › Dossier dit un jour illisible dès que son champ est quitté, comme l'agenda et le planning (plus seulement après « Déposer ») ; le champ de fichier refusé porte `aria-invalid`.
- **Captures** : `/mnt/project-files/recette/2026-11-06/extension/dates-groupes/lot1/` et `lot2/`, refaites dans `lot1/v2/` et `lot2/v2/`, puis `lot1/v3/` (halo des pastilles, onglets de Paie sur téléphone).
- **Reste** : rien.
- **Découvertes** : les cases radio « Les jours » de la vérification des ventes (Réglages › Ventes) sont encore natives. Les autres formulaires à champ jour disent encore « Un jour comme … » pour « 31/02 » ; `NO_SUCH_DAY` est prêt pour eux. Le design system ne grise pas `.nv-btn[aria-disabled='true']` (vu en relisant #574).
