# 0164. « À décider » : une question à la fois posée à la créatrice, deux ou trois réponses, le propriétaire en secours

Statut : accepted (décisions de Charles du 21/11/2026 : la créatrice valide d'un geste, lui en secours ; feu vert pour les cartes de décision dans son espace ; captures « cartes-de-decision-2 » validées le même jour)
Date : 2026-11-21

## Contexte

Plusieurs chantiers ont besoin que la créatrice tranche quelque chose sur un de ses contenus : choisir une légende parmi celles que le code propose, confirmer une heure de publication, dire si une publication d'essai passe chez ses abonnés. Jusqu'ici, « Aujourd'hui » ne portait qu'une carte « À décider » qui renvoie vers les propositions de son agenda.

Charles veut que ces questions lui fassent gagner du temps : une question, deux ou trois boutons, sur son téléphone, sans écran de plus. Il veut pouvoir répondre à sa place quand elle ne répond pas.

## Décision

1. **Une décision** est une question posée à une créatrice sur un de ses contenus : un genre (liste fermée), le type du contenu (sa couleur, celle de son agenda), une question, une ligne de contexte, **deux ou trois réponses**. Deux formes : des boutons courts, ou des rangées dont le texte se lit en entier (des légendes).
2. **Le code qui demande** écrit la décision et lit la réponse ; c'est lui qui sait ce qu'une réponse déclenche. Le module `creator-decisions` ne connaît aucun genre : il pose, garde la réponse et la rend. Une règle de métier ne vit jamais dans le texte d'une question.
3. **Une fois par sujet.** Qui demande nomme le sujet (un contenu) : la même question redemandée n'écrit rien.
4. **Une réponse est donnée une fois.** La même réponse renvoyée ne change rien ; une autre est refusée. La base le tient : une ligne qui n'est plus ouverte ne correspond à aucune politique d'écriture.
5. **Qui répond.** La créatrice, sur son propre compte. Le propriétaire, à sa place, pour la créatrice nommée, avec une ligne au journal d'audit (jamais la réponse elle-même). Un manager et un chatteur ne lisent ni ne répondent. La base tient aussi qu'un compte ne signe une réponse que de son propre nom et ne retire jamais une décision : seul le code qui a demandé la retire.
6. **« Plus tard »** est toujours proposé : la question se met de côté deux heures, jamais au-delà de sa fin. Le propriétaire voit aussi ce qu'elle a mis de côté.
7. **Une fin.** Chaque décision porte l'instant après lequel elle n'a plus de sens : passé cet instant, personne ne la lit ni n'y répond, et qui a demandé la lit « finie ». Qui a demandé peut aussi la retirer tant qu'elle est ouverte.
8. **À l'écran** : une seule question visible, tout en haut d'« Aujourd'hui », avec un compteur discret quand plusieurs attendent ; la suivante entre après la réponse ; rien quand rien n'attend. Après sa réponse, la carte se replie en une ligne qui dit ce qui est noté. Aucune réponse n'est mise en avant.
9. **« D'autres idées »** : sur une décision à rangées, elle peut redemander trois propositions, en touchant des indications ou en les écrivant, **trois fois au plus** par décision. Le compteur vaut zéro tant que rien ne propose. Son droit est relu dans son compte ; le code qui propose pour ce genre de décision écrit les nouvelles réponses (ses indications et ses mots lui arrivent comme des données) ; la porte du code qui demande les garde. Sa demande est comptée **avant** tout appel payant, une à la fois : deux gestes rapprochés ne paient qu'une fois, le second apprend que d'autres idées arrivent. Quand rien ne peut être proposé (budget du jour, modèles en échec, moins de deux réponses), rien n'est gardé et sa demande lui est rendue. En base, un déclencheur réserve les réponses, le compteur et la marque d'une demande en cours à cette porte, sur une question ouverte, par trois pas seulement (comptée, remplie, rendue) : ni son compte ni celui du propriétaire ne réécrit ce qui lui est proposé, et aucune réponse ne change sans demande comptée.
9 bis. **Elle est prévenue.** Une question nouvelle sonne sur chacun de ses comptes, une fois, avec la question elle-même et rien d'autre, sous ses heures calmes et son plafond quotidien ; elle ouvre « Aujourd'hui ».
10. **Écritures.** La table n'accorde au rôle applicatif que l'ajout et les colonnes d'une réponse. Le code qui demande écrit sous son propre nom de tâche (`withTenantJob`, `creator_decisions`), une créatrice à la fois ; le rôle de service ne fait que lire.

## Conséquences

- Positives : un seul mécanisme pour toutes les questions à venir (publication Instagram d'abord), sans nouvel écran ; la créatrice répond en un geste ; rien ne s'affiche tant qu'aucun code ne demande, donc aucun changement visible à la fusion de ce lot.
- Négatives : un genre nouveau demande une migration du contrôle de la colonne `kind` ; le code qui demande doit venir relire la réponse (pas d'événement dans ce lot).
- À surveiller : le nombre de questions par jour. Au-delà de quelques-unes, la carte devient une corvée : chaque code qui demande doit borner ce qu'il pose. La notification d'une question nouvelle vient au lot suivant, sous les plafonds du module `notifications`.

## Alternatives rejetées

- **Réutiliser les propositions de son agenda** (`creator_suggestions`) : elles s'acceptent ou se refusent et deviennent des tâches ; une décision a deux ou trois réponses libres et ne devient pas une tâche.
- **Une messagerie avec la créatrice** : plus longue à lire et à tenir qu'une question et trois boutons ; rien n'empêche d'en ajouter une plus tard.
- **Écrire la réponse par le rôle de service** : la réponse est celle d'une personne, elle passe par sa propre porte et ses politiques.
- **Mettre en avant une réponse recommandée** : écarté avec Design, pour ne pas la pousser.
