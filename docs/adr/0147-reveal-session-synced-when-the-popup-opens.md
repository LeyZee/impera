# 0147. La session Reveal se synchronise seule à l'ouverture du popup

Statut : accepted (Charles, 16/11/2026, 23 h 14, « ok 0147 » ; relu et approuvé par Sécurité sur le texte, 23 h 11 ; demande de Charles du 16/11/2026, 23 h 04 : « je vais devoir me synchroniser tous les jours. Il n'y a pas un moyen d'éviter ça ? » ; accord sur le principe à 23 h 05 : « si on peut avoir la synchronisation automatique quand on ouvre l'extension, ça peut être vraiment un plus » ; numéro 0147 attribué par le coordinateur)
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
   - le compte a déjà été synchronisé une fois à la main : le premier branchement d'un compte reste un clic sur « Synchroniser » ;
   - le CRM dit que la session du compte est expirée ou expire bientôt. Le seuil de « bientôt » est l'état `warning` du serveur, et l'extension n'en garde aucun.

   Rien d'autre ne déclenche : pas d'horloge, pas d'écoute permanente en tâche de fond, rien chez un chatteur ni chez la créatrice.

2. **Le serveur arbitre.** La route qui reçoit la session refuse déjà toute liaison qui n'est pas celle d'un propriétaire (ADR 0066 § 7). La demande porte une valeur « à l'ouverture » ou « au clic », pour que le journal distingue les deux gestes ; le journal n'écrit jamais le jeton. La limite de débit de la route ne change pas. Une synchronisation « à l'ouverture » sur un compte qui n'a encore aucune session est refusée.
3. **La même lecture qu'au clic, en plus étroite.** L'écoute est bornée :
   - elle porte sur le seul onglet actif, désigné par son identifiant, en https, avec l'hôte de Reveal comparé exactement (jamais « contient ») ;
   - elle ne lit que les requêtes du cadre principal vers la seule origine de l'API de Reveal, et seulement leurs en-têtes, jamais leur corps ;
   - c'est le service worker qui la pose, et il la retire dès que la session est lue, au délai de P2-01, à la fermeture de l'onglet ou au changement d'onglet.

   Sans requête dans le délai, il ne se passe rien, sans erreur rouge. En automatique, l'extension ne recharge jamais l'onglet : le rechargement reste réservé au clic « Synchroniser ». L'extension ne fait aucun appel à Reveal, ne remplit aucun formulaire et ne touche à aucun identifiant.
4. **Le bon compte Reveal, ou rien.** Le risque propre à l'automatique est le mauvais compte : Chrome peut être connecté sur un autre compte Reveal que celui de l'IA, par exemple celui de la créatrice ou celui du propriétaire. Trois règles le ferment :
   - **L'identité est figée par un clic.** L'identité du compte Reveal de l'IA est le membre que la session nomme. Le serveur la fige à la première synchronisation manuelle (P2-02). La synchronisation seule ne crée ni ne change jamais cette identité.
   - **Le serveur refuse le reste.** Une session d'un autre membre, ou d'une autre modèle que celle du compte, est refusée et jetée par le serveur, sans rien stocker ; la ligne de refus du journal ne garde que qui, quel compte et pourquoi. Le contrôle ne repose pas sur le tri de l'extension. Bilan confirme, à la réception, que le membre nommé est bien celui du jeton : soit par le jeton lui-même s'il le dit, soit par la vérification que le connecteur fait déjà. L'extension, elle, ne fait toujours aucun appel.
   - **L'extension trie aussi.** Elle n'envoie la session qu'au seul compte du connecteur dont la modèle est celle que l'onglet nomme. Pour le savoir, l'identifiant Reveal de la modèle s'ajoute à la liste des comptes du connecteur, pour la liaison d'un propriétaire seulement, jamais pour celle d'un chatteur ou de la créatrice. Cet identifiant ne va dans aucun journal ni message d'erreur. Si aucun compte ne correspond, ou si plusieurs correspondent, rien n'est envoyé et rien ne s'affiche en rouge : le bouton « Synchroniser » reste là.
5. **Rien de gardé.** Comme pour P2-01, la session vit dans la seule fonction du service worker qui l'envoie. Elle ne passe jamais par le popup ni par un script de contenu, n'entre jamais dans le stockage de l'extension (`chrome.storage`, session comprise) ni dans un journal, et ne part que vers l'origine du CRM de la liaison. Les tests n'emploient que des valeurs inventées.
6. **Ce que voit le propriétaire.** La ligne du compte dans le popup dit jusqu'à quelle heure la session vaut, à l'heure locale. Après une synchronisation seule, elle dit « Synchronisée à l'ouverture » avec cette heure : le propriétaire voit que c'est parti sans lui, et ce point fait partie de la sécurité de la règle. Le CRM prévient le propriétaire avant l'expiration, avec la même heure, que le serveur renvoie (fil Bilan).
7. **Une fois par ouverture.** Une synchronisation seule au plus par ouverture du popup, et aucune quand le CRM dit la session valide hors `warning`. Le serveur accepte déjà la même session deux fois sans rien casser (P2-01). Quand la session en place vaut encore et que les échéances se lisent, le serveur ne la remplace pas par une session qui expire plus tôt.

## Conséquences

- Positives : plus de clic quotidien. Il suffit de se connecter à Reveal dans Chrome sur le compte de l'IA, puis d'ouvrir le popup. Le connecteur ne s'arrête plus faute d'un clic oublié. L'heure d'expiration se voit sans aller la chercher.
- Négatives : la reconnexion quotidienne à Reveal reste. La synchronisation ne marche que dans le Chrome connecté sur le compte de l'IA : un chatteur qui ouvre Reveal avec son propre compte ne rafraîchit rien.
- À surveiller : si Reveal change la forme de ses requêtes, la synchronisation seule échoue sans bruit. Le bouton et l'alerte d'expiration du CRM restent alors le filet. La relecture Sécurité porte sur les § 1 à 5 ; le code et la route sont relus ensuite par Sécurité et Bilan.

## Alternatives rejetées

- Connexion automatique à Reveal avec les identifiants du compte : il faudrait garder les identifiants, et une connexion faite par un programme met le compte en risque.
- Synchroniser seule un compte jamais branché : l'identité du compte de l'IA serait alors fixée sans que personne ne l'ait choisie.
- Écoute permanente des requêtes de Reveal en tâche de fond : elle lirait l'onglet sans que personne ne l'ait demandé. L'ouverture du popup est un geste du propriétaire.
- Recharger l'onglet en automatique, comme au clic : c'est une action sur Reveal que personne n'a demandée.
- Renouveler le jeton par une route de Reveal : aucune n'est connue, et ce serait un appel de plus vers Reveal.

### Avenant du 27/11/2026 : le rappel quotidien de reconnexion

Décision de Charles du 27/11/2026 (« oki parfait pour le 3 », audit de robustesse R3) : la reconnexion quotidienne qui reste (Conséquences, « Négatives ») est rappelée par Impera, puisqu'aucune route de Reveal ne renouvelle le jeton.

- À l'heure de l'agence réglée dans Réglages › Alertes › Pilotage (« Reconnexion Reveal », 18 h par défaut, jamais éteinte), chaque propriétaire reçoit une notification pour chaque compte dont le jeton ne tiendra pas jusqu'au lendemain : moins de 20 h devant lui, expiré, ou sans échéance lisible.
- Une heure après, si rien n'a bougé, la notification revient une fois.
- 2 h avant la fin d'un jeton, une relance part, seulement si aucun rappel du jour ne l'a signalé : un jeton synchronisé peu avant l'heure, qui meurt avant la suivante. Avec 18 h, elle tombe entre 12 h et 16 h, jamais la nuit. Un jeton qui meurt la nuit a toujours été signalé par le rappel de la veille au soir, puisqu'une relance retenue pendant les heures calmes arriverait trop tard.
- Ces notifications sont des alertes de l'agence (`agency_alert`, ADR 0176 § 3) : hors plafond du jour, retenues pendant les heures calmes. Une session qui expire la nuit ne réveille personne tant que Charles n'a pas tranché ce point.
- Le message dit le geste avec le compte du « bot », jamais le sien (P2-02). Rien ne part sans notifications activées sur au moins un appareil d'un propriétaire.
- La connexion automatique à Reveal par le serveur reste écartée (Alternatives rejetées). Elle se rediscute après une à deux semaines de vrai fonctionnement, sur le mot écrit de Charles.
