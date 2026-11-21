# 0166. Le départ d'un membre : une heure de fin, la coche Reveal, un espace de départ fermé

Statut : proposed (Charles, 21/11/2026 : « Fais ce que tu me recommandes là aussi pour le 10 », la recommandation étant l'espace de départ limité ; revue Sécurité attendue)
Date : 2026-11-21

## Contexte

Aujourd'hui, « Parti » est un simple statut dans « Changer le statut » : il coupe tout à l'instant où le propriétaire clique, et un membre parti ne se connecte plus du tout (`databaseHooks.session.create.before` et `userOf` dans `apps/api/src/auth.ts`, choix de Charles du 28/10). Le chatteur parti ne voit donc plus ni son dernier relevé, ni sa dernière facture, qu'il doit pourtant accepter ou contester (EQ-06), ni où on le paie. Le compte membre Reveal, qu'Impera ne peut pas retirer (ADR 0025), n'est rappelé que par une ligne de texte.

EQ-14 décrit le parcours complet. Charles a choisi l'espace de départ limité plutôt que le refus total, à condition que Sécurité le valide.

## Décision

1. **« Faire partir »** remplace « Parti » dans « Changer le statut » : la route du statut refuse désormais `left` (`member_departure_required_conflict`, 409). Le propriétaire seul ouvre le parcours depuis la fiche du membre. Il saisit une heure de fin (maintenant, ou plus tard dans les 31 jours) et un motif interne facultatif (500 caractères, lu du seul propriétaire, jamais du membre). Il voit un aperçu de ce qui va se passer avant de confirmer. Un départ prévu s'annule tant que son heure n'est pas passée. Un membre a un seul départ prévu à la fois. Préparer un départ par un manager vient plus tard.
2. **À l'heure de fin**, un job rejouable (`team.member_departure`, clé `team.member_departure:<id>`) fait en une transaction ce que fait aujourd'hui le passage à « Parti ». Le statut devient `left` avec son `left_on`, et `creator_ids` est vidé. Les sessions, les appareils de confiance et les clés d'accès sont révoqués. Les modèles récurrents du membre s'arrêtent à l'heure de fin. Ses shifts à venir restent au planning, pâlis, et se comptent « À pourvoir » (règle déjà en place, EQP-03). Ses conversations sont rendues par `conversation.release_unavailable` (EQ-13) et son lien de calendrier ne répond plus (CR-12) : rien de neuf pour eux. Rejoué, le job ne fait rien de plus.
3. **Côté Reveal.** Le parcours rappelle au propriétaire de retirer lui-même le compte membre Reveal. La coche « Accès Reveal retiré » est datée, signée et écrite au journal. Tant qu'elle manque, le départ reste signalé en ambre dans Équipe.
4. **L'espace de départ.** Un membre parti peut encore se connecter, avec son mot de passe et son deuxième facteur, tant que son espace est ouvert. Il lit alors seulement ce qui le concerne : ses relevés et leurs lignes, ses factures et avoirs (lire, accepter, contester, télécharger), son dossier de prestataire et ses pièces, ses contrats, et « Où te verser ». Il ne lit aucune créatrice : ses listes de créatrices, de créatrices routées et de shift sont vides.
   - Le serveur tient une **liste fermée** de routes, écrite dans le code (`DEPARTURE_SPACE_ROUTES`, méthode et chemin). Toute autre route répond 403 `departure_space_forbidden`, y compris une route ajoutée plus tard. Un test balaie toutes les routes enregistrées.
   - L'extension, le lien d'extension, les agents connectés et la prise de poste le refusent, comme aujourd'hui.
   - Un geste sensible (accepter ou contester une facture, changer où le verser) demande toujours une connexion récente, avec le mot de passe et le code.
5. **Fermeture.** L'espace se ferme quand trois conditions sont réunies : le relevé de la quinzaine du départ existe et est payé ou soldé, chaque facture et avoir du membre est réglé, et aucune acceptation ni contestation n'attend. Ce n'est pas un job : la règle est relue à chaque connexion et à chaque requête. Une fois l'espace fermé, la connexion est refusée avec le même refus qu'aujourd'hui, et une session encore ouverte est refusée à sa requête suivante.
6. **Journal** (`audit_log`) : départ prévu, départ annulé, départ appliqué par le job (avec les sessions révoquées, comme aujourd'hui), coche Reveal. Les connexions sont déjà journalisées.
7. **Hors de cet ADR** (plus tard, fiche EQ-14) : l'alerte « à pourvoir » envoyée au manager pour chaque créneau libéré, l'effacement de la photo, des abonnements push et des préférences à la fermeture, le retour d'un membre parti, et le départ préparé par un manager.

## Conséquences

- Positives : le chatteur parti accepte sa dernière facture et voit son dernier versement sans demander à personne. Le propriétaire n'oublie plus Reveal. Le départ peut être prévu à l'heure de fin du dernier shift.
- Négatives : un compte parti peut encore se connecter pendant quelques semaines, sans rien lire au-delà de son propre dossier. Une route ajoutée plus tard reste fermée à l'espace de départ tant que personne ne l'ajoute à la liste.
- À surveiller : qu'aucune lecture de l'espace ne serve de porte vers une créatrice. La liste est petite et le balayage la tient.

## Alternatives rejetées

- **Refus total de connexion** (l'état du 28/10) : le membre ne peut ni accepter ni contester sa dernière facture, et l'acceptation tacite le fait pour lui sans qu'il l'ait vue.
- **Un lien par e-mail pour chaque facture** : plus de portes à garder, et pas de vue de ses relevés.
- **Garder le scope `self` d'un membre en congé** : il ouvre bien plus de routes (planning, rapports, annonces) qu'un membre parti n'a à lire.
