# Desirely : analyse de l'outil concurrent

Sources, lues en entier le 27/10/2026 : le centre d'aide public de Desirely en français (58 articles, 9 collections) et son playbook « Construire et Scaler Agence OFM 2026 » (88 pages, fourni par Charles, hors dépôt). Desirely est un agent de chatting IA pour OnlyFans et Reveal, comme le nôtre. Observations reformulées, aucune phrase recopiée, aucun code, aucune donnée de compte (ADR 0010). Ce document informe ; l'ADR 0030 et les fiches de tâche décident.

## Médias

- Une médiathèque par créatrice, remplie seulement par synchronisation depuis la plateforme (choix des dossiers, sans doublon à la relance), jamais par téléversement. Un média logique porte une liaison par plateforme. Dossiers, filtres par dossier, plateforme et type.
- Descriptions générées à la demande, payantes au média, dans la langue de la créatrice, modifiables ; une vidéo longue est décrite à partir de quelques images. Les médias envoyés par les fans sont décrits d'office.
- Flou des médias à l'écran réglable (non, oui, oui sauf au survol).
- **Nirvana** : `media_assets`, `media_descriptions` et `media_sends` existent ; aucune liaison à la plateforme, aucune validation humaine, pas d'écran. Repris par l'ADR 0030 et `PROPOSED-media-library.md` ; nous décrivons par un modèle de vision au vocabulaire structuré, ce qu'ils ne font pas.

## Scripts et ventes

- Scripts saisis dans l'outil : message, teaser avant le média, message après, médias, prix, prix réduit, nombre de messages avant l'étape suivante (réglable, conseil : peu). Chaque étape a une description de la scène, obligatoire, qui prime sur le profil quand ils divergent.
- Choix du script : le plus récent actif, jamais déjà joué dans la conversation, dont les médias existent sur la plateforme et dont aucun n'a été vu par le fan (gratuit vu à l'envoi, payant vu au déblocage).
- Un seul PPV verrouillé à la fois ; un achat compte seulement s'il est confirmé par la plateforme ; un repos d'une heure entre scripts ; une vente qui s'enlise trois heures revient au relationnel.
- Alerte « plus de script » qui arrête la conversation ; quatre à cinq scripts conseillés par créatrice.
- Remise progressive après quelques messages sans achat.
- **Nirvana** : `offerDecision` (un script par délai, jamais après un manque d'argent avoué), P6-01 (catalogue lu dans Reveal, qui fait foi, ADR 0018), P6-02 (après une offre). Repris dans `PROPOSED-sale-steps-rules.md` : rythme d'étape, un seul PPV, achat confirmé, vente qui s'enlise, description de scène, choix du script, catalogue court. **Non repris** : prix réduit et remise progressive (méthode : on ne négocie jamais, garde `discount`), arrêt de la conversation faute de script (l'agent garde la relation), scripts écrits dans Nirvana comme source (atelier de scripts en second temps, `PROPOSED-script-studio.md`).

## Alertes

- Alertes système (plus de script, vente, services demandés, fonds du compte) et alertes à soi : une phrase évaluée sur chaque message du fan, avec prudence, des mots-clés sans IA, et une option qui arrête la conversation. Activation et sourdine par créatrice, diffusion choisie alerte par alerte (message direct ou canal Telegram).
- Page Notifications : alerte, créatrice, fan, raison, date, lien vers la conversation, filtres lues / non lues, type, créatrice, « marquer comme vu ».
- **Nirvana** : mots-clés d'alerte dans la persona, risques du Brief, Telegram par sujet (ADR 0020). Manquent les alertes personnalisées, la demande de service, l'alerte sur `asks_if_bot` et un historique des alertes, sous-vue du Suivi ; ce qui demande une main reste dans « À traiter » : `P4-01-custom-alerts.md`.

## Horaires

- Par créatrice : fuseau, 24/7 par défaut ou créneaux jour par jour activables ; hors créneau, ni réponse ni relance, reprise des messages en attente. Raison : une créatrice qui répond toujours à 4 h éveille les soupçons, et des plages restent aux humains.
- **Nirvana** : heures calmes des relances et bascule Jour / Nuit en dur, aucune heure d'activité de l'agent. `P3-14-agent-hours.md`, avec un défaut qui n'est pas 24/7.

## Relances

- Trois types : après la bienvenue sans réponse, après un silence, à la connexion du fan (Reveal seulement). Jusqu'à trois par type, aperçu de l'heure prévue, jamais la même approche, choix d'un bon moment, registre respecté.
- **Nirvana** : P3-10 (relance après silence, en brouillon, heures calmes). Le reste : `PROPOSED-follow-ups-extended.md`, avec la relance sur événement (anniversaire, « à demain ») tirée du playbook.

## Voix

- Défauts documentés comme à corriger : didascalies (« *sourit* »), répétitions, annonce d'un média qui ne part pas ; délai de réponse d'au moins 30 secondes, souvent une à trois minutes, bulles décalées.
- Le playbook ajoute : ne jamais écrire les mots que la plateforme repère autour d'une rencontre, même pour refuser ; jamais de fausse urgence (maladie, accident) pour vendre ; rebondir plutôt qu'enchaîner les questions fermées.
- **Nirvana** : seize gardes, dont `ai_disclosure`, `meeting_promise`, `discount`, `guilt_trip` ; délai de réponse de 45 s par défaut. Manquent les six gardes de `P3-13-voice-guards.md`.

## Persona

- Profil en sections (identité, apparence, mode de vie, goûts, personnalité, limites, style d'écriture, exemples de réponses) avec un pourcentage de complétion. Notes du fan : liste « à collecter » réglable, recopiée dans la note de la plateforme ; panneau Mémoire éditable.
- **Nirvana** : `PersonaSchema` riche mais un `additional_info` libre ; KYC par `strategies.kyc.targets` ; notes recopiées dans la note Reveal (ADR 0018). `P5-01-persona-blocks.md`.

## Conversations

- Liste des conversations avec désir (neutre, joueur, acheteur), scripts « x / y », état de l'IA, fiche du fan, actions en masse ; phases accroche, montée, vente, après-vente ; prénom et âge obtenus avant l'érotique.
- **Nirvana** : Suivi (file « À traiter », lecteur, décisions), curseur de sexualisation qui exige un âge déclaré par le fan et le KYC minimum (P3-09). Manquent la note de désir, que Charles retient en premier (27/10 : plus elle est haute, plus on peut vendre), calculée par le code et qui ne fait que retenir les offres (`P3-12-desire-score.md`), puis phase, scripts x / y, actions en masse, mémoire corrigible (`PROPOSED-tracking-sales.md`).

## Transactions

- Page des ventes : date, fan, montant, script, étape, vendue par l'IA ou non. Calcul du net Reveal : TVA déduite, puis la part de la créatrice sur le hors taxe.
- **Nirvana** : `sales` prévue par P6-01, aucune page. `PROPOSED-tracking-sales.md`.

## Playbook

- **Hybride** : l'IA prend le volume, l'humain garde la valeur ; l'IA passe la main quand un fan devient chaud ou stratégique. Inbox par priorité (gros acheteurs en ligne, nouveaux, réguliers, le reste), quelques conversations épinglées, un tour toutes les 20 à 30 minutes, checklists de shift. Repris dans `PROPOSED-hybrid-routing-by-value.md` (ADR 0024 et 0025 : le chatteur chatte dans Reveal).
- **Découverte** en cinq à sept échanges qui finissent sur une ouverture ; un média gratuit comme pont vers la sexualisation ; après un PPV, un renforcement court puis une relance si le fan n'a pas ouvert. Conforme à la méthode ; à calibrer dans les évals.
- **Négociation** : culpabilisation, puis bonus, puis remise. **Non repris** : contraire à la méthode (on ne négocie jamais, garde `guilt_trip`). Le « bonus à la place d'une remise » reste une question pour Charles.
- **À refuser** : contourner la vérification d'âge par VPN ou proxy, vendre hors plateforme, faux profils sur les applis de rencontre, messages de masse tant que la décision n'est pas prise. Acquisition (Instagram, X, Telegram) hors périmètre.

## Interface

- Guide « Premiers pas » en étapes cochées, palette ⌘K, raccourcis « g » puis une lettre, flou des médias. `PROPOSED-first-steps.md`.

## Organisation et prix (pour mémoire)

Organisation à membres et permissions, serveur MCP, 33 langues, tarif à la commission dégressive sur les ventes de l'IA. Rien à reprendre : Nirvana a ses rôles (ADR 0023), son serveur MCP (ADR 0026), et n'est pas vendu.

## Ce qu'on fait mieux

- Les règles de vente vivent dans le code (politique, gardes), pas dans un réglage de prompt.
- Copilote d'abord, Automatique seulement après preuve (ADR 0019, 0022).
- Médias compris par un modèle de vision au vocabulaire structuré, mémoire du fan par catégories.
- Aucune négociation, aucune remise, aucune culpabilisation.
