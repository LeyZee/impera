# 0166. Le départ d'un membre : une heure de fin, la coche Reveal, un espace de départ fermé

Statut : proposed (Charles, 21/11/2026 : « Fais ce que tu me recommandes là aussi pour le 10 », la recommandation étant l'espace de départ limité ; précisions de Sécurité du 21/11 intégrées)
Date : 2026-11-21

## Contexte

Aujourd'hui, « Parti » est un simple statut dans « Changer le statut » : il coupe tout à l'instant où le propriétaire clique, et un membre parti ne se connecte plus du tout (`databaseHooks.session.create.before` et `userOf` dans `apps/api/src/auth.ts`, choix de Charles du 28/10). Le chatteur parti ne voit donc plus ni son dernier relevé, ni sa dernière facture, qu'il doit pourtant accepter ou contester (EQ-06), ni où on le paie. Le compte membre Reveal, qu'Impera ne peut pas retirer (ADR 0025), n'est rappelé que par une ligne de texte.

EQ-14 décrit le parcours complet. Charles a choisi l'espace de départ limité plutôt que le refus total, à condition que Sécurité le valide.

## Décision

1. **« Faire partir »** s'ouvre depuis la fiche du membre, par le propriétaire seul. Il saisit une heure de fin (maintenant, ou plus tard dans les 31 jours) et un motif interne facultatif. Le motif est une note de la fiche, que le propriétaire et les managers lisent et jamais le membre. Il voit un aperçu de ce qui va se passer avant de confirmer. Un départ prévu s'annule tant que son heure n'est pas passée. Un membre a un seul départ prévu à la fois. « Parti » dans « Changer le statut » reste possible : c'est un départ immédiat, écrit comme un départ, pour que l'espace s'ouvre aussi. Préparer un départ par un manager vient plus tard.
2. **À l'heure de fin**, un job rejouable (`team.member_departure`, clé `team.member_departure:<id>`) fait en une transaction ce que fait aujourd'hui le passage à « Parti ». Le statut devient `left` avec son `left_on`, et `creator_ids` est vidé. Les sessions, les appareils de confiance et les clés d'accès sont révoqués. Ses modèles récurrents ne font plus de shift, puisqu'ils lisent son statut (règle déjà en place). Ses shifts à venir restent au planning, pâlis, et se comptent « À pourvoir » (règle déjà en place, EQP-03). Ses conversations sont rendues par `conversation.release_unavailable` (EQ-13) et son lien de calendrier ne répond plus (CR-12) : rien de neuf pour eux. Rejoué, le job ne fait rien de plus. Il s'applique au nom du propriétaire qui l'a posé, ou, s'il ne l'est plus, au nom d'un propriétaire en fonction ; le journal dit les deux. La charge du job nomme celui qui l'a posé, vérifié contre la ligne avant tout. Un départ encore prévu dix minutes après son heure est signalé en rouge dans Équipe. Celui qui annule ou coche est toujours le compte de la transaction (déclencheur).
3. **Côté Reveal.** Le parcours rappelle au propriétaire de retirer lui-même le compte membre Reveal. La coche « Accès Reveal retiré » est datée, signée et écrite au journal. Tant qu'elle manque, le départ reste signalé en ambre dans Équipe.
4. **L'espace de départ.** Un membre parti peut encore se connecter, avec son mot de passe et son deuxième facteur, tant que son espace est ouvert. Il lit alors seulement ce qui le concerne : ses relevés et leurs lignes, ses factures et avoirs (lire, accepter, contester, télécharger), son dossier de prestataire et ses pièces, ses contrats, et « Où te verser ». Il ne lit aucune créatrice : ses listes de créatrices, de créatrices routées et de shift sont vides.
   - Le serveur tient une **liste fermée** de routes, écrite dans le code (`DEPARTURE_SPACE_ROUTES`). Elle se compare au motif de la route enregistrée (méthode et chemin déclaré), jamais à l'URL reçue. Toute autre route répond 403 `departure_space_forbidden`, y compris une route ajoutée plus tard. Un test balaie toutes les routes enregistrées.
   - Le refus est le défaut pour tout ce qui n'est pas une route HTTP classique : flux d'événements, sockets, MCP et agents connectés, extension et son lien, prise de poste.
   - **La base dit la même chose que le code.** À l'heure de fin, la liste de créatrices du compte est vidée en base, pas seulement filtrée dans `userOf`. Les portes ne lui donnent jamais d'autre portée que « soi ». Un test le vérifie par la base seule.
   - Les lectures « sur lui seul » sont bornées par son compte côté serveur, pas par l'id de l'URL : un autre membre répond 404.
   - Un geste sensible (accepter ou contester une facture, changer où le verser) demande toujours une connexion récente, avec le mot de passe et le code.
   - **« Où te verser »** est le geste le plus risqué de l'espace : un compte volé juste avant le dernier virement. En plus de la connexion récente, de la notification et de l'ambre côté propriétaire, la limite y tombe à un changement par jour.
   - **Ses pièces** se lisent, ne s'ajoutent pas. Si une pièce manquante bloquait un jour la dernière facture, ouvrir le dépôt serait un choix de droits à poser à Charles.
   - **Connexion.** Tout chemin qui crée une session relit l'état de l'espace : mot de passe, réinitialisation du mot de passe, lien déjà envoyé. Pendant l'espace, aucune clé d'accès ni aucun appareil de confiance ne s'ajoute.
   - **Notifications.** À l'heure de fin, ses appareils ne reçoivent plus que les motifs de l'espace (facture, relevé, changement de versement). Plus rien des créatrices ni des fans.
5. **Fermeture.** L'espace se ferme quand trois conditions sont réunies : le relevé de la quinzaine du départ existe et est payé ou soldé, chaque facture et avoir du membre est réglé, et aucune acceptation ni contestation n'attend. Ce n'est pas un job : la règle est relue à chaque connexion et à chaque requête. Une fois l'espace fermé, aucune session n'est possible, même par un lien déjà envoyé : la connexion est refusée avec le même refus qu'aujourd'hui, et une session encore ouverte est refusée à sa requête suivante.
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
