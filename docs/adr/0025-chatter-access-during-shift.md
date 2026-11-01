# 0025. Le chatteur chatte dans Reveal ; dans Nirvana, il traite sa créatrice pendant son shift, et rien hors shift

Statut : accepted (Charles, 27/10/2026 : carte de 15h28, « Toute la créatrice, en shift » ; message de 15h30, « le chatteur, lui, il chatte via Reveal »)
Date : 2026-10-27
Remplace : dans l'ADR 0024, le point qui réduit le Suivi du chatteur aux passations `sale` qui lui sont routées ; dans l'ADR 0023 (§ Mode hybride), le point « Gardes sur les messages du chatteur » qui faisait vendre le chatteur depuis Suivi

## Contexte

L'ADR 0024 donne au chatteur, dans Suivi, « la file des passations `sale` qui lui sont routées (EQ-08), jamais toutes les conversations de ses créatrices ». Le filtre du serveur prévu en prérequis d'EQ-08 et d'EQ-10 l'applique : pour un membre au scope `self`, `currentUser()` vide `creatorIds`, ce qui ferme le Dashboard, les fans, la persona et les conversations, et le chatteur ne lit que les conversations routées vers lui (`conversations.routed_to_user_id`). L'ADR 0023 faisait vendre le chatteur depuis Suivi, ses messages repassant les gardes dures.

Le 27/10, Charles a fixé trois choses :

- le trou 6 de l'analyse d'Imperium (15h11) : « un chatteur ne devrait voir les conversations de ses créatrices que pendant son shift, plus une marge », parce qu'un chatteur qui s'en va avec la liste des gros fans est le risque numéro un d'une agence ;
- l'hybride au lancement (15h11) : « les deux peuvent vendre, mais au début, ça va être les chatteurs seulement, le temps qu'on entraîne l'IA ». L'agent écrit en copilote (ADR 0019) et chaque brouillon attend un humain ;
- le lieu du chat (15h30) : « le chatteur, lui, il chatte via Reveal […] Reveal a les outils de chatting intégrés ». Nirvana ne remplace pas la boîte de Reveal.

## Décision

**Où l'on chatte.** Le chatteur chatte et vend dans Reveal, avec son propre compte membre et les outils de Reveal (scripts, coffre, notes). Nirvana n'a pas de champ pour écrire librement à un fan à sa place. L'agent n'écrit que par le membre « bot » (ADR 0018).

**Ce que Nirvana lui donne, pendant un shift et une marge avant et après réglée par le propriétaire**, pour les créatrices que ce shift couvre :

- la file À traiter : il valide, retouche ou refuse un brouillon de l'agent ; le message part par le membre « bot » et repasse les gardes dures (G5) ;
- ses passations, routées en tête de sa file (un `sale` part d'abord au membre en poste, EQ-08), chacune avec son brief (où en est le fan, KYC, notes, drapeaux, packs refusés, scripts déjà joués) et un lien direct vers la conversation dans Reveal ; il vend dans Reveal, puis « Rend la main » avec son issue ;
- pour ces conversations, la fiche du fan et sa mémoire.

Il ne change jamais le mode de l'agent et n'ouvre ni la persona, ni Entraîner, ni les Réglages (ADR 0024).

**Hors de cette fenêtre**, Nirvana ne lui montre rien des conversations ni des fans. Seule exception : la passation qu'il a prise reste lisible jusqu'à « Rendre la main ».

**Une garde du serveur**, calculée à chaque requête comme `creatorIds`, ouvre ces créatrices au chatteur pendant la fenêtre, par une liste à part, `shiftCreatorIds`, lue seulement par les routes des conversations et des fiches de fans de ces conversations ; jamais en les remettant dans `creatorIds`, qui ouvre aussi le mode de l'agent, le Dashboard, la persona, la liste des fans et l'écriture des drapeaux, fermés au chatteur (seul le drapeau « ventes gelées » d'une passation lui est permis, EQ-08). Ce n'est pas une politique RLS de plus. Un shift retiré ou raccourci ferme l'accès à la requête suivante. C'est le seul endroit qui ouvre une créatrice à un membre au scope `self`.

**Aucun export** de liste de fans pour un chatteur. Chaque fiche de fan qu'il ouvre dans Nirvana entre au journal d'audit, sans son contenu.

**Un humain qui écrit dans Reveal.** Un message sortant que l'agent n'a pas envoyé, lu par le connecteur, met la conversation en main humaine : l'agent se tait sur ce fan jusqu'à « Rendre la main » ou un délai réglé par le propriétaire. Une vente détectée revient au membre qui tenait la conversation à cet instant : celui qui a pris la passation, ou, quand la main humaine vient d'un message écrit dans Reveal, le membre en poste sur ce compte (l'auteur Reveal si la capture montre quel membre a écrit). Une vente sur une conversation que l'agent tenait revient à l'agent, sans commission.

Le propriétaire et un manager actif ne sont pas bornés. Un manager qui n'est pas actif est traité comme un chatteur, comme le veut son scope.

## Ce que Nirvana ne peut pas faire côté Reveal

La borne du shift porte sur ce que Nirvana montre : le lecteur, les fiches et la mémoire des fans, le brief. Nirvana ne ferme pas la session Reveal d'un chatteur, et Reveal lui montre ce que son compte membre permet. Ce qui est réaliste :

- un compte membre Reveal par chatteur, jamais un identifiant partagé, pour savoir qui a écrit et pouvoir le retirer ;
- au départ, Charles retire lui-même le membre dans Reveal ; le parcours de départ (EQ-14) le lui rappelle et attend sa coche ;
- à vérifier dans la capture Reveal (P1-02) : si Reveal peut limiter un membre (horaires, créatrices, export) et s'il dit quel membre a écrit un message.

## Conséquences

- Le copilote tourne dès le lancement avec les chatteurs en poste, et « Qui vend » passe à `both` créatrice par créatrice quand l'agent est prêt.
- Ce que le chatteur tape dans Reveal est hors des gardes de Nirvana : c'est sa façon normale de vendre, pas un contournement. Le risque est écrit dans `docs/conventions/security.md` (EQ-08) ; la formation (S'entraîner, EQ-16) et le contrat de prestation le couvrent.
- La mémoire du fan, le KYC et le brief, que Reveal n'a pas, ne sont visibles que pendant le shift, sans export, et chaque fiche ouverte est tracée.
- Le filtre du serveur (fermé par défaut) reste la base ; EQ-13 écrit la garde qui ouvre pendant le shift.
- À surveiller : la marge (trop large, elle refait l'accès permanent) ; le coût d'`onShift` à chaque requête, à tenir par un index sur les shifts du membre ; le délai de silence de l'agent après un message humain.
- L'ADR 0024 passe en « accepted (§ Suivi du chatteur remplacé par 0025) » et l'ADR 0023 note que son point « Gardes sur les messages du chatteur » est remplacé.

## Alternatives rejetées

- **Garder l'ADR 0024 telle quelle** (passations seules, même en shift) : le propriétaire et les managers valideraient seuls chaque brouillon de l'agent, pendant que les chatteurs en poste attendent.
- **Accès permanent à toute la créatrice dans Nirvana**, comme dans Imperium : c'est précisément le risque que Charles veut fermer.
- **Faire chatter le chatteur dans Nirvana**, ses messages envoyés par le membre « bot » : possible techniquement, mais Reveal a déjà les outils de vente (scripts, coffre), et Charles veut que ses chatteurs y travaillent.
- **Une politique RLS par shift** : `onShift` en SQL dans chaque politique `tenantPolicy`, plus lourd et sans gain sur une garde calculée à chaque requête.
