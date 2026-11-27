# 0171. Les dispos hebdomadaires du chatteur, et qui est dispo sur chaque place libre

Statut : proposed (trous béants n° 16, correction validée par Charles le 21/11/2026 à 15 h 52 : « Dispos hebdomadaires, et qui est dispo sur chaque place libre » ; numéro confirmé par Bilan le 27/11)
Date : 2026-11-26

## Contexte

Le planning de l'équipe montre les places « à pourvoir » de chaque créneau (ADR 0023, EQ-02). Rien ne dit qui peut les prendre : le manager remplit à l'aveugle, puis demande sur WhatsApp. Les chatteurs vivent dans plusieurs fuseaux (France, Bénin, Madagascar), et leurs semaines ne se ressemblent pas.

## Décision

1. **Une dispo est une plage de la semaine** : un jour (lundi à dimanche), une heure de début et une heure de fin, au quart d'heure, dans le **fuseau du membre** (celui de son dossier). Une plage qui passe minuit s'arrête au jour suivant. Au plus 21 plages par semaine.
2. **La semaine se pose en entier.** Le membre enregistre toutes ses plages d'un coup ; la nouvelle semaine remplace la précédente à partir de l'instant où elle est écrite, jamais en arrière. Les semaines passées restent, en ajout seul : on sait ce que le membre avait dit quand un shift a été posé.
3. **Qui les écrit** : le membre lui-même, depuis Planning (« Mes dispos »). Le propriétaire et un manager actif peuvent les poser pour lui (un chatteur qui dicte au téléphone ; Charles, 26/11 à 17 h 00 : « Oui, journalisé ») ; le journal le dit. Un manager ne le fait que pour les membres qui partagent au moins une de ses créatrices. Personne d'autre.
4. **Qui les lit** : le membre, les siennes ; le propriétaire, celles de toute l'équipe ; un manager actif, celles des membres qui partagent au moins une de ses créatrices (la table n'a pas de créatrice : le magasin borne, la base garde le périmètre d'équipe). Un chatteur ne lit jamais les dispos d'un autre.
5. **Sur chaque place libre**, le propriétaire et le manager lisent qui est dispo : un membre actif, affecté à la créatrice de la place, dont une plage couvre **toute** la place, et qui n'a aucun shift qui la chevauche. Ceux dont une plage n'en couvre qu'une partie viennent après, avec ce qu'ils couvrent (« de 14 h à 18 h »). Rien n'est réservé et rien n'est posé tout seul : le manager choisit, comme aujourd'hui.
6. **Sans dispos**, un membre n'apparaît sur aucune place, et le planning le dit au manager (« 2 membres n'ont pas donné leurs dispos »). Un membre qui n'a pas mis à jour ses dispos depuis 30 jours voit un rappel discret dans « Mes dispos », jamais une alerte.
7. **Rien d'automatique** : une dispo ne crée ni shift, ni obligation, ni malus. C'est une information pour remplir le planning.

## Conséquences

- Positives : le manager remplit une place en voyant d'un coup qui peut la prendre ; le chatteur dit une fois sa semaine au lieu de répondre à des messages.
- Négatives : une table de plus (`member_availability_weeks`, une ligne par semaine posée, ses plages en liste typée) ; les plages vivent dans le fuseau du membre et se convertissent dans celui de l'agence pour être comparées aux places, ce qui demande des tests aux changements d'heure.
- À surveiller : des dispos jamais mises à jour. Le rappel à 30 jours est là pour ça ; le manager garde le dernier mot.

## Alternatives rejetées

- **Des dispos par créneau de l'agence** (cocher les créneaux) : plus simple à saisir, mais faux dès que l'agence change ses créneaux, et un chatteur dispo de 18 h à 22 h ne rentre dans aucun créneau de six heures.
- **Des dispos datées, semaine par semaine** : plus fines, mais une corvée chaque semaine ; une absence ponctuelle reste un sujet à part.
- **Proposer la place aux dispos par notification** : utile plus tard ; d'abord rendre la lecture juste.
