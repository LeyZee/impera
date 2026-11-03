# 0063. La créatrice ne lit aucune note de ses fans, seulement des chiffres sur l'ensemble de sa base

Statut : proposed (décision de Charles, 03/11/2026 11h40 et 11h50 ; phrases soumises mot pour mot)
Date : 2026-11-03
Remplace : dans l'ADR 0042 § 2, la phrase « **Elle voit tout son compte**, en lecture : ses ventes avec le fan qui a acheté, ses fans (pseudo, dépenses, notes), les conversations de ses comptes, ses médias et leurs descriptions, les publications prévues et passées, qui est en poste sur elle (nom affiché et créneau). »
L'ADR 0042 reste telle quelle, sauf la mention de son statut ; l'index des ADR renvoie d'elle à celle-ci.

## Contexte

L'ADR 0042 § 2 donne à la créatrice ses fans avec leurs notes. CR-02 (lot b1, #464) a ouvert ses lectures. À la relecture, Bilan a demandé de ne rendre que ce que le fan a dit lui-même : ni la note d'un chatteur, qui trahirait qu'on écrit à sa place, ni une déduction du modèle, ni son profil d'achat.

Charles a tranché plus loin, le 03/11 : « Je veux que des petits insights comme ça, mais sans aller dans les détails, parce que en vrai, c'est des secrets d'agence, c'est les méthodes des agences, donc il n'y a pas besoin que les modèles voient ça. » Il veut aussi des chiffres sur sa base, « entre copines » : la part de ses fans par tranche d'âge, par métier.

## Décision

1. **La phrase qui remplace celle de l'ADR 0042 § 2** : « **Elle voit tout son compte**, en lecture : ses ventes avec le fan qui a acheté, ses fans (pseudo, dépenses), les conversations de ses comptes, ses médias et leurs descriptions, les publications prévues et passées, qui est en poste sur elle (nom affiché et créneau). Elle ne lit aucune note d'un fan : ce que l'agence sait d'un fan, dit par lui, déduit par le modèle ou noté par un chatteur, reste à l'agence. »
2. **Ce qu'elle aura à la place** : « Elle lira des chiffres sur l'ensemble de ses fans (par exemple la part de ses fans par tranche d'âge ou par métier), jamais sur un seul. Ces chiffres ne partent que de ce que les fans ont dit eux-mêmes, et une case ne s'affiche qu'au-delà d'un nombre minimal de fans, pour qu'aucun fan ne se reconnaisse. Les tranches et ce seuil seront fixés par une ADR courte, avant le code. »
3. **Ce qui ne change pas** : « Elle lit toujours les conversations de ses comptes en lecture seule, sans jamais voir qui a écrit un message (ADR 0021). La base dit la même chose que l'écran : sa réponse ne porte aucun champ de note, et un champ ajouté par erreur fait échouer le contrat. »

## Conséquences

Positives :
- Les méthodes de l'agence (ce qu'elle apprend des fans, comment elle les note) restent à l'agence.
- Le contrat de sa conversation (`CreatorConversationSchema`, `strict`) n'a pas de champ de note : une fuite ferait échouer la réponse au lieu d'arriver à l'écran.

Négatives, à surveiller :
- Elle ne peut pas préparer une rencontre de contenu avec un fan précis à partir de ses notes ; si elle en a besoin, elle le demande à l'agence.
- Les chiffres agrégés demandent un seuil bien choisi : trop bas, un fan se reconnaît ; trop haut, une petite base ne montre rien.

## Alternatives rejetées

- **Les notes déclarées seulement** (proposition de Bilan) : moins exposant, mais elles restent le travail de l'agence ; Charles a choisi de n'en montrer aucune.
- **Des chiffres calculés aussi sur les déductions du modèle** : elle ne voit pas l'IA (ADR 0042 § 2), et une déduction n'est pas un fait.
