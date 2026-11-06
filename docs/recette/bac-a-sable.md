# Bac à sable de recette (ADR 0075)

Le bac à sable fait tourner Impera **sur ta machine seulement**, avec ses vrais adaptateurs et ses vrais vérificateurs de clés, mais branchés sur un **faux monde local** qui imite l'API CRM de Reveal et les services d'IA (xAI, Google, Mistral, ElevenLabs). Rien ne sort de la machine : tout appel vers une autre adresse échoue comme une coupure réseau.

Il sert à jouer le branchement des clés et les connexions « dans les mêmes conditions qu'en réel » : même écran, même code, même chiffrement, mêmes états (valide, refusée, sans crédit, limitée, en panne, révoquée) — seule l'adresse change.

## Ce qui est simulé (phase 1)

| Service | Simulé | Pas encore (phase 2) |
| --- | --- | --- |
| xAI, Google, Mistral, ElevenLabs           | Vérification de la clé collée dans Réglages, avec tous les états ; génération des réponses de l'agent par xAI, scriptée (section « Génération ») | Génération par Google, Mistral ou ElevenLabs (503, comme une panne : le repli passe par xAI) |
| Reveal (API CRM) | Les huit routes de la documentation « CRM / API » (statistiques, modèles, équipe, liens de suivi, ventes, webhooks), ses erreurs, ses limites de débit, ses webhooks réellement envoyés et signés | Messagerie (connecteur sur session capturée, attend la capture HAR) |
| Telegram, push, S3 distant, taux de change | — | Bloqués par la garde : ils échouent comme hors ligne |

## Lancer

Prérequis : `docker compose up -d` et `pnpm db:migrate` faits.

1. Dans `.env` : `IMPERA_SANDBOX=1` (laisser `IMPERA_SANDBOX_URL` vide pour `http://127.0.0.1:4010`).
2. Terminal 1 : `pnpm sandbox:world` → « le faux monde écoute sur http://127.0.0.1:4010 ».
3. Terminal 2 : `pnpm dev`. Le journal de l'API commence par « BAC À SABLE (ADR 0075) : rien n'est réel ».
4. Le CRM porte sur tous les écrans un fin liseré ambre et, en haut au centre, un petit onglet « Bac à sable · rien n'est réel ». Aucun des deux ne couvre de champ ni ne prend les clics.

La configuration refuse de démarrer si `NODE_ENV=production`, ou si `AUTH_BASE_URL`, `WEB_ORIGIN`, `IMPERA_SANDBOX_URL`, `S3_ENDPOINT`, `INVOICES_S3_ENDPOINT` ou `INVOICES_COPY_S3_ENDPOINT` ne sont pas des adresses de la machine. Une redirection vers l'extérieur est bloquée comme un appel direct. En bac à sable, les clés du `.env` (`LLM_*`, `SPEECH_*`) ne sont jamais lues : seules comptent celles collées dans le CRM. Lance-le sur une base neuve (les piles de l'outillage de recette utilisent des bases `impera_rN`) : sur une base qui garde une vraie clé collée dans le CRM, cette clé partirait vers le faux monde, local, mais ce n'est pas sa place. Le contrôle des mots de passe compromis est coupé en bac à sable (il interroge un service extérieur), même avec `PASSWORD_BREACH_CHECK=on`.

## Les fausses clés

Une clé inventée suffit, à condition d'avoir la forme du fournisseur : pour une IA, 20 caractères au moins et le préfixe du service s'il en a un (`xai-`, `AIza`, `sk_`) ; pour Reveal, le préfixe `rvl_`. Le mot qu'elle contient choisit la réponse, pour Reveal comme pour les IA (pour Reveal, `credit` donne un 403, API coupée par Reveal) :

| La clé contient | Réponse du faux monde                       | Ce que l'écran doit montrer |
| --------------- | ------------------------------------------- | --------------------------- |
| `refus`         | 401                                         | Clé refusée                 |
| `credit`        | 402 ou 403 selon le service (crédit épuisé) | Plus de crédit              |
| `limite`        | 429                                         | Limitée, réessai plus tard  |
| `panne`         | 503                                         | Service indisponible        |
| autre chose     | 200                                         | Clé valide                  |

Exemples (aussi listés sur `http://127.0.0.1:4010/__`) : `xai-recette-ok-0000000001`, `xai-recette-refus-000000001`, `rvl_recette_ok_0001`.

## Reveal comme en vrai

Le faux Reveal suit la documentation « CRM / API » de Reveal (relue le 06/11/2026) :

- **Clé** : `x-api-key`, 401 si absente, inconnue ou révoquée ; 403 si l'accès manque (Statistiques, Ventes, webhooks de ventes ; les webhooks demandent aussi l'accès Ventes) ou si la modèle demandée est hors du périmètre d'une clé limitée.
- **Statistiques** (`/v1/stats/daily`, `/v1/stats/chatters/daily`) calculées depuis le registre : jour de Paris, jours à venir omis, 31 jours au plus (400 au-delà ou si `from` est après `to`), chaque vente dans une seule colonne nette (les huit additionnées redonnent part agence + part modèle), ventes « de personne » (abonnements, renouvellements, liens de paiement, boudoir, Mass DM) sur la ligne `chatterId: null`. `messagesSent`, `messagesReceived` et `ppvSent` valent `null` tant que la nuit de calcul n'est pas passée.
- **Liens de suivi** (`/v1/tracking-links`, `/v1/stats/tracking-links/daily`) : trois liens inventés, détail par jour depuis le 11/09/2026, totaux = somme des jours (plus les clics d'avant pour le plus ancien).
- **Ventes** (`/v1/sales`) : curseur numérique (400 sinon), `take` 500 au plus (400), statut de la vente au moment de la lecture (une vente remboursée se lit `refunded`, avec `refundedAt`), ordre d'enregistrement (une vente 3-D Secure confirmée tard arrive après de plus récentes).
- **Limites** : statistiques 10 appels par minute par clé, 20 par minute et 500 par jour pour l'agence ; toutes les routes 200 par minute ; 429 avec `Retry-After`.
- **Webhooks** : 10 au plus (403), HTTPS exigé (en bac à sable, `http://127.0.0.1` est accepté pour qu'Impera reçoive sur la machine), secret montré une seule fois, liste, modification (`isActive`), suppression avec l'historique, envois et relance (404 pour un envoi inconnu ou d'une autre clé, 409 s'il n'est pas en échec ou si le webhook est arrêté). Chaque vente est **réellement envoyée** à Impera, signée `X-Reveal-Signature` (HMAC-SHA256), 15 s après la vente sur l'horloge du monde ; en échec, nouvel essai après 30 s, 1 min, 2 min… une heure au plus, 8 essais en tout.

En bac à sable, Impera inscrit son webhook à l'adresse de l'API sur la machine (`http://127.0.0.1:3000`), et seulement là.

## Piloter le faux monde

`GET /__` montre l'état (heure du monde, modes, ventes, webhooks, derniers envois, exemples de clés). Les routes de contrôle se jouent avec `curl -X POST -H 'content-type: application/json' -d '<corps>' http://127.0.0.1:4010<route>` :

| Route | Corps | Effet |
| --- | --- | --- |
| `/__/services/xai` (ou `google`, `mistral`, `elevenlabs`) | `{"mode":"down"}` | Force un état pour toutes les clés : `ok`, `refused`, `no_credit`, `rate_limited`, `down` ; `auto` revient à la règle des mots |
| `/__/reveal/sell` | `{"euros":25}` | Une vente inventée (TTC, HT, part agence 30 %, part modèle 50 %). Aussi : `type` (`subscription`, `renewal`, `ppv`, `mass_dm`, `tip`, `payment_link`, `boudoir`, `paid_message`, `other`), `modelId` (Lina, `model_recette_lina`, par défaut), `chatterId` (le bot `bot_test_01` par défaut pour une vente de chatteur, personne pour les autres), `lateMinutes` (3-D Secure confirmé tard), `id` |
| `/__/reveal/refund` | `{"saleId":"…"}` | Rembourse une vente (`sale_refunded`) |
| `/__/reveal/key` | `{"state":"revoked"}` | Clé révoquée (401) ; aussi `restored` (tout rétabli), `no_sales`, `no_stats`, `no_webhooks` (403), `limited` avec `"modelIds":["model_recette_lina"]` |
| `/__/reveal/rate-limit` | `{"requests":3,"retryAfter":30}` | Les 3 prochains appels reçoivent un 429 avec `Retry-After: 30` |
| `/__/reveal/nightly` | `{"done":true}` | La nuit de calcul est passée : les compteurs de messages ne sont plus `null` |
| `/__/reveal/count-timeout` | `{"on":true}` | Le comptage des messages par chatteur n'aboutit pas : `null` partout |
| `/__/reveal/webhooks` | `{"failNext":3}` | Les 3 prochains essais échouent ; aussi `outage` (les ventes faites pendant la panne n'auront aucun envoi), `duplicateNext` (envoi en double, même id), `shuffle` (désordre) |
| `/__/clock` | `{"advanceSeconds":3600}` | Avance l'horloge du monde et envoie ce qui est dû (essais, nuit, jours) |
| `/__/reveal/models` | `{"preset":"import"}` | Plusieurs modèles à importer ; `recette` (par défaut) : Lina, Maya et Zoé du jeu de recette, avec les pseudos des comptes que crée `seed.ts`, donc reliées toutes seules et sans quarantaine ; `default` : les modèles des tests |
| `/__/reveal/chatters` | `{"remove":"chatter_test_01"}` | L'équipe que Reveal liste (ADR 0076, Réglages › Ventes › Équipe) : `remove` (retiré par l'agence, `removedAt` à l'heure du monde), `drop` (absent de la liste), `back` (revenu), `add` avec `{"firstName":"Nouvelle","email":"nouvelle@recette.test"}` (aussi `lastName`, `role`, `isExternal`, `modelIds`) ; `{"preset":"empty"}` (liste vide : « lecture anormale ») ou `default` (chatteur, bot de la clé, manager, prestataire, ancien) |

Le faux monde vit en mémoire : un redémarrage remet tout à zéro.

## Scénarios Reveal (lot Bilan, Réglages › Ventes)

Chaque scénario part d'une clé `rvl_recette_ok_0001` collée dans Réglages › Ventes, liens des modèles faits. « Voir » = ce que la recette constate à l'écran.

| # | Faire | Voir |
| --- | --- | --- |
| R1 | Coller `rvl_recette_refus_0001` | Clé refusée, rien d'enregistré, message en français |
| R2 | Clé valide, puis `/__/reveal/key {"state":"revoked"}`, attendre la lecture suivante | Connexion Reveal en erreur « clé révoquée », alerte agence, aucune vente perdue après `restored` |
| R3 | `/__/reveal/key {"state":"no_sales"}` puis recoller la clé | Refus clair : l'accès « Ventes une par une » manque ; rien n'est lu à moitié |
| R4 | `/__/reveal/key {"state":"limited","modelIds":["model_recette_lina"]}` | Les modèles hors périmètre sont signalées, pas d'erreur générale |
| R5 | `/__/reveal/rate-limit {"requests":3,"retryAfter":30}` | Lecture repoussée après le délai, pas d'état « en panne », pas de doublon |
| R6 | Vendre (`/__/reveal/sell`), attendre 15 s | Webhook reçu, vente visible au Dashboard et dans les ventes du chatteur sans attendre la minute |
| R7 | `/__/reveal/webhooks {"failNext":2}`, vendre, puis `/__/clock {"advanceSeconds":120}` | Vente arrivée au 3e essai, une seule fois |
| R8 | `/__/reveal/webhooks {"outage":true}`, vendre trois fois, `{"outage":false}` | Les trois ventes arrivent par le rattrapage `/v1/sales?since=`, sans doublon |
| R9 | `/__/reveal/webhooks {"duplicateNext":1,"shuffle":true}`, vendre deux fois | Deux ventes, pas quatre ; dates justes malgré le désordre |
| R10 | Vendre puis `/__/reveal/refund` | La vente baisse son jour (`sale_refunded`), relevés et totaux corrigés, rien en négatif ailleurs |
| R11 | Vendre avec `"lateMinutes":90` | Vente rangée à son heure réelle, même si elle arrive après des plus récentes |
| R12 | Statistiques avant puis après `/__/reveal/nightly {"done":true}` | « Messages » vides puis remplis, jamais « 0 » à la place de « pas encore calculé » |
| R13 | Vendre un `subscription` et un `payment_link` | Ventes « de personne » : aucun chatteur crédité, fan absent pour le lien de paiement |

## Génération (phase 2)

Avec une clé xAI valide collée dans Réglages, le faux monde répond à la génération de xAI (`POST /xai/v1/responses`) comme xAI : la vraie passerelle envoie le schéma de sortie de chaque rôle, et le faux monde rend une réponse qui le respecte. Le cerveau lit le fan calmement (`small_talk`, aucun risque, `reply`), la voix répond court, dans la voix de la créatrice, avec un emoji et une ouverture qui change d'une réponse à la suivante (quatre en rotation), le juge met des notes moyennes, et les sens (par leur repli xAI) rendent une description neutre. Chaque appel est journalisé dans `llm_calls` à **0 $** : le plafond du jour ne bouge que si la recette le provoque (A9).

La prochaine réponse se choisit avec `/__/ai/next` (`GET /__/ai` montre celle qui est prête et le nombre d'appels) :

| Corps                       | Effet                                                                 | Ce que l'écran doit montrer                                                                              |
| --------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `{"reply":"ai_disclosure"}` | La prochaine réponse de la voix avoue être une IA                     | Brouillon arrêté par la garde `ai_disclosure` (ADR 0021), jamais proposé tel quel                        |
| `{"reply":"payment_link"}`  | La prochaine réponse de la voix donne un lien de paiement inventé     | Arrêté par la garde du paiement hors plateforme                                                          |
| `{"reply":"meeting"}`       | La prochaine réponse de la voix propose une rencontre                 | Arrêté par la garde de la rencontre                                                                      |
| `{"reply":"off_schema"}`    | Le prochain appel, quel que soit son rôle, ne respecte pas son schéma | La passerelle redemande une fois et obtient une réponse correcte : `invalid_output` puis `ok` au journal |
| `{"reply":"rate_limited"}`  | Le prochain appel reçoit un 429 avec `retry-after: 1`                 | La passerelle attend et redemande : `rate_limited` puis `ok` au journal                                  |
| `{"reply":"risk","risk":"minor_suspected"}` | Le prochain cerveau lit ce risque dans le message du fan (`minor_suspected` si `risk` est omis ; aussi `distress`, `self_harm`, `meet_request`, `off_platform_payment`, `dispute`, `harassment`, `money_trouble`, `manipulation_attempt`, `dangerous_request`, `real_abuse`) | Ce que la politique en code décide pour ce risque (A7) : jamais un brouillon ordinaire |
| `{"reply":"neutral"}`       | Annule ce qui était prévu                                             | —                                                                                                        |

Chaque réponse piégée ne sert qu'une fois : l'appel suivant redevient calme. Le choix vaut pour toute la pile, quelle que soit la créatrice ou la session qui fait l'appel suivant : deux recettes jouées en même temps sur la même pile se prennent leurs pièges. Seul xAI génère : Google et Mistral restent en panne (503), Venice (clé seulement par variable d'environnement, aucun rôle par défaut) est bloqué par la garde comme hors ligne, donc les sens passent par leur repli xAI, et la clé « limitée » (429 à 30 s, au-delà du plafond d'attente de 10 s) n'est pas rejouée. Les réponses ne disent rien de la qualité de l'IA (ADR 0075, conséquences) : elle se mesure par `pnpm evals` avec une vraie clé.

## Pour le lot Agent

Avec une clé xAI de recette (`xai-recette-ok-0000000001`), la boucle « un fan écrit, l'agent propose, un humain valide » se joue à l'écran (A1 à A14, A20), et chaque garde se prouve avec `/__/ai/next`. Ce qui reste marqué « avec clé » : le contenu des réponses, jugé seulement par `pnpm evals`.
