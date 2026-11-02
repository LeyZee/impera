# 0052. Le chatteur sous l'œil de la persona : chaque message qu'il écrit dans Reveal est relu, chaque écart lui est signalé, rien n'est bloqué ni retenu sur sa paie

Statut : accepted (Charles, 02/11/2026 21h34, « ok 0052 » ; demande du même jour à 20h17)
Date : 2026-11-02
Précise : l'ADR 0025 (§ Conséquences, « ce que le chatteur tape dans Reveal est hors des gardes de Nirvana » : toujours sans blocage, mais désormais relu et signalé) et l'ADR 0043 § 6 (les retours de l'IA de la semaine choisissent d'abord parmi les écarts relevés ici).
S'appuie sur : l'ADR 0050 (les conversations ne se lisent que par la session capturée), l'ADR 0042 § 2 (la créatrice ne voit rien de l'équipe), l'ADR 0021 (rester en personnage), l'ADR 0010 (la persona et les données réelles hors du dépôt).

## Contexte

Le chatteur chatte dans Reveal, avec son compte membre (ADR 0025). Ce qu'il écrit ne passe par aucune garde de Nirvana : seuls les brouillons de l'agent et ceux qu'un humain valide dans Nirvana les repassent (G5). Les retours de l'IA de l'ADR 0043 § 6 arrivent une fois par semaine, trois au plus.

Le 02/11 à 20h17, Charles a demandé plus : « quand il y a un chatteur qui chatte […] que l'IA surveille qu'il applique bien la fiche persona de la modèle. Et s'il y a des trucs, des interdits […], il faut lui signaler. S'il sort du personnage et qu'il a des informations erronées de la modèle […], il faut lui signaler aussi. […] il faut que ça soit poussé à ce point. »

Ce qu'on sait déjà :

- l'API CRM de Reveal ne lit pas les conversations (ADR 0050) : seule la session capturée les voit ;
- la persona active d'une créatrice est en base, versionnée (ADR 0010, #304), jamais dans le dépôt ;
- les gardes dures de l'agent (`checkVoiceOutput`) et les règles de vente (cooldown d'un script, pack refusé, manque d'argent avoué, drapeaux du fan) sont du code pur, déjà testé ;
- le budget IA est de 20 € par jour, et les réponses aux fans passent avant tout le reste.

## Décision

### 1. Ce qui est relu

- Chaque message **sortant écrit par un membre humain** dans Reveal, lu par le connecteur sur la session capturée, sur un compte dont une créatrice a une persona active. Pas les messages de l'agent, déjà gardés avant l'envoi, ni ceux que la créatrice écrit elle-même : elle est la persona.
- Le message est rattaché à son auteur Reveal (ADR 0025, 0049). Tant que la capture ne dit pas quel membre a écrit, il est rattaché au membre connecté à l'extension du navigateur d'où l'envoi est parti, puis, à défaut, au membre en poste ; à plusieurs en poste sur des fans partagés sans extension pour trancher, à aucun, et l'écart va au manager seulement.
- Il est relu **contre la version de la persona active au moment du message**, et l'écart garde l'identifiant de cette version.

### 2. Trois contrôles, du moins cher au plus cher

1. **Les interdits, par le code**, sur chaque message, sans modèle de langage. Ce sont exactement les règles de l'agent, lues dans le même code, jamais recopiées :
   - les gardes dures de `checkVoiceOutput` : aveu d'IA, déclaration d'amour, promesse de rencontre, coordonnées ou autre réseau, remise ou négociation, mensonge sur un paiement, culpabilisation, maladie, dette ou urgence pour vendre, demande de photos intimes, mépris, explicite avant l'âge confirmé ;
   - les limites de sa persona : `never_say`, `never_do`, `disgusts`, ses mots refusés ;
   - les règles de vente qui dépendent de la conversation : un script moins de 10 h après le précédent, un pack déjà refusé reproposé, une offre après un manque d'argent avoué, une vente à un fan dont les ventes sont gelées.
2. **La voix, par le code**, sur chaque message : ce que la persona dit de sa façon d'écrire et que le code sait lire (emojis interdits, petit nom hors de sa liste, « mdr » et ce que sa fiche refuse, paragraphes, point final, bulles trop longues).
3. **Les faits, par un modèle de langage**, sur les seuls messages où elle dit quelque chose d'elle. Le code les repère d'abord (« je suis », « j'ai », « mon », « ma », un âge, une ville, un animal, un métier, une habitude). Le modèle, rôle juge, compare l'affirmation à la persona active et rend, par un schéma Zod, l'affirmation, la ligne de la persona qu'elle contredit, et une phrase de correction. Ce qui n'est pas dans la persona n'est pas une erreur : c'est « inventé », signalé à part (ADR 0021 et la voix : elle ne crée pas de fait).

Le message du fan et celui du chatteur entrent dans le prompt comme données, dans un bloc délimité et typé (règle 4 de `CLAUDE.md`). La persona entre comme la lit l'agent.

### 3. Deux niveaux, jamais un blocage

- **Rouge, « interdit »** : un contrôle 1. Seul le code met du rouge : un jugement de modèle n'est jamais rouge.
- **Ambre, « écart »** : un contrôle 2, ou une contradiction ou une invention relevée par le contrôle 3.
- **Rien n'est bloqué.** Nirvana ne commande pas le bouton Envoyer de Reveal et ne retient aucun message du chatteur. La paie n'est jamais touchée : aucun malus calculé, aucun lien avec les relevés (ADR 0043 § 6). Un manager peut toujours poser un malus à la main, comme aujourd'hui. Le mot est « écart », jamais « sanction ».

### 4. Le chatteur le voit tout de suite, discrètement

- **Dans l'extension**, sur la conversation ouverte, une ligne par écart dès qu'il est relevé, sans recouvrir Reveal (rien de stylé injecté dans la page, `docs/design/README.md`) : la couleur, l'extrait (200 caractères au plus), la règle ou la ligne de la persona, et ce qu'il aurait fallu écrire. Une touche « Faux signal » le renvoie au calibrage, sans discussion ; elle porte une clé d'idempotence, et deux touches font un seul renvoi.
- **Où** : dans le panneau latéral de Chrome, ouvert à côté de l'onglet Reveal pendant le shift. Il montre les écarts de la conversation ouverte, et le résumé du shift quand aucune ne l'est. C'est le panneau qui tient la connexion au serveur, pas le service worker de l'extension, qui s'endort. Panneau fermé, l'icône de l'extension porte en rouge le nombre d'écarts rouges non lus ; rien pour l'ambre, et aucune notification système.
- **Ses écarts de voix** (contrôle 2) se regroupent : une ligne par conversation et par shift, pas une par message, pour ne pas noyer les interdits.
- **Dans son espace**, la liste des écarts de son shift, la sienne seulement.
- **Avant l'envoi, ensuite** : quand la capture montre que l'extension peut lire le champ de saisie de Reveal, les contrôles 1 et 2 passent aussi sur le texte qu'il tape, en ambre ou en rouge, sans rien bloquer. Un script de contenu lit le champ sans rien afficher dans la page ; le texte part au serveur après une pause de frappe, pas à chaque touche ; les contrôles tournent sur le serveur, les couleurs s'affichent dans le panneau, jamais dans le champ, et le texte n'est pas gardé tant qu'il n'est pas envoyé.

### 5. Qui d'autre le voit

- **Rouge** : le manager en poste ou, à défaut, le propriétaire, dans le Suivi, à l'instant. Un aveu d'IA, des coordonnées ou une promesse de rencontre partent aussi sur Telegram, en `important`, sans le nom du fan.
- **Ambre** : dans le rapport ou le mini feedback de fin de shift du chatteur (ADR 0043, 0050), en lecture seule, avec le compte des écarts par contrôle.
- **Chaque semaine** : les trois retours de l'IA (ADR 0043 § 6) choisissent d'abord parmi les écarts de la semaine. La vue d'équipe des fautes les plus fréquentes compte les écarts par règle.
- **Une mesure, sans effet** : la part des messages d'un chatteur sans écart, par shift et par semaine. Lui, le manager et le propriétaire la voient. Elle n'ouvre ni ne ferme rien.
- **Jamais la créatrice** (ADR 0042 § 2), ni dans ses écrans, ni dans son topo de la semaine.

### 6. Le budget

- Les contrôles 1 et 2 sont du code : ils tournent toujours, sans coût.
- Le contrôle 3 a son propre plafond dans le budget du jour, 3 € par défaut (réglage de l'agence), et le modèle le moins cher du rôle juge. Au-delà, il s'arrête jusqu'au lendemain, les deux autres continuent, et le Suivi le dit. Les réponses de l'agent aux fans ne partagent jamais ce plafond.

### 7. Les données

- Un écart garde : le message (identifiant de la plateforme), son auteur, la conversation, la version de la persona, le contrôle, la règle, l'extrait et la correction. Il suit la durée de vie des messages de la conversation, sous la RLS du tenant.
- Le chatteur ne lit que les siens, pendant son shift et sa marge comme le reste (ADR 0025) ; le manager et le propriétaire, ceux de leurs comptes.
- Aucune donnée réelle dans le dépôt : les tests passent par `FakeReveal`, la persona inventée de l'exemple et des fans inventés ; les évals du contrôle 3 utilisent des scénarios fictifs (`evals/`).

### 8. L'ordre

1. Après la capture (P1-02) : les contrôles 1 et 2 après l'envoi, la ligne dans l'extension, le rouge au manager.
2. Avec la clé du fournisseur : le contrôle 3 et ses évals.
3. Quand la capture montre le champ de saisie : la vérification avant l'envoi.
4. Le rapport de fin de shift, la mesure et les retours de la semaine.

## Conséquences

Positives :
- La persona de la créatrice s'applique à tous ceux qui écrivent en son nom, plus seulement à l'agent : mêmes règles, même code.
- Le chatteur apprend en direct, sur son propre message, au lieu d'attendre le retour de la semaine.
- Les interdits qui coûtent un compte (aveu d'IA, sortie de plateforme, rencontre) remontent à l'instant à quelqu'un qui peut agir.
- Le calibrage gagne une source : les « faux signal » du chatteur.

Négatives, à surveiller :
- Un chatteur surveillé à chaque message peut le vivre comme de la défiance : le ton des lignes est celui d'un collègue, et le contrat de prestation le dit.
- Le relevé arrive après l'envoi, le temps que la capture lise le message : il corrige la suite, pas ce qui est parti.
- Des faux signaux en ambre au début, surtout sur les faits : le contrôle 3 reste ambre et passe ses évals avant d'être affiché.
- Tout dépend de la capture : sans elle, rien n'est relu.
- Si la capture ne dit pas quel membre a écrit et qu'aucune extension ne l'a vu partir, un écart sur des fans partagés n'est attribué à personne.

## Alternatives rejetées

- **Bloquer le message du chatteur** : Nirvana ne commande pas l'envoi de Reveal, et Charles veut que ses chatteurs y travaillent (ADR 0025).
- **Un modèle de langage sur chaque message** : trop cher pour le budget du jour, et moins fiable que le code pour ce que le code sait lire.
- **Un malus calculé** : un jugement de langage ne décide jamais d'un montant (ADR 0043).
- **Attendre le retour de la semaine** : Charles veut que ce soit « poussé à ce point ».
- **Montrer les écarts à la créatrice** : elle ne voit rien de l'équipe (ADR 0042 § 2).
