# Bac à sable de recette (ADR 0075)

Le bac à sable fait tourner Impera **sur ta machine seulement**, avec ses vrais adaptateurs et ses vrais vérificateurs de clés, mais branchés sur un **faux monde local** qui imite l'API CRM de Reveal et les services d'IA (xAI, Google, Mistral, ElevenLabs). Rien ne sort de la machine : tout appel vers une autre adresse échoue comme une coupure réseau.

Il sert à jouer le branchement des clés et les connexions « dans les mêmes conditions qu'en réel » : même écran, même code, même chiffrement, mêmes états (valide, refusée, sans crédit, limitée, en panne, révoquée) — seule l'adresse change.

## Ce qui est simulé (phase 1)

| Service | Simulé | Pas encore (phase 2) |
| --- | --- | --- |
| xAI, Google, Mistral, ElevenLabs | Vérification de la clé collée dans Réglages, avec tous les états | Génération des réponses de l'agent (le faux monde répond 503 : brouillon retenu `llm_unavailable`) |
| Reveal (API CRM) | Vérification de la clé, flux des ventes, remboursements, révocation, limitation, import des modèles | Messagerie (connecteur sur session capturée, attend la capture HAR) |
| Telegram, push, S3 distant, taux de change | — | Bloqués par la garde : ils échouent comme hors ligne |

## Lancer

Prérequis : `docker compose up -d` et `pnpm db:migrate` faits.

1. Dans `.env` : `IMPERA_SANDBOX=1` (laisser `IMPERA_SANDBOX_URL` vide pour `http://127.0.0.1:4010`).
2. Terminal 1 : `pnpm sandbox:world` → « le faux monde écoute sur http://127.0.0.1:4010 ».
3. Terminal 2 : `pnpm dev`. Le journal de l'API commence par « BAC À SABLE (ADR 0075) : rien n'est réel ».
4. Le CRM affiche en bas la pastille « Bac à sable · rien n'est réel » sur tous les écrans.

La configuration refuse de démarrer si `NODE_ENV=production`, ou si `AUTH_BASE_URL`, `WEB_ORIGIN`, `IMPERA_SANDBOX_URL` ou `S3_ENDPOINT` ne sont pas des adresses de la machine. En bac à sable, les clés du `.env` (`LLM_*`, `SPEECH_*`) ne sont jamais lues : seules comptent celles collées dans le CRM.

## Les fausses clés

Une clé inventée suffit, à condition d'avoir la forme du fournisseur : pour une IA, 20 caractères au moins et le préfixe du service s'il en a un (`xai-`, `AIza`, `sk_`) ; pour Reveal, le préfixe `rvl_`. Le mot qu'elle contient choisit la réponse :

| La clé contient | Réponse du faux monde | Ce que l'écran doit montrer |
| --- | --- | --- |
| `refus` | 401 | Clé refusée |
| `credit` | 402 ou 403 selon le service (crédit épuisé) | Plus de crédit |
| `limite` | 429 | Limitée, réessai plus tard |
| `panne` | 503 | Service indisponible |
| autre chose | 200 | Clé valide |

Exemples (aussi listés sur `http://127.0.0.1:4010/__`) : `xai-recette-ok-0000000001`, `xai-recette-refus-000000001`, `rvl_recette_ok_0001`.

## Piloter le faux monde

`GET /__` montre l'état (modes, ventes, appels, exemples de clés). Les routes de contrôle se jouent avec `curl -X POST -H 'content-type: application/json'` :

| Route | Corps | Effet |
| --- | --- | --- |
| `/__/services/xai` (ou `google`, `mistral`, `elevenlabs`) | `{"mode":"down"}` | Force un état pour toutes les clés : `ok`, `refused`, `no_credit`, `rate_limited`, `down` ; `auto` revient à la règle des mots |
| `/__/reveal/sell` | `{"euros":25}` | Une vente inventée attribuée au chatteur `bot_test_01` (TTC, HT, part agence 30 %, part modèle 50 %) ; aussi `type` (`ppv`, `tip`, `paid_message`, `subscription`) |
| `/__/reveal/refund` | `{"saleId":"…"}` | Rembourse une vente |
| `/__/reveal/key` | `{"state":"revoked"}` ou `{"state":"restored"}` | Révoque ou rétablit la clé Reveal |
| `/__/reveal/rate-limit` | `{}` | La prochaine lecture reçoit un 429 |
| `/__/reveal/models` | `{"preset":"import"}` | Plusieurs modèles à importer (`default` pour revenir) |

Le faux monde vit en mémoire : un redémarrage remet tout à zéro.

## Pour le lot Agent

Phase 1 permet de jouer AGT sur les clés (Réglages › Services d'IA) et l'état « brouillon retenu, IA indisponible ». La génération simulée (phase 2) est la prochaine marche ; tant qu'elle manque, les constats sur le contenu des réponses restent marqués « avec clé ».
