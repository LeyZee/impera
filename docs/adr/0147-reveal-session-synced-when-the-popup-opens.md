# 0147. La session Reveal se synchronise seule à l'ouverture du popup

Statut : proposed (demande de Charles du 16/11/2026, 23 h 04 : « je vais devoir me synchroniser tous les jours. Il n'y a pas un moyen d'éviter ça ? » ; accord sur le principe à 23 h 05 : « si on peut avoir la synchronisation automatique quand on ouvre l'extension, ça peut être vraiment un plus » ; numéro 0147 attribué par le coordinateur ; relecture Sécurité, puis « ok 0147 » de Charles avant le code)
Date : 2026-11-16
Précise : ADR 0050 (le chemin de la session capturée), ADR 0066 § 7 (« Synchroniser » au propriétaire seul, inchangé). Amende la fiche P2-01 sur un point : la session n'est plus lue seulement « le temps du clic », elle l'est aussi à l'ouverture du popup, dans les limites du § 2.

## Contexte

Le connecteur agit sur Reveal avec la session du compte Reveal de l'IA, que le propriétaire recopie depuis son Chrome avec « Synchroniser » dans le popup de l'extension (P2-01). L'extension lit le jeton dans les en-têtes des requêtes que l'onglet Reveal fait déjà, l'envoie au serveur, qui la garde chiffrée, puis l'oublie.

Ce jeton vaut 24 heures à compter de la connexion à Reveal et ne se renouvelle pas. Il faut donc se reconnecter à Reveal chaque jour, puis cliquer « Synchroniser ». Charles accepte la reconnexion quotidienne (il ouvre Reveal tous les jours de toute façon), mais pas le clic en plus, qu'on oublie et qui arrête le connecteur.

Une connexion automatique à Reveal est exclue : elle demanderait de garder les identifiants du compte, et une connexion qui ne vient pas d'une personne met le compte en risque.

## Décision

1. **Le déclencheur.** À l'ouverture du popup, l'extension synchronise seule la session quand toutes ces conditions sont réunies :
   - la personne est le propriétaire, avec une liaison d'extension valide ;
   - l'onglet actif est Reveal ;
   - le CRM dit que la session du compte manque, est expirée ou expire bientôt. Le seuil de « bientôt » est l'état `warning` du serveur, et l'extension n'en garde aucun.

   Rien d'autre ne déclenche : pas d'horloge, pas d'écoute permanente en tâche de fond, rien chez un chatteur ni chez la créatrice.
2. **La même lecture qu'au clic, en plus étroite.** L'extension lit les en-têtes des requêtes que l'onglet fait déjà vers l'API de Reveal, jamais leur corps, jamais un autre site. L'écoute s'arrête dès que la session est lue, et au plus tard au délai de P2-01. En automatique, l'extension ne recharge jamais l'onglet : le rechargement reste réservé au clic « Synchroniser ». L'extension ne fait aucun appel à Reveal, ne remplit aucun formulaire et ne touche à aucun identifiant.
3. **Le bon compte, ou rien.** La session lue n'est envoyée qu'au seul compte du connecteur dont la modèle est celle que l'onglet nomme. Pour le savoir, l'identifiant Reveal de la modèle s'ajoute à la liste des comptes que le serveur donne à l'extension. Si aucun compte ne correspond, ou si plusieurs correspondent, rien n'est envoyé et rien ne s'affiche en rouge : le bouton « Synchroniser » reste là.
4. **Rien de gardé.** Comme pour P2-01, la session vit dans la seule fonction qui l'envoie : jamais dans le stockage de l'extension, jamais dans un journal, jamais renvoyée au popup.
5. **Ce que voit le propriétaire.** La ligne du compte dans le popup dit jusqu'à quelle heure la session vaut, à l'heure locale. Après une synchronisation seule, elle dit « Synchronisée à l'ouverture ». Le CRM prévient le propriétaire avant l'expiration, avec la même heure, que le serveur renvoie (fil Bilan).
6. **Une fois par ouverture.** Une synchronisation seule au plus par ouverture du popup, et aucune quand le CRM dit la session valide hors `warning`. Le serveur accepte déjà la même session deux fois sans rien casser (P2-01).

## Conséquences

- Positives : plus de clic quotidien. Il suffit de se connecter à Reveal dans Chrome sur le compte de l'IA, puis d'ouvrir le popup. Le connecteur ne s'arrête plus faute d'un clic oublié. L'heure d'expiration se voit sans aller la chercher.
- Négatives : la reconnexion quotidienne à Reveal reste. La synchronisation ne marche que dans le Chrome connecté sur le compte de l'IA : un chatteur qui ouvre Reveal avec son propre compte ne rafraîchit rien.
- À surveiller : si Reveal change la forme de ses requêtes, la synchronisation seule échoue sans bruit. Le bouton et l'alerte d'expiration du CRM restent alors le filet. La relecture Sécurité porte sur les § 1 à 4.

## Alternatives rejetées

- Connexion automatique à Reveal avec les identifiants du compte : il faudrait garder les identifiants, et une connexion faite par un programme met le compte en risque.
- Écoute permanente des requêtes de Reveal en tâche de fond : elle lirait l'onglet sans que personne ne l'ait demandé. L'ouverture du popup est un geste du propriétaire.
- Recharger l'onglet en automatique, comme au clic : c'est une action sur Reveal que personne n'a demandée.
- Renouveler le jeton par une route de Reveal : aucune n'est connue, et ce serait un appel de plus vers Reveal.
