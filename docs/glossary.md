# Glossaire FR ↔ EN

Le code (identifiants, tables, événements) est en anglais. Les docs, l'interface et les personas sont en français. Ce glossaire fixe la correspondance : on n'invente pas de synonyme.

| Français (docs, UI) | Anglais (code) | Définition |
|---|---|---|
| Créatrice, modèle | `creator` | Le tenant. Une personne dont on gère les comptes et les conversations. « Modèle » dans Imperium ; ici on dit créatrice. |
| Compte plateforme | `platform_account` | Le compte d'une créatrice sur une plateforme (Reveal, OnlyFans, Nirvana). |
| Plateforme | `platform` | Reveal, OnlyFans, Instagram, Nirvana (la nôtre). Valeur d'enum, jamais une logique dans le cœur. |
| Fan | `fan` | Une personne qui écrit à la créatrice sur un compte plateforme. Identifié par `platform_fan_id`. |
| Personne | `person` | (Plus tard) un même humain reconnu sur plusieurs plateformes. `fans.person_id` nullable. |
| Conversation | `conversation` | Le fil 1:1 entre un fan et un compte plateforme. |
| Message | `message` | Un message reçu ou envoyé. `direction: inbound | outbound`, `author: fan | human | ai`. |
| Journal d'événements | `conversation_events` | Historique append-only de tout ce qui arrive à une conversation. Source de vérité. |
| Brouillon, proposition | `draft` | Une réponse proposée par l'IA, en attente d'approbation ou auto-approuvée. |
| Brief | `brief` | La sortie structurée du cerveau qui dit à la voix quoi écrire. |
| Sens | `sense` | Rôle LLM qui décrit les médias. |
| Cerveau | `brain` | Rôle LLM qui analyse et décide. |
| Voix | `voice` | Rôle LLM qui rédige dans la voix de la créatrice. |
| Juge | `judge` | Rôle LLM d'évaluation, jamais sur le chemin d'un vrai fan : évals, et retour aux recrues dans S'entraîner. |
| Politique | `policy` | Règles déterministes en code appliquées entre le cerveau et la voix. |
| Gardes | `guards` | Vérifications en code après la voix (dégoûts, répétition, longueur, argent, identité). |
| Repli | `fallback` | Le modèle de secours d'un rôle LLM, utilisé quand le modèle actif refuse, ne répond pas ou n'a pas de clé. |
| Santé (des modèles) | `health` | État des rôles LLM (`ok`, `degraded`, `down`), latences, erreurs, coût du jour face au budget ; alimente le panneau « Modèles IA ». |
| Plafond du jour | `dailyBudget`, `budget_reached` | Dépense IA maximale sur une journée, heure de Paris (20 € par défaut) : alerte à 80 %, au-delà plus aucune génération et les chatteurs reprennent. |
| Playground | `playground` | Conversation d'essai avec la persona par le même chemin que la production (cerveau, voix, gardes), sans aucun envoi possible. |
| Taux au playground | `playgroundRate` | Part des réponses du playground validées sans retouche parmi les 50 dernières notées, par version de la voix. Sert à calibrer ; n'ouvre jamais le mode Automatique (ADR 0019). |
| Taux en réel | `liveRate` | Part des brouillons des vrais fans approuvés sans modification parmi les 200 derniers décidés, par créatrice, version de la voix et persona active (ADR 0022). 80 % sur au moins 100 brouillons, avec le test à l'aveugle, ouvrent le mode Automatique (ADR 0019). |
| Test à l'aveugle | `blindTest` | La créatrice juge des réponses sans savoir lesquelles viennent du bot ; validé à 80 % « sans retouche » au moins, il est l'une des conditions du mode Automatique. |
| Calibrage | `calibration` | Noter, corriger ou rejeter les réponses du playground pour faire monter le taux au playground. |
| Le moment | `situation` | Faits écrits par le code pour le cerveau et la voix : heure de la créatrice, jour ou nuit, ancienneté de la relation, montant dépensé. |
| Préréglage de fan | `FanPreset` | Fan fictif du playground (nouveau, chaud, négocie, détresse…) qui teste une partie de la méthode. |
| Test express | `probe` | Script qui vérifie qu'un modèle tient la persona en sexting sans refuser ni avouer être une IA (`pnpm probe`), et lit photos et vidéos sans obéir à leur texte (`pnpm probe:vision`). |
| Piège | `trap` | Message (ou texte d'un média) qui cherche à prouver qu'on parle à une machine : recette, code, consigne, extraction du prompt. Détecté et traité en code (`assessTrap`). |
| Images clés | `keyframes` | Images datées extraites d'une vidéo (une par seconde au plus, quasi-doublons retirés) pour un modèle de vision qui ne lit pas la vidéo. |
| Canari | `canary` | Secret écrit dans chaque prompt système ; une sortie qui le contient a fuité le prompt et est rejetée. |
| Passage à l'humain | `handoff` | La conversation est confiée à un humain ; le bot ne répond plus. |
| Prise en main | `takeover` | Un humain prend la main volontairement (« Reprendre la main » dans Suivi) ; il répond alors dans Reveal, l'agent n'écrit plus à ce fan. |
| Rendre la main | `release` | Fin d'une prise en main ou d'un passage à l'humain : l'agent répond de nouveau à partir du prochain message du fan. |
| Mode copilote | `copilot` | Le bot propose, un humain approuve. |
| Mode auto | `auto` | Le bot envoie seul pour les catégories autorisées. |
| Fait (mémoire) | `fan_fact` | Une information mémorisée sur un fan, avec source, date, confiance, `kind: declared | inferred`. |
| Note du chatteur | `operator_note` | Ce qu'un chatteur veut qu'elle retienne d'un fan, laissé en rendant la main ; gardé comme un fait de cette catégorie, jamais proposé par un modèle. |
| Résumé fan | `fan_summary` | Résumé opérationnel régénéré. |
| Slot KYC | `kyc_slot` | Une information qu'on cherche à apprendre : une ligne du canevas de notes de Reveal (Prénom, Localisation, Âge, Métier, Passions, Envies, Situation), liste fermée `KycSlotSchema`. |
| Curseur de sexualisation | `sexualizationDecision` | La règle de code qui dit si elle peut suivre un fan qui sexualise ou l'ouvrir elle-même : délais de la persona (`strategies.sexualization.initiate_after_hours`, `strategies.kyc.min_hours_before_following`) et âge confirmé. |
| Recadrage | `steer_back` | Quand il va trop vite (trop tôt ou âge non confirmé), elle ralentit dans sa voix, sans rien d'explicite ni de reproche, et revient sur lui. |
| Âge déclaré | `declaredAdultAge` | Un âge de 18 ans ou plus qu'il écrit lui-même, sans signe de mineur : il confirme son âge (`ageConfirmedAt`, auteur `system`, Charles 27/10). |
| Âge contesté | `ageDisputed` | Posé avec chaque retrait de l'âge confirmé (signe de mineur ou humain) : sa déclaration ne le confirme plus ; seuls le propriétaire et un manager actif le lèvent en reconfirmant l'âge, avec une raison écrite gardée dans l'événement (SUIVI-04, 29/10). |
| Drapeau du fan | `fan_flag` | Une limite du fan (`fans.flags`, `FanFlagsSchema`) : âge confirmé, ventes gelées et leur raison, plafond de dépense, fragile, pas d'explicite, ne plus écrire. Lue par la politique avant toute offre, posée par la politique ou un humain, jamais par un modèle seul. |
| Persona | `persona` | La fiche versionnée de la créatrice, calquée sur la fiche OnlyChat (détails, infos en plus, comportement, stratégies, relances, notifications), plus ses limites. |
| Version de persona | `persona_version` | Un état enregistré de la persona d'une créatrice. Une seule est active, celle avec laquelle l'agent écrit ; le CRM enregistre des versions qui restent inactives tant qu'elles ne sont pas activées (ADR 0010). |
| Infos en plus | `additional_info` | Le texte libre de la persona (6 000 caractères au plus). Remplacé peu à peu par les blocs (P5-01), il disparaîtra avec `schema: 2` (ADR à venir). |
| Elle en détail | `in_depth` (onglet) | L'onglet de la persona qui regroupe en sections repliées les cinq blocs P5-01 (Mode de vie, Goûts, Intime, Style d'écriture, Réponses types). Un regroupement d'écran : le schéma garde les blocs séparés. |
| Bloc de persona | `persona_block` | Une partie guidée de la persona (P5-01), toutes facultatives : Détails, Mode de vie (`lifestyle`), Goûts (`tastes`), Intime (`intimate`), Style d'écriture (`writing_style`), Réponses types (`sample_replies`), Limites. Liste et libellés : `PERSONA_BLOCKS`, `PERSONA_BLOCK_LABELS`. |
| Complétion de la persona | `persona_completion` | Ce qui est rempli de la persona, de 0 à 100 %, chaque bloc pesé (`PERSONA_BLOCK_WEIGHTS`), avec la liste de ce qui manque dans l'ordre des blocs (`personaCompletion`). Jamais une condition d'activation : jauge neutre, sans couleur. |
| Réponse type | `sample_reply` | Une réponse inventée qu'elle écrirait, avec le moment qu'elle suit, que la voix lit comme exemple (dix au plus). Refusée à l'enregistrement si une garde dure la bloquerait. |
| Infos à collecter | `kyc_collect`, `strategies.kyc.collect` | Les cases du canevas de notes Reveal qu'elle cherche à apprendre de chaque fan, dans son ordre ; toutes sans choix. Le cerveau ne nomme que celles-là dans `kycMissing`. |
| À apprendre | `FanKycView.toLearn`, `kycSlotsToLearn`, `GET /v1/fans/:id/kyc` | Les infos à collecter qu'on ne sait pas encore d'un fan : celles sans fait actif de cette clé, dans son ordre. Une ligne neutre de la fiche du fan dans le Suivi, jamais dans la liste. |
| Limites | `limits` | Ce que la créatrice ne fait, ne montre, ne dit jamais, et ses dégoûts. Chargées par les gardes. |
| Surnom | `pet_name` | Un des surnoms que la créatrice donne aux fans, pris dans la liste fermée de sa persona. |
| Sexualisation | `sexualization` | Le moment où la conversation devient sexy, et la stratégie qui le règle. |
| Note de désir | `desire_score`, `desire_band` | La tension sexuelle d'un fan, de 0 à 100, comptée par le code à partir de signaux fermés et qui retombe quand il se tait ; trois bandes : neutre (`neutral`, 0 à 39), joueur (`playful`, 40 à 69), chaud (`hot`, 70 à 100). Elle ne fait que retenir l'ouverture de l'intime et les offres (P3-12). |
| Didascalie | `stage_direction` | Une action écrite pour que le fan l'imagine (« *sourit* », « (rires) ») : jamais dans un message d'elle, bloquée par une garde de voix (P3-13). |
| Mot de rencontre repéré | `platform_meeting_word` | Un mot que les plateformes repèrent même dans un refus (« rdv », « se rencontrer », « IRL ») : bloqué, à la différence de la promesse de rencontre (`meeting_promise`) qui bloque l'invitation (P3-13). |
| Fausse urgence | `fake_emergency` | Une maladie, une dette, le loyer ou une urgence invoqués pour vendre, ou une demande d'argent pour elle : bloquée, jamais utilisée pour vendre (P3-13). |
| Suivi d'offre | `post_offer` | Ce que fait l'agent après un achat ou une offre refusée. |
| Mot-clé d'alerte | `alert_keyword` | Un mot qui, écrit par un fan, met l'agent en pause pour ce fan et prévient un humain. |
| Alerte personnalisée | `custom_alert` | Une alerte que le propriétaire écrit lui-même (P4-01) : une phrase que le cerveau évalue, des mots-clés lus en code, ou les deux ; elle prévient un humain et, si elle est cochée « met en pause », passe la main. Une ligne par créatrice, montrées comme une seule alerte. |
| Doute sur la personne | `identity_doubt` | Alerte système (P4-01) : le fan doute de parler à la créatrice ; avec un chatteur en poste, l'agent lui passe la main (cause `identity_doubt`), sinon il prévient seulement. Jamais l'agent ne dit qu'il est une IA (ADR 0021). |
| Pas de persona active | `persona_inactive` | Cause de passage à un chatteur : la créatrice n'a pas de version de persona active (ou elle ne se lit plus), donc l'agent n'écrit rien pour elle et rien ne peut être approuvé tant qu'une version n'est pas activée (ADR 0010, 0022). |
| Historique des alertes | `alert_triggered`, `alert_seen` | Sous-vue du Suivi (P4-01) : chaque déclenchement d'une alerte d'une créatrice, le plus récent d'abord, avec une ligne écrite par le code (le nom de l'alerte et le mot déclaré, jamais le texte du fan) et le « vu » de l'agence. Ce n'est pas une boîte : ce qui demande une main est dans « À traiter ». |
| Demande de service | `service_request`, `asks_for_service` | Alerte système (P4-01) : le fan demande un contenu sur mesure, un appel, une cam ou un vocal ; le cerveau le lit dans l'intention `asks_for_service`, l'agent ne met pas en pause et prévient un humain, qui peut le vendre. |
| Alertes vues | `alertsSeen` | Les ids courts (`a1`…) des alertes de la créatrice que le cerveau reconnaît dans le message du fan (P4-01) : le code ne garde que ceux qu'il a donnés, jamais de texte du modèle. |
| Déclenchement d'alerte | `alert_triggered` | L'événement d'une alerte qui prévient sans mettre l'agent en pause : il nomme l'alerte et comment elle a sonné, jamais ce que le fan a écrit. Une alerte qui met en pause est un passage à l'humain avec son `trigger`. |
| Rester en personnage | `asks_if_bot`, `ai_disclosure` | Le bot ne dit jamais qu'il est une IA : à « t'es un bot ? » (`asks_if_bot`), il répond en personnage, et la garde `ai_disclosure` bloque tout aveu. Fixé dans le code, pas un réglage (ADR 0021). |
| Média | `media_asset` | Une photo, vidéo ou audio de la créatrice (catalogue) ou reçue d'un fan. |
| Description de média | `media_description` | La sortie du rôle sens, au vocabulaire Nirvana. |
| Offre | `offer` | Une proposition commerciale (média + prix + plancher). Phase 6. |
| Budget nul | `hasNoBudget` | Drapeau posé par le code quand le fan dit ne pas pouvoir payer : plus aucune offre ni bouderie ni relance de vente tant qu'il ne revient pas de lui-même vers le payant. |
| Délai entre deux scripts | `cooldownHours` | Temps minimum entre deux scripts proposés à un même fan, lu dans la persona (`strategies.script_launch.cooldown_hours`, réglable par créatrice) ; après, un script ne part que si le fan sexualise de nouveau (`offerDecision`). |
| Vente | `sale` | Une transaction détectée sur la plateforme. Montant en centimes + devise. |
| Script | `script` | Séquence d'étapes de vente (structure). Phase 6. |
| Étape | `script_step` | Une étape d'un script (message, médias, prix, pacing). |
| Carton | `card` | Séparateur visuel d'étape (PNG), hérité d'OnlyScript. |
| Structure | `script_structure` | Ossature d'un script (ordre des étapes, médias attendus, intention). |
| Script natif | `platform_script` | Un script de vente stocké sur la plateforme (Reveal), que l'agent lit et déroule. À ne pas confondre avec `script`, notre structure interne. |
| Note client | `fan_note` | La note libre qu'une plateforme attache à un fan, lue et écrite par les chatteurs et l'agent. Distincte de `fan_fact`. |
| Notes du modèle | `creator_note` | Les notes que Reveal affiche à côté de chaque conversation sur la créatrice : sa fiche persona vue par la plateforme. |
| Bundle (PPV) | `bundle` | Le PPV de Reveal : médias floutés vendus (au moins un), prix TTC, tarif réduit optionnel, aperçu gratuit de 10 médias au plus. |
| Coffre | `vault` | Les médias de la créatrice stockés sur la plateforme, réutilisables à l'envoi. |
| Médiathèque | `media_library` | Les médias d'une créatrice vus dans Nirvana, reflet du coffre de chaque plateforme, dossiers compris ; remplie par synchronisation seulement, jamais par téléversement (ADR 0030). |
| Liaison de média | `media_platform_ref` | Le lien entre un original du coffre d'un compte plateforme (`platform_media_id`, dossier) et son média ; elle existe avant que le fichier soit lu, et deux liaisons de plateformes différentes ne rejoignent un même média que par un rattachement humain (ADR 0030). |
| Synchronisation des médias | `media.sync` | Le job rejouable qui lit le coffre d'un compte, crée ou met à jour les liaisons, marque les médias disparus et fait décrire les nouveaux (ADR 0030). |
| Description validée | `validated_at` | Une description de média relue et validée par un humain ; la seule que l'agent lit, jamais écrasée par une nouvelle génération (ADR 0030). |
| Média vu | `seen` | Un média que ce fan a déjà eu : gratuit dès l'envoi, payant une fois débloqué (`unlocked_at`, confirmé par la plateforme), lu dans les messages de la plateforme ingérés (`media_sends`), envois manuels des chatteurs compris ; un script dont un média est vu n'est plus proposable à ce fan (ADR 0030). |
| Capture | `recording` | Un enregistrement anonymisé du trafic entre le site d'une plateforme et ses serveurs (HAR ou enregistreur de l'extension). |
| Fan test | `test_fan` | Un compte fan qui appartient à l'agence, seule cible autorisée des écritures pendant les captures et les tests manuels. |
| Relance | `follow_up` | Message qu'elle écrit après un silence du fan, aux délais de la persona ; un brouillon à valider comme toute réponse (P3-10). Le code la décide (`followUpDecision`) : jamais à un fan à ne plus contacter ni en détresse, jamais hors de ses créneaux de réponse ni dans ses heures calmes des relances, 23 h – 9 h par défaut (reportée à la première minute où les deux le permettent, P3-14), jamais rien à vendre tant que l'historique des scripts Reveal manque (P6-01). |
| Ancre d'une relance | `anchorAt` | Le dernier message du fan, d'où se comptent les délais des relances ; un nouveau message de lui la déplace et la relance en attente ne part pas. |
| Réponse différée | `waitedFor` | Sa réponse remise à plus tard quand elle choisit d'attendre (« attends, je reviens ») : une seule fois, 5 à 25 minutes après, tant qu'il n'a rien écrit ; au second passage elle ne peut plus attendre, et si rien ne s'écrit, un humain prend la main (P3-11). Ce n'est pas une relance : c'est elle qui n'a pas encore répondu. |
| Petit rappel | `nudge` | Rappel court quand le fan a lu sans répondre (« nudge » d'OnlyChat). |
| Cooldown | `cooldown` | Délai pendant lequel le bot ne pousse pas de vente. |
| Connecteur | `connector` | Adaptateur d'une plateforme derrière le port `PlatformConnector`. |
| Clé de fournisseur | `provider_credential` | Clé d'API d'un fournisseur IA (xAI, Google, ElevenLabs…), saisie dans Réglages › Modèles IA et chiffrée en base (ADR 0016). À l'écran, on parle de « services », jamais de « connecteurs ». |
| Session (plateforme) | `platform_session` | Les jetons/cookies capturés qui permettent au connecteur d'agir. |
| Jeton d'appareil | `device token` | Secret de l'extension pour déposer une session (`POST /v1/connector/sessions`, `EXTENSION_DEVICE_TOKEN`). |
| Composeur | `DraftComposer` | Le port par lequel `conversation.respond` demande un brouillon au moteur ; il rend des bulles ou une retenue (`held`) avec sa raison. |
| Coupe-circuit | `breaker` | Pause d'un compte plateforme après N relèves ratées d'affilée (`connector_config`), avec un événement `error`. |
| Garde d'écriture | `writes` | Réglage d'un compte plateforme (`connector_config.writes`, fermé par défaut) : fermé, aucun envoi ne part, seule la lecture continue. |
| Interrupteur d'arrêt | `kill_switch` | Arrêt global, par créatrice ou par conversation. |
| Chatteur | `operator` | Humain qui chatte ou supervise (vocabulaire Imperium : chatteur). |
| Fiche de tâche | `task card` | Une unité de travail pour une session (`docs/sessions/tasks/`). |
| Fiche proposée | `proposed` | Fiche écrite par une session, sans ID, en attente de l'accord de Charles. |
| Bulle | `bubble` | Un message envoyé d'un coup ; un draft est une liste de bulles. |
| Projection | `projection` | Colonne d'état dérivée du journal d'événements, reconstructible (ADR 0007). |
| Outbox | `domain_events` | Table append-only des événements qu'un autre module consomme (ex. `draft_created` lu par `supervision`). |
| Racine de composition | `composition root` | `apps/api/src/composition-root.ts` : le seul endroit qui construit les modules et les branche entre eux. |
| Battement | `heartbeat` | Ligne écrite par le worker toutes les 30 s (`worker_heartbeats`), lue par `/ready`. |
| Identifiant de corrélation | `correlationId` | Le `x-request-id` d'une requête, propagé aux jobs, appels LLM et logs qu'elle déclenche. |
| Playground | `playground` | Bac à sable de conversation : on parle au bot (soi-même, fan simulé ou rejeu) par le même chemin que la production, sans rien envoyer sur une plateforme. Proposé dans `brainstorm/06`. |
| Vitrine | `showcase` | Page de démonstration des composants du design system (dev seulement). Ne pas confondre avec le playground. |
| Fan simulé | `simulated_fan` | Fan joué par une IA d'après un profil, dans le playground. |
| Mode démo | `isDemo` | Écran du playground servi par des réponses écrites à l'avance, quand les routes `/v1/playground` ne sont pas en ligne sur le serveur. Signalé par la pastille « Démo » ; rien n'est noté pour de vrai. |
| À traiter | `todo` | La file en tête du Dashboard et de Suivi : ce qui attend un humain (passage à l'humain, mot-clé d'alerte, fan sans réponse depuis plus de 10 min, proposition du copilote, envoi échoué pour de bon, message sans réponse ni brouillon depuis plus de 30 min `unanswered`), le plus grave en premier. Ligne `nv-todo` du design system. |
| Parcours des fans | `funnel` | L'entonnoir du Dashboard : combien de fans passent chaque étape (nouveau, fan connu, conversation chaude, 1re offre, achat), et l'étape qui casse. |
| Données d'exemple | `sample` | Données fictives d'un écran du CRM tant que sa route n'existe pas, signalées par la pastille « Exemple » (`nv-sample`). Distinct du mode démo du playground. |
| Compte fan de test | `test_fan_account` | Vrai compte fan sur une plateforme, tenu par nous, pour tester envois et ventes sans toucher un vrai fan. |
| Liste blanche d'envoi | `send_allowlist` | Fans vers lesquels le connecteur accepte d'envoyer tant qu'elle n'est pas vide (phase 2). |
| Enregistreur | `recorder` | Fonction de l'extension qui note les échanges réseau du site d'une plateforme, anonymisés. |
| Notification Telegram | `telegram_delivery` | Un message que le CRM livre dans un groupe Telegram (alerte, vente, mot-clé, validation). Ne contient jamais de donnée de fan (ADR 0020). |
| Sujet | `topic` | Ce dont parle une notification Telegram : `urgent`, `important`, `info` (onglet Alertes), `sale`, `keyword`, `validation`, `custom` (les alertes personnalisées, un seul sujet pour toutes). Chaque sujet a son routage. |
| Bot (Telegram) | `telegram_bot` | Un bot créé par @BotFather, ajouté dans Réglages › Telegram par son jeton, chiffré en base. Il n'agit sur rien, il prévient. |
| Groupe (Telegram) | `telegram_chat` | Un groupe où un bot se trouve, découvert automatiquement, jamais saisi à la main. |
| Routage | `telegram_route` | Quel sujet va dans quel groupe, pour une créatrice ou pour toutes. |
| Astreinte | `on_call` | Le groupe Telegram qui reçoit l'urgent la nuit. « Personne n'est prévenu la nuit » quand aucune créatrice n'en a un joignable. |
| Apparence (Nuit, Jour, Appareil) | `appearance` (`night`, `day`, `device`) | Le thème du CRM, choisi dans Réglages › Apparence et gardé par le navigateur. Nuit par défaut ; Appareil suit le mode clair ou sombre de l'ordinateur ou du téléphone. |
| Membre de l'équipe | `team_member` | Le profil d'un chatteur ou d'un manager de l'agence, lié à son compte : rôle d'équipe, pays, fuseau, taux de commission, statut (actif, en congé, malade, en déplacement, suspendu, parti) (ADR 0023). Pour l'agence, c'est un prestataire indépendant, jamais un salarié. |
| Conversation routée | `routed_to_user_id` | Une conversation confiée à un membre de l'équipe (une passation `sale`, EQ-08). Un chatteur hors de son shift n'atteint une créatrice que par elles (ADR 0024, ADR 0025). |
| Préréglage de commission | `commission_preset` | Un taux de commission nommé (par exemple Recrue, Confirmé, Qualifié) que le propriétaire règle et qu'on choisit en un geste sur la fiche d'un membre. |
| Rôle d'équipe | `team_role` (`chatter`, `manager`) | Ce qu'un membre fait dans l'équipe. Distinct du rôle d'accès (`operator`) : un manager voit toute l'équipe et valide rapports et paies jusqu'à « validée ». Daté comme le taux (`member_roles`) : un changement part du 1er ou du 16 d'un mois, aujourd'hui au plus tôt, et la paie prend le rôle du dernier jour de la quinzaine, un seul par quinzaine (Charles, 28/10). |
| Scope d'équipe | `team_scope` (`owner`, `agency`, `self`) | Ce qu'un membre lit des tables de l'équipe, calculé par le serveur (ADR 0024) : tout et seul à poser un taux (`owner`), toute l'équipe (`agency`, manager au statut actif), ses propres lignes (`self`). |
| Moi | `me` | L'espace personnel de chacun dans le CRM, sous un seul nom (ADR 0024) : planning, commissions, dossier prestataire, contrat et mandat selon le rôle. |
| Lien d'invitation | `invitation_link` | Lien à usage unique et de courte durée que le propriétaire partage (par exemple sur WhatsApp) pour qu'un membre choisisse son mot de passe ; même mécanisme pour un mot de passe oublié. |
| Double authentification | `two_factor` | Un code à usage unique d'une application d'authentification, en plus du mot de passe : obligatoire pour le propriétaire et les managers, redemandé pour les gestes d'argent (EQ-15). |
| Voir comme | `view_as` | Le propriétaire ou un manager actif voit l'écran exact d'un chatteur, en lecture seule, avec sa propre session ; ouverture et fermeture au journal (EQ-19). |
| Journal d'audit | `audit_log` | Qui a fait quoi dans le CRM (taux, paies, factures, accès), en ajout seul ; lu par le propriétaire dans Réglages › Journal (EQ-18). Distinct du journal d'événements d'une conversation. |
| Départ | `offboarding` | Le parcours qui fait partir un membre : accès coupé à l'heure dite, planning libéré, passations rendues, relevé final sans minimum de versement, dernière facture (EQ-14). |
| Shift | `shift` | Une plage où un membre chatte sur un compte d'une créatrice, début et fin en UTC. |
| Créneau | `shift_slot`, `ShiftSlot` | Une des plages fixes de la journée de l'agence (4 × 6 h par défaut) sur lesquelles se posent les shifts. Jamais `slot` seul, réservé aux slots KYC (`KycSlot`). |
| En poste | `onShift` | Le membre dont le shift couvre cet instant sur cette créatrice ; il reçoit en premier les passages à l'humain pour vendre. Un chatteur ne traite les conversations d'une créatrice qu'en poste, plus une marge (ADR 0025). |
| Modèle de shift | `shift_template` | Un shift qui revient chaque semaine (jour, heure de début et de fin dans le fuseau de la grille) et fait d'avance les shifts des semaines à venir. Jamais modifié : on le termine et on en crée un autre (EQ-02). |
| Congé | `leave_request` | Des jours entiers où un membre ne chatte pour aucune créatrice. Il les demande dans son fuseau ; le propriétaire ou un manager actif valide une fois ses shifts de la période donnés à d'autres, et aucun shift ne se pose sur lui pendant le congé (ADR 0031). Distinct du statut « en congé » de sa fiche, que le propriétaire règle. |
| Échange de shift | `shift_swap_request` | Un chatteur donne un de ses shifts à un collègue de la même créatrice, ou l'échange contre un shift de ce collègue. Le collègue accepte et les shifts changent de mains aussitôt, sans manager ; le propriétaire ou un manager actif peut l'annuler avant que les shifts commencent (ADR 0031). |
| Pourvoir un shift | `Fill` (`apps/web`) | Donner à un autre membre le shift qu'un modèle n'a pas posé parce que son membre est en congé : « Pourvoir », sur le bandeau ambre « à pourvoir » d'Équipe › Planning, ouvre le panneau d'un shift sur le compte, le jour et les heures du modèle, pour cette fois seulement ; le modèle reste à son membre (ADR 0031). Le bandeau compte « à pourvoir » les modèles qui laissent le compte sans personne (membre en congé ou déjà sur un autre shift) ; un modèle dont le compte a déjà quelqu'un s'y dit « en double ». Dans la grille, une partie à venir d'un créneau sans personne sur un compte se lit aussi « À pourvoir », en ambre pointillé, avec ses heures (à partir de maintenant pour le créneau en cours), et ouvre le panneau d'un nouveau shift sur ce compte et ces heures (recette design EQ-01). |
| Marge d'accès | `accessMarginMinutes` | Le temps avant et après son shift où un chatteur garde ses créatrices dans Nirvana, réglé par le propriétaire (ADR 0025). Pas de marge de fin après un shift arrêté en cours (`stoppedAt`), aucune fenêtre pour un membre qui n'est pas actif. Le routage d'une vente ne la lit jamais : il lit « En poste ». |
| Prise de poste | `shift_check_in` | Le geste « Je prends mon poste » au début d'un shift, qui date son vrai début (EQ-12). |
| Shift non pris | `unstarted_shift` | Un shift sans prise de poste après le délai réglé : alerte importante au manager en poste ou au propriétaire, avec les membres libres (EQ-12). |
| Annonce | `announcement` | Message du propriétaire ou d'un manager actif à toute l'équipe ou aux membres d'une créatrice, affiché dans Aujourd'hui avec « Lu » ; remplace Telegram pour l'équipe. |
| Heures calmes | `quiet_hours` | Plage du fuseau d'un membre où aucune notification ne part, sauf le début de son propre shift. |
| Heures d'activité | `AgentHours`, `creators.agent_hours` | Quand l'agent répond et relance pour une créatrice, à son heure à elle (P3-14) : créneaux de réponse, heures calmes des relances et nuit. Sans réglage : toujours ouvert, relances calmes de 23 h à 9 h, nuit de 22 h à 7 h. |
| Créneau de réponse | `AgentSlot` | Une plage d'un jour où l'agent peut répondre, activable sans être supprimée ; une fin avant le début finit le lendemain, une fin égale au début dure toute la journée. Hors créneau, l'agent garde les messages et y répond à l'ouverture suivante. Distinct du créneau de l'agence (`ShiftSlot`). |
| Heures calmes des relances | `AgentHours.followUpQuiet` | Plage où aucune relance ne part, même dans un créneau de réponse ouvert ; la relance part à la première minute où les deux le permettent. Distinctes des heures calmes d'un membre (`quiet_hours`). |
| Réponse remise à l'ouverture | `reply_deferred`, `conversation.reopen` | Hors de ses créneaux de réponse, l'agent n'écrit rien, même si un chatteur est en poste (il répond dans Reveal) : la conversation garde le message du fan, et l'ouverture suivante répond à tous les fans qui ont écrit, l'attente la plus longue d'abord (P3-14). Distincte de la réponse différée (« attends, je reviens », P3-11). |
| S'entraîner | `practice_session` | Session où une recrue répond à un fan simulé, avec une persona d'exemple, et reçoit un retour du juge sur la méthode ; jamais un vrai fan (EQ-16). |
| Rapport de fin de shift | `shift_report` | Ce que le chatteur déclare avoir généré pendant son shift, saisi dans Nirvana à partir de 30 minutes avant sa fin, validé ou renvoyé avec une note par le propriétaire ou un manager actif, jamais par le membre du shift. Il garde la quinzaine où le shift commence (EQ-03). |
| Relancer un membre | `nudgeText` (`apps/web`) | Sur un shift fini sans rapport, dans Équipe › Rapports : copie un mot prêt pour WhatsApp (« Kofi, ton rapport du mer. 28 oct. · 11 h – 17 h (Léa) n'est pas encore fait… »), à l'heure du membre. Nirvana n'envoie rien, et seul le membre fait son rapport (recette design EQ-15). Rien à voir avec la relance d'un fan (`follow_up`). |
| Correction de rapport | `shift_report.corrects_id` | Ce qu'on ajoute à un rapport validé ou qu'on en retire (un oubli, un remboursement), fait par le membre du shift ou par l'agence, et validé comme un rapport. Un rapport validé ne change jamais. Distincte de l'ajustement, qui corrige un relevé (EQ-03). |
| Incident de shift | `shift_report.incident` | Ce que le membre signale dans son rapport de fin de shift, en quelques mots : un souci de compte, un fan qui inquiète, une coupure. L'agence le lit avec le rapport à valider ; il apparaîtra aussi sur le shift du planning et dans À traiter (EQ-03). |
| Règles de paie d'un compte | `account_pay_rules` | Ce que la paie applique aux montants d'un compte plateforme à partir d'une quinzaine : devise, TVA, commission de la plateforme, source de revenus. En ajout seul, une par compte et par quinzaine ; un changement part de la quinzaine suivante au plus tôt (EQ-03). |
| Source de revenus | `earnings_source` (`declared`, `detected`) | D'où la paie lit les montants d'un compte pour une période : rapports de fin de shift validés ou ventes détectées par le connecteur, jamais les deux. |
| Qui vend | `sellerMode` (`agent`, `team`, `both`) | Réglage d'une créatrice : quand il est temps de vendre, l'agent vend, ou il passe la main au chatteur en poste (motif `sale`), ou les deux. Avec `team` et personne en poste, l'agent continue la relation sans vendre. `team` par défaut au lancement, le temps d'entraîner l'agent ; le propriétaire passe ensuite une créatrice à `both` (les chatteurs vendent quand ils sont en poste, l'agent quand personne ne l'est). |
| Issue de la passation | `releaseOutcome` (`sold`, `refused`, `none`) | Ce que le chatteur indique en rendant la main après un passage pour vendre ; le code en tire la suite (aftercare après un achat, pas de bouderie après un refus traité). |
| Période de paie | `pay_period` | Une quinzaine (1-15, 16-fin du mois) dans le fuseau de l'agence (celui de la grille du planning), nommée par son premier jour. |
| Relevé de commissions | `commission_statement` | Le calcul d'un membre pour une période, avec les règles et le taux de change copiés : `draft`, `validated`, `paid`, à l'écran « À valider », « Validé », « Payé » (jamais « Brouillon », réservé aux réponses de l'IA). Jamais « fiche de paie » : un chatteur est un prestataire. La liste des quinzaines passées de Paie s'appelle « Historique », pas « Relevés ». |
| Palier | `bonus_tier` | Seuil de net hors taxes qui débloque une prime ; le plus haut atteint compte. |
| Prime | `bonus` | Montant ajouté à un relevé : palier, objectif collectif ou prime manuelle avec motif. |
| Malus | `penalty` | Retenue fixe ou en pourcentage avec motif, plafonnée à la part du membre plus ses primes. Sur la facture, une ligne négative par malus (réfaction prévue au contrat) ; quand le plafond joue, une ligne « Plafond des réfactions » rend la différence (EQ-06). |
| Report | `carry_over` | Montant sous le minimum de versement, ou total sous zéro après un ajustement, reporté sur la période suivante ; rien n'est versé (EQ-04). Un montant positif est reporté deux fois de suite au plus : la troisième quinzaine le verse, même sous le minimum, pour que la facture soit payée avant son échéance ; un report négatif n'a pas de limite (ADR 0038). |
| Rang du report | `carry_over.rank` | Combien de fois de suite un montant positif a été reporté, ce report compris : 1, puis 2 au plus ; toujours 1 pour un report négatif, qui remet le compte à zéro. La base refuse un autre rang que celui qui suit le report d'avant (ADR 0038). |
| Paiement d'un relevé | `commission_statement.payment` | Ce que le propriétaire note en marquant payé un relevé validé : le jour du transfert (jamais après aujourd'hui, ni avant le début de la quinzaine), le moyen (WorldRemit seul, qui paie les chatteurs ; une liste fermée), la référence du transfert, facultative et jamais un IBAN (refusé) ni un numéro de compte ou de téléphone, et le montant envoyé, celui à verser (EQ-04, EQ-05). |
| Ajustement | `pay_adjustment` | Correction d'un relevé déjà validé, portée sur la prochaine période ouverte. En faveur du prestataire, une ligne « Régularisation » de la facture, qui cite la période corrigée ; en faveur de l'agence, un avoir sur la facture de la période corrigée (EQ-06, ADR 0023 et 0036). |
| Saisie de paie | `payroll entry` (`GET /v1/payroll/entries`) | Une prime, un malus ou un ajustement que l'agence saisit avec son motif. Une saisie annulée reste lisible, barrée ; un malus se lit dans chaque quinzaine qu'il couvre. Un membre lit les siennes, sans leur auteur (EQ-05). |
| Objectif collectif | `collective_goal` | Le net de toute l'équipe sur une quinzaine, ventes des managers comprises, comparé à une cible ; le palier collectif le plus haut atteint donne une prime à chaque chatteur, ventes ou pas, jamais à un manager (EQ-04). |
| Part d'équipe | `team_share` | La part d'un manager sur le net des autres membres de l'équipe pour une quinzaine, en plus de la commission sur ses propres ventes (EQ-04). |
| Minimum de versement | `minimum_payout` | Sous ce total, un relevé ne verse rien et reporte tout sur la quinzaine suivante ; 15 € tant que le propriétaire n'en fixe pas un autre. Un nouveau part d'une quinzaine qui n'a pas commencé (PAIE-22). Le relevé final n'en a pas (EQ-04), ni celui d'un montant déjà reporté deux fois (ADR 0038). |
| Délai de versement | `payout_delay` | Le nombre de jours ouvrés après la validation où un relevé est versé en général, annoncé par le propriétaire en réglage de paie et dit au chatteur dans Commissions ; jamais en dur, il ne change aucun montant (PAIE-32). |
| Période ouverte | `open period` | Pour un membre, une quinzaine dont le relevé n'est pas encore validé, après la dernière qui l'est et pas avant la première clôture de l'équipe. Une prime ou un malus se saisit sur une période ouverte du membre ; un ajustement va sur sa première, là où il a son prochain relevé à valider ; un rapport tardif, sur la première quinzaine non clôturée de l'équipe (EQ-04, ADR 0032). |
| Clôture de quinzaine | `pay_period_closing` | Ce que la première validation d'un relevé d'une quinzaine fige pour toute l'équipe, dans sa transaction : les rapports comptés, les taux de change du dernier jour de la quinzaine, le net de l'équipe et l'objectif collectif tel qu'atteint. Les quinzaines se clôturent dans l'ordre, une fois finies ; un relevé ne se valide que s'il porte la clôture de sa quinzaine (ADR 0032). |
| Quinzaine bloquée | `pay_period_block` | Une quinzaine que la paie n'a pas pu calculer à son dernier essai : un membre qu'elle paie n'a pas de taux de commission en vigueur, ou une devise n'a pas de taux. Ses relevés sont ceux du dernier calcul réussi, plus à jour ; l'écran le dit en ambre avec ce qui la débloque, et rien ne s'y valide : la validation refait le calcul sous `payroll.close` et refuse avec le même code. Le calcul suivant qui passe la débloque seul (EQ-04, recette du 28/10). |
| Rapport compté | `pay_period_report` | Un rapport validé inscrit par une clôture au registre d'une quinzaine, une seule fois : sa quinzaine d'origine, ou la première non clôturée de l'équipe s'il est validé après la clôture de la sienne (rapport tardif, décidé par le registre et jamais par la date ; ADR 0032). |
| Taux de change | `exchange_rate` | Les euros d'une unité d'une autre devise, en millionièmes, lus chaque jour à une source et gardés. La clôture d'une quinzaine fige, pour chaque devise, le dernier lu le dernier jour de la quinzaine ou avant, jamais celui du jour de la validation ; tous les relevés de la quinzaine le copient (EQ-04, ADR 0032). |
| Dossier prestataire | `contractor_profile` | L'identité légale et fiscale d'un membre pour ses factures : nom complet, adresse, pays, identifiant fiscal, attestation de résidence datée, mandat et contrat acceptés. |
| Autofacturation | `self_billing` | L'agence établit la facture au nom et pour le compte du prestataire (art. 289 I-2 du CGI) ; la facture porte la mention « Autofacturation ». |
| Mandat de facturation | `billing_mandate` | L'accord, accepté par le prestataire avant sa première facture, qui autorise l'autofacturation et fixe le délai de contestation. |
| Contrat de prestation | `service_contract` | Le contrat entre l'agence et le prestataire indépendant. Comme le mandat, son texte est fourni par l'agence et validé par son comptable, versionné, et accepté dans l'application par le prestataire lui-même ; on garde la version, l'instant et l'empreinte SHA-256 du texte accepté (EQ-06). |
| Compteur de factures | `invoice_counter` | Le dernier numéro donné à un prestataire dans l'année, factures et avoirs ensemble. Chaque émission le verrouille et prend le suivant, dans sa transaction : ni trou ni doublon, jamais une séquence Postgres. Le préfixe du prestataire, posé par le propriétaire, est figé par sa première facture (EQ-06). |
| Avoir | `credit_note` | Document numéroté dans la séquence du prestataire qui annule ou réduit une facture émise, en la citant. Une facture émise ne se modifie jamais. Il suit la même acceptation que la facture ; émis à l'initiative de l'agence, il ne change pas l'état de celle qu'il cite (ADR 0036). |
| Solde négatif | `negative_period` | Ce que les lignes de facture d'une quinzaine laissent sous zéro (remboursements au-dessus des ventes) : la quinzaine n'a pas de facture, et ce manque est un avoir sur la dernière facture antérieure qui a assez de reste (ADR 0036). |
| Pièce du prestataire | `contractor_document` (`tax_residence`, `urssaf_vigilance`) | Un document que le régime exige, daté : l'attestation de résidence fiscale tient un an, l'attestation de vigilance six mois, sauf si elle porte sa fin. Manquante ou échue, la facture part avec un avertissement en ambre (EQ-06). |
| Acceptation d'une facture | `invoice acceptance` (`pending`, `accepted`, `tacitly_accepted`, `contested`, `credited`, `contest_refused`) | Le prestataire accepte ou conteste avec un motif avant la fin du délai du mandat ; sans réponse, la facture est acceptée tacitement. Une contestation finit par un avoir ou par un refus motivé. Chaque étape est un événement de la facture, qui ne change jamais (EQ-06). |
| Journal des achats | `purchase journal` | L'export des factures et avoirs d'une période pour le comptable, une ligne par document, sur les comptes qu'il donne : base hors taxe, TVA facturée ou autoliquidée, échéance, paiement (EQ-06). |
| DAS2 | `das2` | La déclaration annuelle des honoraires versés : chaque prestataire payé de plus de 1 200 € dans l'année civile, non-résidents compris (art. 240 du CGI, EQ-06). |
| Régime de facturation | `billing_regime` | Les règles de facture d'un pays de prestataire (mentions, TVA, retenue à la source), réglées par le propriétaire et validées par le comptable. |
| Sauvegarde | `backup_run` | L'export chiffré de la base, chaque nuit, chez un autre hébergeur que la base, gardé 30 jours (ADR 0028). Plus de 26 h sans sauvegarde réussie : avertissement ambre et alerte Telegram. |
| Essai de restauration | `restore_test` | Une sauvegarde de production restaurée sur le PC du propriétaire dans une base jetable, puis notée dans Réglages › Sauvegardes : date, durée, tables qui diffèrent, empreinte SHA-256 de la sauvegarde. La paie réelle attend un essai réussi de moins de 90 jours (ADR 0028, EQ-17). |
| Part de l'agence | `agency_share` | La part des revenus d'une créatrice qui revient à l'agence. |
| Routine | `routine` | Les tâches quotidiennes qu'une créatrice coche dans son application : celles de l'agence comptent pour la série, les siennes non. |
| Série | `streak` | Le nombre de jours d'affilée où la créatrice a coché ses tâches essentielles. |
| Serveur MCP | `mcp` | La porte par laquelle des agents externes (Grok, ChatGPT, Claude…) lisent Nirvana et y freinent l'agent, sur les mêmes commandes que le CRM (ADR 0026). |
| Agent connecté | `mcp_client` | Un agent externe branché sur le serveur MCP. À ne pas confondre avec l'agent de chatting (`agent`), qui écrit aux fans. |
| Accès d'agent | `mcp_grant` | Ce qu'un agent connecté a le droit de faire : au nom de quelle personne, pour quelle créatrice (une au plus), avec quelles capacités, jusqu'à quand. Créé et révoqué dans Réglages › Agents connectés. |
| Jeton d'agent | `mcp_token` | Le secret d'un accès d'agent, montré une seule fois à la création, stocké haché. Jamais dans l'extension, le dépôt ni un fil de discussion. |
| Capacité | `mcp_capability` | Un droit nommé d'un accès d'agent (`read:status`, `read:conversation_content`, `write:brakes`…), liste fermée en code. |

## Noms à ne pas utiliser

- `model` pour désigner une créatrice (confusion avec modèle LLM) → `creator`.
- `user` pour un fan → `fan`. `user` désigne un utilisateur du dashboard.
- `bot` dans le code → `agent` ou le rôle précis.
- `client` pour un fan (vocabulaire Imperium « relation client ») → `fan`.
- « fiche de paie », « salaire », « sanction » pour un chatteur → relevé de commissions, commission, malus. Un chatteur est un prestataire.
