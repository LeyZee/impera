# 0065. La créatrice voit qui a écrit chaque message, et des chiffres sur ses fans

Statut : accepted (Charles, 06/11/2026 12h13, « ok 0065 », chat du projet ; signature des messages de l'IA choisie par Charles le 03/11 à 16h20 : « Automatique ») ; § 2, les mots « avec au survol ou au toucher le nombre et la part de chaque case » remplacés par l'ADR 0074 (la part seule), qui précise aussi le § 3 et le § 4
Date : 2026-11-03
Remplace : dans l'ADR 0042 § 2, la phrase « l'auteur d'un message envoyé (chatteur ou agent, ADR 0021). Elle voit le message, jamais qui l'a écrit. » ; dans l'ADR 0063 § 3, les mots « sans jamais voir qui a écrit un message (ADR 0021) ».
Précise : l'ADR 0063 § 2 (les tranches et le seuil des chiffres sur sa base).
Les ADR 0042 et 0063 restent telles quelles pour tout le reste ; l'index des ADR renvoie d'elles à celle-ci.

## Contexte

Le 03/11 à 16h18, Charles : « la modèle, il faut qu'elle voie qui a chatté, qui a écrit les messages, vu qu'elle a déjà les informations pour voir les shifts. Comme transparence. » Il demande aussi les chiffres sur ses fans que l'ADR 0063 a promis : « un petit tableau avec des donuts animés, jolis, avec de beaux hovers, cohérents avec le design system (Liquid Glass) », pour qu'elle sache répondre à « quel genre de fans tu as ? » : la part de ses fans par tranche d'âge, la moyenne d'âge, le panier moyen, etc.

L'ADR 0021 ne change pas : c'est le fan qui ne doit jamais savoir qu'une autre personne ou une IA écrit. La créatrice, elle, sait déjà que l'agence écrit pour elle et voit déjà qui est en poste (CR-02).

## Décision

1. **Qui a écrit.** Dans sa lecture d'une conversation (Ventes), chacun de ses messages envoyés porte qui l'a écrit : le nom affiché du chatteur (celui qu'elle voit déjà dans « Qui répond à tes fans »). Un message écrit par l'IA porte « Automatique » : elle sait quels messages l'IA a écrits (Charles, 03/11, 16h20). Un message envoyé hors d'Impera, sur Reveal directement, porte « Écrit sur Reveal ». Elle ne voit toujours rien d'autre de l'IA ni de l'équipe : ni brouillon, ni qui l'a relu, ni verdict d'une garde, ni appel au modèle ou prompt, ni note de supervision, ni rien d'un chatteur au-delà de son nom affiché (ADR 0042 § 2, le reste inchangé). Le topo de la semaine et les suggestions de son agenda ne disent pas d'où ils viennent (ADR 0042 § 3 et § 5, inchangés).
2. **Où sont ses chiffres.** En tête de Ventes, un panneau « Qui sont tes fans », au-dessus de la liste « Tes fans » : des anneaux animés et des barres, en verre (Liquid Glass), avec au survol ou au toucher le nombre et la part de chaque case.
3. **Ce qu'il montre**, sur ses fans de tous ses comptes :
   - combien de fans, combien de nouveaux sur 30 jours, combien ont écrit sur 7 jours ;
   - l'âge qu'ils ont dit : tranches 18–24, 25–34, 35–44, 45–54, 55 et plus, et la moyenne ;
   - leur métier et leur ville ou région, tels qu'ils les ont dits : les cinq plus cités, le reste dans « Autres » ;
   - leur situation (en couple, célibataire…), telle qu'ils l'ont dite ;
   - la part de fans qui ont déjà débloqué un message, et le panier moyen sur 30 jours (ce qu'un fan payant a débloqué en moyenne, TVA comprise, comme sa liste « Tes fans ») ;
   - la répartition de ce qu'ils ont débloqué : rien, moins de 20 €, 20 à 100 €, 100 à 500 €, plus de 500 € ;
   - quand ils écrivent : jour et heure, dans son fuseau.
4. **Ce qui protège chaque fan.** Âge, métier, lieu et situation ne partent que de ce qu'un fan a dit lui-même (`fan_facts` déclarés, jamais une déduction du modèle ni une note de chatteur, ADR 0063). Un chiffre ne s'affiche que s'il porte sur au moins 10 fans (« Pas encore assez de fans pour le dire » sinon), et une case de moins de 3 fans rejoint « Autres ». Le serveur calcule tout et ne rend que des comptes : aucune liste de fans derrière une case, rien qui se clique vers un fan.
5. **Les méthodes restent à l'agence** : ni score de désir, ni étape du KYC, ni script, ni statistique d'un chatteur.

## Conséquences

Positives :
- Transparence sur son propre compte, cohérente avec « Qui répond à tes fans ».
- Elle sait parler de sa base sans jamais voir la fiche d'un fan.

Négatives, à surveiller :
- Un chatteur nommé sur chaque message peut se sentir jugé : à dire à l'équipe avant la mise en service.
- Elle voit la part de l'IA dans ses conversations : c'est voulu (transparence), mais un message « Automatique » maladroit se remarque ; la supervision (ADR 0052) reste le filet.
- Métiers et villes en texte libre : deux orthographes font deux cases tant qu'on ne les regroupe pas.

## Alternatives rejetées

- Garder l'auteur caché (ADR 0042, 0063) : contraire à la demande de Charles.
- Signer les messages de l'IA « L'agence » (l'IA restait invisible) : proposée, Charles a préféré « Automatique ».
- Un vrai tableau de bord avec filtres : trop pour elle, et un filtre fin finit par isoler un fan.
