# 0111. Le jeu des cœurs : le code juge la réponse, l'agent joue, la récompense part une fois

Statut : accepted (« ok 0111 » de Charles le 14/11/2026, 13 h 17, après ses précisions du même jour : tous les emplacements exacts, 3 essais, pendant la fenêtre d'arrivée du fan seulement, et test au playground)
Date : 2026-11-14
Précise : ADR 0021 (jamais d'aveu d'IA), ADR 0030 et 0099 (le coffre fait foi), ADR 0090 § 8 (jamais deux fois la même chose au même fan), ADR 0098 et 0103 (porte de vente), ADR 0110 (automatisations Reveal), décision du 17/10 (le bot n'envoie de média que dans un script). Ne remplace rien.

> Cette ADR ne contient aucune donnée réelle : ni emplacement, ni nom de dossier, ni média. Tout cela se saisit dans le CRM.

## Contexte

Le 14/11/2026, Charles demande un jeu de repérage configurable par créatrice : quelques marques (appelées « cœurs ») visibles dans son feed ; le fan qui trouve leurs emplacements exacts gagne une vidéo du coffre. Le nombre de marques, leurs emplacements et la récompense se règlent dans le CRM. Le jeu donne aux fans timides une raison simple d'écrire ; le risque est qu'un fan vienne pour le cadeau puis ne revienne plus, d'où la mesure de la règle 15. Où l'annoncer est hors de cette ADR. Elle dit seulement comment l'agent joue, si le jeu est allumé.

Ce qui existe dans le dépôt au 14/11 : l'envoi d'une étape de script (`sendScriptStep`, prix lu chez Reveal) et l'anti-doublon `media_sends` (un média n'est jamais envoyé deux fois au même fan). Ce qui manque : la synchronisation du coffre (ADR 0099, acceptée, pas codée) ; sans elle, le CRM ne sait pas désigner la vidéo du dossier.

## Décision

### Le réglage (CRM, jamais le dépôt)

1. **Un jeu par créatrice, réglé dans le CRM par le propriétaire.** Il contient : un interrupteur (éteint par défaut), la liste des emplacements (de 1 à 8), la récompense, le nombre d'essais (3) et la fin de la fenêtre d'arrivée (règle 9). Les emplacements sont saisis par le propriétaire dans le CRM, dans une **liste fermée de zones** assez fine pour « l'endroit exact » (zone, côté, position) ; une zone a une note libre facultative pour préciser, lue par les humains seulement.
2. **Les emplacements sont secrets, même pour l'IA qui écrit.** Ils ne vont jamais dans un prompt. Le cerveau lit le message du fan et en sort la ou les zones qu'il propose (liste fermée, schéma Zod) **sans connaître les bonnes réponses** ; c'est le code qui compare. Ainsi aucune fuite possible par la voix, aucun « tu chauffes » inventé, et un fan ne peut pas faire avouer la réponse à l'IA.
3. **La récompense est un script d'une étape offerte, toujours gratuite**, choisi dans le CRM parmi les scripts synchronisés, et donc fait de médias du coffre. On garde la décision du 17/10 : le bot n'envoie de média que dans un script. Le CRM refuse comme récompense un script qui a une étape payante, et un prix changé chez Reveal (étape devenue payante) empêche l'envoi et lève une alerte (règle existante) : la récompense n'ouvre donc jamais de vente, et la porte de l'ADR 0103 n'a pas à s'y appliquer. Une récompense n'a pas besoin d'être « proposable » au sens de la vente (ni description validée, ni identité du script) : il suffit qu'elle soit active, offerte, et que ses médias soient dans le coffre. Si son script est désactivé ou disparaît de Reveal, rien ne part, une alerte prévient le propriétaire, et le jeu s'éteint pour les nouveaux fans jusqu'au choix d'une autre récompense ; un fan qui avait déjà gagné garde sa récompense due, qu'un humain lui envoie. Tant que la synchronisation du coffre (ADR 0099) n'est pas livrée, le jeu ne peut pas être allumé : l'écran le dit.
4. **Qui voit quoi.** Le propriétaire et le manager voient et modifient les emplacements. Un chatteur en poste voit, sur la fiche du fan, s'il a joué, les zones trouvées (nombre seulement), les essais restants, le verdict et s'il a reçu sa récompense, jamais la liste des emplacements (il a le même verdict du code que l'agent quand il répond à la main, dans le copilote).

### Le jeu dans la conversation

5. **Le fan ouvre le jeu.** Le cerveau gagne l'intention `plays_heart_game` (le fan propose un emplacement ou parle du jeu). L'agent ne lance jamais le jeu de lui-même : si le fan n'en parle pas, elle n'en parle pas (Charles, 14/11 à 13 h 56, en sachant que la bienvenue de Reveal ne part pas pour la plupart des fans qui écrivent). L'annonce passe par la bio, le média d'engagement et la 2e bienvenue.
6. **Les règles sont dites avant que rien ne compte** (Charles, 14/11 : « il faut leur dire, c'est le jeu »). À l'ouverture, elle annonce une fois, avec ses mots : il y a N cœurs (N = le nombre d'emplacements du réglage), tous visibles dans le feed, il faut trouver leurs N emplacements exacts, il a 3 essais, et c'est maintenant ou jamais. Ce qu'il a proposé avant cette annonce ne compte pas ; elle lui demande sa réponse.
7. **Trois essais** (Charles, 14/11). Un essai, c'est un message où il propose de 1 à N zones qu'il n'a pas encore trouvées. Le code compare : chaque zone juste est acquise ; si toutes les zones proposées sont justes, l'essai ne coûte rien ; s'il y en a au moins une fausse, il perd un essai. Il gagne dès que les N sont trouvées. Un message qui propose plus de N zones ne compte pas : elle lui demande d'en choisir N au plus. Deviner au hasard ne sert donc à rien.
8. **Ce qu'elle peut dire.** Après un essai raté qui n'est pas le dernier, elle peut dire quelles zones étaient justes (« celle-là, c'est bon 😏 », en nommant la zone qu'il a trouvée) et combien il en reste, jamais où sont les autres. Après le 3e essai raté, il a perdu : elle ne révèle rien de plus, et il n'a pas la vidéo.
9. **Seulement pendant sa fenêtre d'arrivée** (Charles, 14/11 : « le lendemain, il a loupé le coche »). Le jeu n'est ouvert que pendant la **fenêtre d'arrivée** du fan (`arrival_window`), sa première discussion, celle du KYC : elle commence à son premier message et se termine après 2 h sans message de lui (réglable), et au plus tard à minuit, heure de Paris, le jour de son arrivée. Passé ce moment, ou après la victoire ou le 3e essai raté, le jeu est fermé pour lui pour toujours. S'il y revient plus tard, elle lui dit gentiment mais clairement qu'il a loupé le coche, que c'était à son arrivée, et passe à autre chose ; elle ne relance jamais le sujet elle-même. Un fan déjà abonné quand le jeu est allumé a sa chance pendant sa prochaine discussion (même règle : jusqu'à 2 h sans message de lui ou minuit), une seule fois. La fenêtre d'arrivée n'est pas la « session chaude » de l'ADR 0103 : deux notions et deux noms distincts, et le terme entre au glossaire dans la PR.
9 bis. **Le code décide, la voix formule.** Le verdict (`rules_told`, `found_some`, `missed`, `won`, `lost`, `closed`, `unclear`), les zones trouvées et les essais restants arrivent à la voix dans un bloc typé `<heart_game>` ; la voix réagit avec ses mots. La garde `heart_game_leak` bloque une bulle qui cite un emplacement qu'il n'a pas trouvé, et la renvoie à un humain. Une réponse floue (une zone trop large pour la liste) rend `unclear` : elle demande de préciser, rien n'est compté.
10. **Une zone intime proposée** n'est jamais un cœur ; elle reste traitée par les règles de sexualisation existantes (curseur, porte), le jeu ne les contourne pas.

### La récompense et la suite

11. **Une seule fois par fan, pour toujours.** L'état du fan (`rewarded_at`) et l'anti-doublon `media_sends` le garantissent ; l'envoi a sa clé d'idempotence. Un fan qui a déjà reçu ou acheté un média de ce script ne le reçoit pas une seconde fois : elle le félicite, et une alerte « Récompense déjà reçue » arrive à l'équipe pour décider d'un geste.
12. **La récompense n'ouvre pas de vente.** Elle ne passe pas la porte de vente (ADR 0098, 0103) : aucune offre payante dans les 2 h qui suivent son envoi (réglable). Si le fan demande lui-même à acheter pendant ces 2 h, la porte de l'ADR 0103 s'applique comme toujours (note au seuil, il sexualise, seul et libre) ; la récompense ne la remplace jamais. La course du script récompense est lancée par le code, sur le verdict `won`, jamais par un choix du cerveau ; elle est marquée offerte et reste hors de la course de vente (ADR 0098), et le pont permis après une étape offerte (ADR 0098) ne joue pas pendant ces 2 h. La légende de l'étape finit par une question sur lui (KYC), comme les teasers qui ont marché.
13. **Le jeu nourrit la fiche.** Le verdict (gagné, perdu, fermé), la date de la récompense et « est venu par le jeu » s'inscrivent sur la fiche du fan (ADR 0085).
14. **Les règles en vigueur passent avant.** Gardes dures, pièges, mode soin, `ai_disclosure`, mineur : le jeu se met en pause.

### Tester dans le playground

14 bis. **Le jeu se teste dans le playground, en conditions réelles** (Charles, 14/11). Le playground passe par le même chemin que la production (ADR 0102, 0103) : même intention, même verdict du code, mêmes gardes, mêmes règles d'annonce, d'essais et de fenêtre d'arrivée. Ce qui change :
   - l'état du jeu (zones trouvées, essais, verdict) vit dans la session de playground, jamais sur un vrai fan, et repart à zéro avec une nouvelle session ;
   - la session de playground compte comme la fenêtre d'arrivée du fan simulé ; un bouton « Passer au lendemain » ferme sa fenêtre d'arrivée pour tester le « tu as loupé le coche » ;
   - la récompense n'est jamais envoyée : le playground montre l'étape qui serait partie. On peut donc tester le jeu avant la synchronisation du coffre (« récompense pas encore choisie »), et même jeu éteint en production, avec un interrupteur propre au playground ;
   - les emplacements sont ceux du réglage réel de la créatrice, lus par le code seulement, comme en production.
   - « Passer au lendemain » et le saut de quelques heures (fermeture après 2 h sans message) viennent de l'horloge simulée commune du playground (elle ferme aussi la session chaude et la disponibilité, ADR 0103), pas un bouton propre au jeu ;
   - le panneau « Pourquoi » montre trouvée, ratée et essais restants, jamais la liste des zones (elle n'est jamais envoyée au navigateur).
   Relecteur de cette partie : le fil Playground.

14 ter. **La forme du code, pour que production et playground partagent tout.**
   - Une fonction pure `heartGameStep(state, guess, clock)` → verdict + nouvel état, dans `agent/domain/heart-game.ts`, avec un schéma Zod de l'état (rangé tel quel dans le `state` d'une session de playground).
   - Une fonction pure `isInArrivalWindow(view, clock)` décide la « fenêtre d'arrivée » de la règle 9, sur une vue d'historique injectée (`FanArrivalView` : heure de son premier message reçu, heure de son dernier message, date du jour à Paris, date d'allumage du jeu). Jamais `Date.now()` ni une requête directe : « maintenant » vient d'un port d'horloge, simulé au playground.
   - Un port `HeartGameStore` : la production l'écrit dans ses tables, le playground branche son propre adaptateur et n'écrit jamais les tables de production.
   - Les libellés français des verdicts sont dans le module ; les tests utilisent des zones fictives.

### Mesurer pour trancher

15. **Le CRM mesure si le jeu fidélise.** Événements `heart_game_opened`, `heart_game_won`, `heart_game_lost`, `heart_game_rewarded` (jamais le texte ni la zone). Une carte « Jeu des cœurs » (propriétaire seul) montre sur 30 jours : joueurs, gagnants, perdants, et parmi les gagnants, combien ont écrit à nouveau après 7 jours et combien ont acheté dans les 30 jours. Si les gagnants ne reviennent pas, Charles éteint le jeu d'un clic.

### Données

16. Aucun emplacement réel, aucun média, aucun nom de dossier réel dans le dépôt, les tests, les docs ou le chat. Les tests utilisent une créatrice fictive et des zones fictives, contre `FakeReveal`.

## Qui livre quoi (une PR à la fois, après « ok 0111 »)

- Fil Bilan : tables `heart_games` et `heart_game_progress` (FORCE RLS, GRANT au rôle de service), migration au numéro donné par le coordinateur ; contrat Zod de la liste fermée des zones.
- Fil Agent : intention, verdict (`agent/domain/heart-game.ts`), bloc `<heart_game>`, garde `heart_game_leak`, évals.
- Fil Médias : choix du script récompense dans l'écran du jeu, après la synchronisation du coffre.
- Fil Playground : l'état du jeu par session, le bouton « Passer au lendemain », l'affichage de l'étape qui serait partie (règle 14 bis).
- Fil Design : l'écran de réglage et la carte de mesure, puis captures.

## Conséquences

Positives : le jeu tourne sans chatteur, ne s'éternise pas, ne peut pas fuiter la réponse, ne donne jamais deux fois, et ses résultats se mesurent.

Négatives : dépend de la synchronisation du coffre ; la liste fermée de zones doit être assez fine pour « l'endroit exact » (une zone trop large rend le jeu facile, trop fine le rend injouable).

À surveiller : les messages ambigus, et le ton du « tu as loupé le coche », à relire dans les évals pour qu'il ne vexe pas le fan.
