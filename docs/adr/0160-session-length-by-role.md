# 0160. Durée des sessions selon le rôle : le propriétaire tient 48 heures sans activité, les autres 12 heures

Statut : proposed
Date : 2026-11-20
Amende : l'ADR 0046 § 6 (« 12 heures sans activité » pour tous). La durée absolue de 7 jours ne change pas.

## Contexte

L'ADR 0046 § 6 ferme toute session après 12 heures sans activité, et dans tous les cas 7 jours après sa création. Le 20/11, Charles a demandé de rester connecté plus longtemps sur son propre poste : il se reconnecte chaque matin au CRM. Il a aussi demandé si les chatteurs pouvaient avoir la même durée.

En codant le changement, on a trouvé un défaut : le cookie de session n'était jamais renouvelé. Chacun était donc déconnecté 12 heures après sa connexion, même en plein travail, et pas 12 heures après sa dernière action comme le dit l'ADR 0046.

Avis de Sécurité (20/11) :
- 7 jours pour le propriétaire, à deux conditions : une fin après 48 heures sans activité, et des gestes sensibles qui redemandent toujours mot de passe et code ;
- 12 heures pour les managers et les chatteurs, à ne pas monter. Ils lisent les conversations des fans, parfois sur un appareil partagé, et se reconnectent de toute façon à chaque prise de poste.

## Décision

1. **Le propriétaire** : sa session se ferme après **48 heures sans activité**, et dans tous les cas **7 jours** après sa création.
2. **Tous les autres rôles** (manager, chatteur, créatrice, et tout rôle illisible) : **12 heures sans activité**, avec la même limite de 7 jours. La créatrice peut passer à la durée longue sur décision de Charles. Le code garde la liste des rôles à durée longue en un seul endroit (`apps/api/src/session-lifetime.ts`).
3. **« Sans activité » veut dire sans activité réelle.** Le cookie est renouvelé à l'usage, et la limite est tenue par le serveur à chaque lecture de session. Ça vaut aussi sur les routes de Better Auth qu'aucun de nos contrôles ne garde. Une session échue est supprimée en base, pas seulement refusée.
4. **Inchangé** :
   - les gestes sensibles demandent un mot de passe et un code donnés depuis moins de 10 minutes (ADR 0046 § 3) ; une session longue ne compte jamais comme une connexion récente ;
   - un changement de mot de passe ou de second facteur, et le départ d'un membre, ferment toutes ses sessions ;
   - l'alerte de connexion depuis un nouvel appareil.

## Conséquences

- Charles se reconnecte au plus une fois par semaine sur son poste, et au plus tard après deux jours sans y toucher.
- Au pire, une session de propriétaire volée donne deux jours de lecture sur un appareil abandonné, et aucun geste sensible.
- Managers, chatteurs et créatrices gagnent un vrai « 12 heures sans activité » : ils ne sont plus coupés en plein shift 12 heures après leur connexion.
- Écarté : 7 jours pour les chatteurs (voir l'avis de Sécurité) ; une durée longue réservée aux appareils reconnus (un chantier à part, possible plus tard).
