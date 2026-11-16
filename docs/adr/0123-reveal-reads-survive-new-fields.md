# 0123. Une nouveauté de Reveal n'arrête plus tout le relevé : clés sans danger écartées, élément illisible mis de côté et relu

Statut : proposed (numéro attribué par le coordinateur le 16/11/2026 ; demande de la coordination après les pannes du 15 et du 16/11 ; relecture Sécurité)
Date : 2026-11-16
Précise : la spécification du connecteur Reveal (§ erreurs : « réponse qui ne passe pas son schéma → `fatal` shape_changed ») et `docs/reference/fake-reveal.md` (`shape_changed`). Ne remplace aucune ADR.

## Contexte

Le connecteur lit chaque réponse de Reveal avec un schéma strict : une clé inconnue fait échouer la lecture (`shape_changed`), et une lecture qui échoue fait échouer tout le relevé du compte, puis ouvre le coupe-circuit. C'est voulu : on ne lit pas en silence une donnée qu'on ne comprend pas.

Reveal ajoute des champs sans prévenir. Le 15/11 (`gif`, `refundAskedTotal`, la remise d'une étape…), puis le 16/11 (`deletedAt` sur un message, la remise d'un média payant), chaque fois pour une poignée d'éléments : une seule conversation qui en contenait a suffi à arrêter le copilote pour toutes les autres, jusqu'au correctif suivant. Charles ne veut pas que le CRM dépende d'un correctif à chaque nouveauté.

Deux choses distinctes cassent : une clé nouvelle sur un objet sans enjeu, et un élément vraiment illisible dans une liste. Elles demandent deux réponses.

## Décision

1. **Deux sortes d'objets, une liste fermée dans le code.**
   - **Stricts, comme aujourd'hui** : tout ce qui touche à l'argent ou à l'identité. Prix, remise, montant, transaction, statut payé, identifiants, auteur et sens d'un message, réponse d'un envoi (`messages.send`, ce que relit `verifySent`). Une clé inconnue y reste une erreur.
   - **Tolérants** : le reste (enveloppe d'une conversation, membre, résumé du modèle, média, compteurs d'affichage). Une clé inconnue y est **retirée** avant la lecture, jamais lue ni gardée, et **signalée** : nom de la route, chemin, nom de la clé, jamais sa valeur.
   - Un champ attendu qui manque ou change de type reste une erreur partout.
   - La liste des objets tolérants est écrite dans l'adaptateur ; un objet n'y entre que par une PR relue par Sécurité.

2. **Un élément illisible est mis de côté, le reste passe.** Quand un élément d'une liste ne se lit pas (une conversation, ses messages, un script, un média du coffre), il est écarté et noté dans une table à lui (compte, sorte, référence de la plateforme, route, chemin, première et dernière erreur, nombre d'essais ; jamais le corps). Le relevé continue avec les autres et avance son horodatage. Chaque relevé suivant **relit d'abord les éléments écartés**, depuis leur première erreur : rien n'est perdu quand le correctif arrive.

3. **Un élément écarté ne sert à rien d'autre.** Une conversation écartée n'est pas répondue par l'agent ; le copilote l'affiche comme non lue. Un script ou une étape écartés ne sont pas proposables, et l'envoi d'une étape non lue reste fermé. Un média écarté n'est pas décrit.

4. **Alertes à la mesure.** Ambre dès une clé nouvelle signalée ou un élément écarté, avec le nombre et la route, une fois par jour et par clé. Rouge si plus d'un élément sur cinq est écarté, ou si un élément l'est depuis plus de 24 h. Le coupe-circuit ne s'ouvre plus que si la liste elle-même ne se lit pas, ou si aucun élément ne passe.

5. **FakeReveal** sait ajouter une clé à un objet tolérant ou strict et rendre un élément illisible, pour tester chaque cas.

## Conséquences

Positives :
- Une nouveauté de Reveal sans enjeu ne coupe plus le copilote ; une nouveauté sur l'argent l'arrête toujours, mais pour les seuls éléments concernés.
- Rien n'est perdu : un élément écarté est relu dès que le correctif est en place.
- L'alerte dit quoi corriger (route, chemin, clé) sans montrer aucune donnée.

Négatives :
- Une clé nouvelle sur un objet tolérant est ignorée jusqu'à ce qu'on la lise exprès : on peut passer à côté d'une information utile quelques jours.
- Une table et un chemin de relecture de plus à tester.

À surveiller :
- Le nombre d'éléments écartés par jour ; une clé signalée tous les jours sans correctif.

## Alternatives rejetées

- **Tout tolérer (`passthrough` ou `strip` partout)** : une nouveauté sur un prix ou une transaction passerait en silence.
- **Garder tout strict et corriger vite** : deux pannes en deux jours, chacune pendant que Charles dort.
- **Sauter l'élément illisible sans le noter** : ses messages seraient perdus dès que le relevé avance.
