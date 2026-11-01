# 2026-10-29 — Recette design Créatrices — done
Fait (branche locale `design/creatrices`, constats CREA-* de la recette design du 28/10) :
- Onglets de la persona : huit onglets sur une ligne à 1440 ; au-delà d'un bord, la barre s'estompe et un chevron ramène les onglets cachés en portant en ambre le nombre de champs à corriger qu'ils contiennent ; l'onglet choisi vient au milieu (CREA-01, CREA-02).
- « Elle en détail » regroupe les cinq blocs P5-01 en sections repliées (ouvertes d'office quand l'une a un champ à corriger), placé après Infos en plus, Limites en dernier (CREA-02).
- En-tête : prénom, puis « Version x · date » ou « Jamais enregistrée » ; une ligne d'état seulement quand il y a quelque chose à dire (CREA-05, CREA-06 sans objet). « Active », « Activer la version » et la note de `main` restent tels quels : CREA-04 est repris par le lot persona de la recette fonctionnelle, qui fait lire la version active à l'agent.
- Première visite calme : prénom pré-rempli depuis son nom, « N champs à remplir avant d'enregistrer » au point gris, aucun champ cerclé avant une saisie (CREA-13) ; la jauge ne dit jamais 100 % tant qu'un champ attend (CREA-14).
- Barre d'enregistrement collante (`SaveBar`) sur la persona et les heures quand l'en-tête est hors champ ; au-dessus de la capsule sur téléphone (CREA-20).
- Heures d'activité : créneaux rangés par jour avec « + Ajouter » par jour (et, quand il n'ajoute rien, la raison écrite dans la ligne du jour), ordre stable pendant la saisie, enregistrés triés, interrupteurs neutres, note « Hors de ses créneaux » sous le mode Par créneaux (CREA-21, CREA-22, CREA-23).
- Textes : « Règle stricte » une fois par groupe (titre de bloc ou de repli), la phrase des styles dite une fois dans l'intro de Stratégies, titres de bloc en encre au-dessus des libellés, « Faire connaissance », « Infos à collecter » d'abord puis « Autre chose à savoir (facultatif) », seuils de désir en clair (« À partir de 45 : dès qu'il devient joueur. »), unités sur les bornes (« 60 min au plus »), Infos en plus réorientée, lien Réglages › Alertes par le routeur pour le propriétaire et sans lien pour les autres rôles (de même, « à changer dans Heures d'activité » n'est dit qu'au propriétaire), « Ajouter un dégoût », « Passions et caractère », fuseau en ligne de texte (CREA-08, CREA-09, CREA-10, CREA-11, CREA-12, CREA-15, CREA-17, CREA-25, CREA-27, CREA-29).
- Mise en page : une seule largeur de fiche, sourcils retirés sous le sélecteur, puces de créatrices sur une ligne défilante au téléphone, confirmation de départ alignée, chiffres sans police mono, replis lisibles au téléphone, phrase d'accueil sans créatrice (CREA-03, CREA-07, CREA-16, CREA-18, CREA-19, CREA-24, CREA-26, CREA-28).
- Glossaire : « Elle en détail ».

Recommandations acceptées par Charles le 29/10 00h22 (citées telles quelles) :
- CREA-02 : « Garde-t-on les 6 onglets d’OnlyChat dans leur ordre en tête, et regroupe-t-on les 5 blocs P5-01 dans un seul onglet « Elle en détail » (sections repliées, placé après Infos en plus) avec Limites en dernier, soit 8 onglets ? Recommandation : oui — on reste dans le cadre OnlyChat que tu as fixé, la barre tient sur une ligne et les blocs (facultatifs, appelés à remplacer Infos en plus) restent à un clic. » — accepté par Charles le 29/10 00h22.
- CREA-11 : « Garde-t-on les deux champs, la liste « Infos à collecter » en premier et le texte libre renommé « Autre chose à savoir (facultatif) » ? Recommandation : oui — on ne retire pas le champ d’OnlyChat, mais on dit clairement lequel pilote l’agent. » — accepté par Charles le 29/10 00h22.
- CREA-12 : « Réoriente-t-on Infos en plus vers « ce que les autres onglets ne disent pas » au lieu de lister identité, voix, passions… ? Recommandation : oui — sinon la même info est écrite à deux endroits et peut se contredire. » — accepté par Charles le 29/10 00h22.

Pas fait :
- CREA-27, partiel : la création demande encore le fuseau en texte (`NewCreatorForm.tsx`, verrouillé pour cette session).
- CREA-30, partiel : `retry: 1` posé sur `useAgentHours` ; `useCreators` est dans `creators/api.ts`, verrouillé.

Décisions : aucun changement du schéma de persona ni de l'API ; les blocs restent séparés dans les données, « Elle en détail » est un regroupement d'écran.

Retiré : `thresholdHint` (`apps/web/src/agent/desire.ts`) et son test, sans appelant depuis que les seuils de désir disent leur phrase en clair (`desireHint`).

Découvertes : aucune.

Vérifié : `pnpm check` ✓ ; web typecheck, lint ✓ ; `vitest run` web ✓ (79 fichiers, 732 tests) ; captures avant/après Nuit et Jour à 1440 et Nuit à 390 (`.scratch/design-audit/shots/creatrices-apres/`).
