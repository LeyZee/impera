# EQ-26 Dispos hebdomadaires, et qui est dispo sur chaque place libre
Statut : in_review (trous béants n° 16, validé par Charles le 21/11/2026 : « Dispos hebdomadaires, et qui est dispo sur chaque place libre »)
Phase : équipe (ADR 0168, numéro provisoire)
Dépend de : EQ-02 (planning)
Branche : claude/project-thread-cohhca-availability

## Objectif
Le chatteur dit une fois la semaine où il peut travailler. Sur chaque place à pourvoir, le manager voit qui de la créatrice est dispo, sans demander sur WhatsApp ; rien n'est posé tout seul.

## À faire
- [x] ADR 0168 (proposée) : plages au quart d'heure dans le fuseau du membre, semaine posée en entier, droits, lecture sur les places, rien d'automatique.
- [x] Table `member_availability_weeks` en ajout seul (FORCE RLS, `refuse_change`, lecture seule pour le rôle de service), migration provisoire 0256 à renuméroter au train.
- [x] Contrat `member-availability.ts`, magasin `availability-store`, quatre routes, journal `member_availability.set`.
- [x] Écrans : « Mes dispos » dans le Planning du chatteur (carte repliée, éditeur jour par jour, passage de minuit, rappel après 30 jours) ; « N dispos » sous chaque place à pourvoir du planning ; dans « Nouveau shift », les membres dispos en tête (« dispo »), puis ceux qui couvrent une partie avec leurs heures, et combien n'ont rien donné.
- [x] Tests : intégration (écriture, idempotence, bornes, droits, ajout seul), unitaires (couverture d'une place, fuseaux, minuit), écrans.
- [ ] Captures validées par Design ; OK de Sécurité sur les droits et les routes ; numéros (migration, ADR) par Bilan.

## Reste
- L'écran où un manager pose la semaine d'un chatteur : la route existe (`PUT /v1/scheduling/availability/:memberId`), pas l'écran.
- « Occupé » ne lit que les shifts de la semaine affichée : une place en bord de semaine peut compter dispo un membre qui a un shift juste de l'autre côté. Le serveur refuse de toute façon un chevauchement à la pose.
