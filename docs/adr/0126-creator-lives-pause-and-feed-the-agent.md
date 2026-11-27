# 0126. Les lives de la créatrice : l'agent se tait pendant, en parle après, et se relaie avec les chatteurs

Statut : accepted (« ok 0126 » de Charles le 16/11/2026, 12 h 48, redit à 12 h 50 avec ses réponses aux questions a–e, heure de Paris ; demande du même jour, 02 h 55 et 02 h 57)
Date : 2026-11-16
Précise : ADR 0143 § C (ses comptes, pour la règle 11 bis), ADR 0042 § 3 et § 4 (son agenda : la catégorie « Live » existe déjà), ADR 0048 § 4 (le calendrier ne réglait pas les heures de l'agent), P3-14 (heures d'activité), ADR 0088 (mode soin), ADR 0021 (jamais d'aveu d'IA), ADR 0057 et 0120 (API officielles seulement). Ne remplace rien.

> Cette ADR ne contient aucune donnée réelle : ni créatrice, ni compte, ni horaire, ni plateforme réellement utilisée.

## Contexte

Les lives sont la meilleure source d'acquisition de l'agence : un fan qui a vu la créatrice deux heures en direct est plus fidèle que celui qui l'a découverte par une photo. L'agence va donc en demander dans ses suggestions de tâches. Charles demande deux choses :

1. **Crédibilité** : l'agent ne doit jamais écrire à un fan pendant qu'elle est en direct ailleurs.
2. **Vie** : l'agent doit pouvoir dire, après coup, ce qu'elle a fait (« j'ai fait un live hier soir », « cet aprèm j'ai tourné »), pour qu'elle paraisse vivante.

Il demande aussi (02 h 57) que chaque live porte sa plateforme (le plus souvent TikTok ou YouTube), et que l'agent ait de vrais **shifts**, en relais avec les chatteurs (méthode hybride : tantôt un chatteur, tantôt l'agent).

Ce qui existe au 16/11 (main `08ecb4d`) :
- Son agenda (`creator_tasks`, ADR 0042 § 4, CR-05) a déjà la catégorie `live` (📡), des tâches à heures (`timed`), des coches (`ticks`) et des suggestions qu'elle accepte ou refuse. On part de lui ; aucun second calendrier.
- Les heures d'activité de l'agent (`creators.agent_hours`, P3-14) : des créneaux de réponse **par jour de la semaine**, rien par date. Hors créneau, le message attend (`reply_deferred`) et la réouverture (`conversation.reopen`) répond aux fans un par un, le plus ancien d'abord, espacés de `RESUME_SPACING_SECONDS`. Un fan en détresse est servi tout de suite (ADR 0088).
- L'agent ignore les shifts des chatteurs : en Automatique, il peut écrire pendant qu'un chatteur tient le compte.
- Ce que l'API officielle permet (documentation lue le 16/11/2026) : **TikTok n'a aucune permission ni notification sur les lives** (permissions : profil, vidéos, publication ; notifications : autorisation retirée, vidéo publiée ou en échec, export prêt). Les bibliothèques qui « détectent un live TikTok » sont non officielles et exclues. **YouTube** permet, avec le compte de la créatrice connecté par OAuth, de demander ses diffusions en cours (`liveBroadcasts.list`, `broadcastStatus=active`, 1 unité de quota) ; pas de notification poussée pour un live, il faut demander à intervalle.

## Décision

### A. Le live dans son agenda

1. **Un live est une tâche `timed` de catégorie `live`** qui porte en plus sa **plateforme** (`live_platform` : `tiktok`, `youtube`, `instagram`, `twitch`, `other`), obligatoire pour cette catégorie, interdite pour les autres. Une suggestion de live de l'agence la porte aussi, et la tâche acceptée la recopie. Elle reste libre de refuser ou déplacer (ADR 0042 § 3).
2. **Deux boutons sur la tâche, sur son téléphone** : « Je lance mon live » et « Fin du live ». Le premier enregistre le début réel (même sans tâche prévue : un live non prévu se crée alors, 2 h par défaut) ; le second, la fin réelle. Le texte ne nomme pas l'agent : « Tes conversations attendent la fin du live ».
3. **La détection automatique est un plus, jamais la base.** TikTok : aucune, faute d'API officielle. YouTube : possible plus tard, par une ADR courte, si elle connecte son compte (OAuth, lecture seule, interrogation toutes les 2 min seulement autour d'un live prévu). Jamais d'automatisation d'une appli ou d'un navigateur (ADR 0057).

### B. Silence pendant le live

4. **Fenêtre de live** : de 15 min avant le début prévu jusqu'à la fin prévue ; un début réel l'ouvre aussitôt, une fin réelle la ferme aussitôt ; un live lancé sans fin s'arrête au plus tard 4 h après son début. Le code la calcule dans son fuseau (`creators.timezone`) ; les deux marges sont des constantes du domaine.
5. **Pendant la fenêtre, l'agent n'envoie rien** : pas de réponse, pas de relance, pas d'étape de script, sur toutes ses conversations. Un message reçu attend comme hors créneau (`reply_deferred`, raison `live`), et la fin de la fenêtre programme la même réouverture étalée (`conversation.reopen`), le plus ancien d'abord : jamais trente fans dans la même minute. Le live passe avant les créneaux de réponse et avant le mode Automatique.
6. **Le mode soin reste prioritaire** (ADR 0088) : un fan en détresse a toujours un brouillon, validé par un humain qui sait qu'elle est en live.
7. **Les chatteurs** voient un bandeau sur le compte (inbox, panneau de l'extension, calendrier) : « Elle est en live jusqu'à 23 h : n'écris pas. Si tu dois répondre, reste cohérent, elle est en live. » Le copilote ne propose aucun brouillon pendant la fenêtre. Rien ne peut bloquer un humain qui écrit dans Reveal ; la consigne est de ne rien écrire (Charles, 16/11 : « redoubler de cohérence »).

### C. Ce que l'agent en dit après

8. **Seulement ce qui est fait.** Un live est fait s'il a un début réel ou une coche ; un tournage ou une publication, s'il est coché. Un événement seulement prévu n'est jamais dit. Calendrier vide = l'agent n'invente rien.
9. **Le code écrit les faits, la voix les formule** (règle 3 de `CLAUDE.md`). Le contexte de l'agent reçoit un bloc typé `<her_day>` : au plus 3 faits des dernières 48 h, chacun réduit à une catégorie (`live`, `shoot`, `post`) et un moment relatif calculé par le code dans son fuseau (« hier soir », « cet après-midi »). Jamais le titre, le but, la fiche de tournage, une heure précise, un lieu, une autre catégorie (rendez-vous, perso), La plateforme du fait peut être nommée (« j'ai fait un live sur TikTok hier »), jamais un pseudo dans ce bloc.
10. **Pas de vente par ce biais.** « J'ai tourné cet aprèm » ne promet jamais le contenu : une vente ne passe que par un script (décision du 17/10). Un même fait n'est dit qu'une fois à un même fan. Après un live, l'agent peut s'excuser d'un silence (« j'étais en live 🙈 ») auprès des fans qui ont attendu.
11. **Garde `invented_activity`** : une bulle qui dit un live, un tournage ou une publication absents du bloc est bloquée et renvoyée à un humain. Évals : calendrier vide, live seulement prévu, live fait hier.
11 bis. **Ses réseaux, parfois** (Charles, 16/11 12 h 50 : « on est en bas de funnel, le but est de les garder sur Reveal, mais de temps en temps on peut dire suis-moi ici, je fais des lives ici »).
   - Le compte donné est celui de « Ses comptes » (ADR 0143 § C) dont l'usage est « lives » et qui est marqué « l'agent peut le donner » ; aucun autre objet. Les règles de l'ADR 0143 (§ 16, coupures ; § 18 et § 19, le code décide et la garde de sortie bloque un nom non autorisé ou un lien) s'appliquent ; cette règle n'ajoute que l'occasion de le proposer sans que le fan le demande.
   - **Le code décide quand** : il ne donne à la voix un bloc typé `<her_socials>` (un seul compte, celui des lives quand il y en a) que si le fan n'en a jamais reçu dans les 30 derniers jours, n'est pas dans une session chaude ni une course de script (ADR 0098, 0103), n'est pas en mode soin, et seulement après un fait de live dit ou une question du fan sur ses lives ou ses réseaux. La voix le dit en passant, comme un « suis-moi », jamais comme un départ de Reveal.
   - Jamais une messagerie privée ni une autre plateforme payante, jamais d'annonce d'un live à venir.
   - Les deux seuils (30 jours, un compte) sont des constantes du domaine ; à mesurer : fans qui écrivent encore sur Reveal 7 jours après l'avoir reçu.
   - *Avenant du 27/11/2026 (décision de Charles, 15 h 47, méthode § 10.27 Q3) : le compte des lives est son TikTok, saisi dans sa fiche du CRM (`agent.rules.own_accounts.tiktok`, avenant de l'ADR 0143 § 9). La garde de sortie laisse passer exactement ce pseudo dans un contexte de live (le fan parle de ses lives, ou sa réponse dit « j'étais en live ») ; hors de ce contexte, ou tout autre pseudo, il reste bloqué. Le bloc `<her_socials>` prévu ici s'appelle `<her_accounts>` dans le code ; le seuil de 30 jours n'est pas encore codé.*
12. **Le playground** passe par le même chemin (ADR 0102) ; une session peut recevoir un agenda fictif, et l'horloge simulée ouvre et ferme la fenêtre de live.

### D. Les shifts de l'agent, en relais avec les chatteurs

13. **L'agent se planifie comme un membre**, dans le calendrier des shifts (ADR 0045), compte par compte. Ses heures d'activité (P3-14) deviennent ses **shifts récurrents** ; le propriétaire ou un manager y ajoute des **shifts datés** et des **exceptions datées** (« pas d'IA ce soir »). Cela amende l'ADR 0048 § 4 : le calendrier règle désormais les heures de l'agent. Il n'a toujours ni charge, ni rapport, ni paie.
14. **Un seul tient le compte à la fois.** Quand un chatteur a pris son shift sur le compte, l'agent ne répond pas en Automatique (il redevient Copilote pour ce chatteur). À la fin du shift, l'agent reprend si c'est son shift, avec la même réouverture étalée.
15. **Passage de relais.** À chaque relais, celui qui arrive voit les conversations actives, les scripts en cours et ce qui a été promis ; un script en cours continue avec celui qui tient le compte. L'agent relit l'historique comme toujours.
16. **Jamais un fan laissé seul** (Charles, 16/11 12 h 50). Pendant le shift d'un chatteur, le code ne juge pas la présence du chatteur mais le résultat : un message de fan sans réponse humaine depuis 30 min est pris par l'agent, conversation par conversation, en Automatique, et une alerte part au manager en poste ou au propriétaire (la même que le shift non pris, EQ-12). Jamais pendant une fenêtre de live, ni en mode Arrêt ou arrêt global. Le chatteur reprend la conversation dès qu'il y écrit. Le seuil de 30 min est un réglage du compte.
17. **Ordre de priorité** : fenêtre de live > arrêt global et mode Arrêt > shift d'un chatteur > shift daté de l'agent > heures d'activité.

### Réponses de Charles (16/11, 12 h 50)

18. a) Chatteurs pendant un live : bandeau et consigne de ne rien écrire (règle 7). b) Jamais d'annonce d'un live à venir, mais ses réseaux donnés de temps en temps (règle 11 bis). c) La plateforme peut être nommée (règle 9). d) L'agent prend toute conversation sans réponse humaine depuis 30 min (règle 16). e) Détection YouTube plus tard (règle 3).

### Qui code quoi

- Bilan : contrats et migration (`live_platform`, débuts et fins réels, shifts et exceptions de l'agent), job de fin de fenêtre.
- Badges, Chiffres, Vitrine (routines et agenda de la créatrice) : boutons de live, plateforme dans les tâches et les suggestions.
- Agent : règle de silence, relais, prise d'une conversation sans réponse depuis 30 min, blocs `<her_day>` et `<her_socials>`, garde `invented_activity`, évals.
- Équipe : shifts de l'agent dans le planning, relais, shift non pris.
- Design : boutons, bandeau, calendrier.

## Conséquences

Positives :
- Aucun message pendant un live, même quand elle oublie de le dire : le calendrier suffit.
- L'agent parle de sa vraie journée, sans jamais rien inventer.
- Un planning unique dit qui tient chaque compte, humain ou agent, et plus personne n'écrit en double.

Négatives, à surveiller :
- Un live annulé mais laissé dans l'agenda coupe l'agent pour rien ; le bouton « Fin du live » le rouvre.
- Un live oublié de l'agenda et sans bouton laisse l'agent écrire : seule YouTube pourra le rattraper.
- Après un gros live, la réouverture étalée retarde les derniers fans ; à mesurer.

## Alternatives rejetées

- **Détecter les lives TikTok par une bibliothèque non officielle** : contraire aux conditions de TikTok et à l'ADR 0057.
- **Un second calendrier pour l'agent ou pour les lives** : son agenda existe et a déjà la catégorie.
- **Passer le titre de la tâche à l'agent** : texte libre, il peut contenir un lieu ou un nom.
- **Dire les événements prévus** (« je suis en live ce soir ») : un live annulé ferait mentir l'agent, et cela renvoie les fans vers une autre plateforme.
