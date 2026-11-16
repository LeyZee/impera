# 0126. Les lives de la créatrice : l'agent se tait pendant, en parle après, et se relaie avec les chatteurs

Statut : proposed (demande de Charles du 16/11/2026, 02 h 55 et 02 h 57, heure de Paris)
Date : 2026-11-16
Précise : ADR 0042 § 3 et § 4 (son agenda : la catégorie « Live » existe déjà), ADR 0048 § 4 (le calendrier ne réglait pas les heures de l'agent), P3-14 (heures d'activité), ADR 0088 (mode soin), ADR 0021 (jamais d'aveu d'IA), ADR 0057 et 0120 (API officielles seulement). Ne remplace rien.

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
7. **Les chatteurs** voient un bandeau « En live jusqu'à 23 h » sur le compte (inbox, panneau de l'extension, calendrier). Le copilote ne propose aucun brouillon pendant la fenêtre. Rien ne peut bloquer un humain qui écrit dans Reveal ; le bandeau suffit.

### C. Ce que l'agent en dit après

8. **Seulement ce qui est fait.** Un live est fait s'il a un début réel ou une coche ; un tournage ou une publication, s'il est coché. Un événement seulement prévu n'est jamais dit. Calendrier vide = l'agent n'invente rien.
9. **Le code écrit les faits, la voix les formule** (règle 3 de `CLAUDE.md`). Le contexte de l'agent reçoit un bloc typé `<her_day>` : au plus 3 faits des dernières 48 h, chacun réduit à une catégorie (`live`, `shoot`, `post`) et un moment relatif calculé par le code dans son fuseau (« hier soir », « cet après-midi »). Jamais le titre, le but, la fiche de tournage, une heure précise, un lieu, une autre catégorie (rendez-vous, perso), ni la plateforme (pas d'autre plateforme nommée à un fan).
10. **Pas de vente par ce biais.** « J'ai tourné cet aprèm » ne promet jamais le contenu : une vente ne passe que par un script (décision du 17/10). Un même fait n'est dit qu'une fois à un même fan. Après un live, l'agent peut s'excuser d'un silence (« j'étais en live 🙈 ») auprès des fans qui ont attendu.
11. **Garde `invented_activity`** : une bulle qui dit un live, un tournage ou une publication absents du bloc est bloquée et renvoyée à un humain. Évals : calendrier vide, live seulement prévu, live fait hier.
12. **Le playground** passe par le même chemin (ADR 0102) ; une session peut recevoir un agenda fictif, et l'horloge simulée ouvre et ferme la fenêtre de live.

### D. Les shifts de l'agent, en relais avec les chatteurs

13. **L'agent se planifie comme un membre**, dans le calendrier des shifts (ADR 0045), compte par compte. Ses heures d'activité (P3-14) deviennent ses **shifts récurrents** ; le propriétaire ou un manager y ajoute des **shifts datés** et des **exceptions datées** (« pas d'IA ce soir »). Cela amende l'ADR 0048 § 4 : le calendrier règle désormais les heures de l'agent. Il n'a toujours ni charge, ni rapport, ni paie.
14. **Un seul tient le compte à la fois.** Quand un chatteur a pris son shift sur le compte, l'agent ne répond pas en Automatique (il redevient Copilote pour ce chatteur). À la fin du shift, l'agent reprend si c'est son shift, avec la même réouverture étalée.
15. **Passage de relais.** À chaque relais, celui qui arrive voit les conversations actives, les scripts en cours et ce qui a été promis ; un script en cours continue avec celui qui tient le compte. L'agent relit l'historique comme toujours.
16. **Shift non pris** (EQ-12) : l'alerte existante part ; si le compte autorise l'agent, il prend le relais 15 min après le début prévu.
17. **Ordre de priorité** : fenêtre de live > arrêt global et mode Arrêt > shift d'un chatteur > shift daté de l'agent > heures d'activité.

### Qui code quoi

- Bilan : contrats et migration (`live_platform`, débuts et fins réels, shifts et exceptions de l'agent), job de fin de fenêtre.
- Badges, Chiffres, Vitrine (routines et agenda de la créatrice) : boutons de live, plateforme dans les tâches et les suggestions.
- Agent : règle de silence, relais, bloc `<her_day>`, garde `invented_activity`, évals.
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
