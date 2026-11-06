# Préparer le branchement des clés

But : le jour où une clé arrive, tout ce qui ne dépend pas de la clé a déjà été joué, et la pose suit une liste courte. Aucune clé ne passe jamais par le chat, un fichier du dépôt ou un log : elles se collent dans le CRM (ADR 0016, ADR 0050 § 4).

## État par clé (06/11)

| Clé ou accès | Où elle se pose | Ce qui est prêt | Ce qui manque avant la pose |
|---|---|---|---|
| **xAI (Grok)** : cerveau et voix | Réglages › Modèles IA | coffre chiffré, vérification au collage, 429 = injoignable, refus = rouge, budget 20 €/jour, `pnpm probe`, `pnpm evals` (job nightly-evals) | mode simulé pour jouer l'agent à l'écran avant la clé ; chemins d'API à reconfirmer à la pose |
| **Google (Gemini)** : vision | Réglages › Modèles IA | vérification, `pnpm probe:vision`, port `FetchMedia` | médias factices et descriptions attendues (SC-04) |
| **Mistral** : relais d'écriture et juge des évals | Réglages › Modèles IA | ligne et vérificateur | rien de bloquant |
| **ElevenLabs** : vocaux clonés (copilote seulement) | Réglages › Modèles IA | vérification | accord formel de Messa pour la voix clonée ; envoi d'un vocal sur Reveal inconnu (capture, E7) |
| **Reveal, API CRM** : ventes, chiffres, modèles, équipe | Réglages › Ventes | adaptateur, curseur, webhook signé, vérification, import, veille de la liste, FakeReveal CRM en test | noms de colonnes du vrai export CSV (jamais vu) ; ouverture des webhooks par le support Reveal ; question des « clés de bots » au support |
| **Reveal, session du membre « bot »** : messagerie, envois, scripts, notes, coffre | (à concevoir) extension | port `PlatformConnector`, `FakeConnector`, suite de contrat, FakeReveal provisoire, route `POST /v1/connector/sessions`, coffre des sessions | **la capture HAR** ([capture-reveal.md](capture-reveal.md)), puis `RevealApiConnector`, puis la transmission de la session par l'extension |
| **Telegram** : alertes | Réglages › Telegram | bots, groupes, routage, aperçus, file de sortie | création du bot par Charles (BotFather) ; ton des messages |
| **Stockage objet (S3)** : médias, avatars, dépôts | variables du serveur | code et tests (16 tests d'intégration ne tournent pas sans stockage) | un stockage compatible S3 pour la pile de dev et de recette (aucun dans `docker-compose.yml` aujourd'hui), pour que la recette joue les dépôts et les avatars |
| **Notifications push (VAPID)** | variables du serveur | code | paire de clés générée pour la pile de recette |
| **Sauvegardes** | variables du serveur | job, test de restauration | destinataire age et base de sauvegarde |

## Le mode simulé (à construire avant la recette de l'agent)

Sans lui, la boucle « un fan écrit, l'agent répond » ne se voit sur aucun écran. Proposition (fiche `docs/sessions/tasks/PROPOSED-recette-sandbox.md`, ADR à écrire car elle touche plusieurs modules) :

1. **Interrupteur de pile** `IMPERA_SANDBOX=1`, refusé au démarrage si `NODE_ENV=production`, affiché en bandeau ambre dans le CRM (« Bac à sable : rien n'est réel »).
2. **Reveal simulé** : la pile lance FakeReveal (`apps/api/src/__tests__/fake-reveal/server.ts`, prévu pour le développement local) et branche un connecteur sur lui ; l'adaptateur CRM prend une adresse de base de recette (il accepte déjà `baseUrl`). Les routes de contrôle `/__` de FakeReveal servent à faire écrire un fan, acheter, rembourser, avancer l'horloge.
3. **IA simulée** : un fournisseur à réponses scriptées pour les rôles sens, cerveau, voix et juge, avec un coût fictif pour tester le budget, et des réponses piégées (aveu d'IA, lien de paiement) pour tester les gardes.
4. **Jeu de données** chargé par une commande, idempotent, inventé.
5. Garde-fous : aucune clé réelle lue en bac à sable, aucune adresse externe appelée (test qui le vérifie), rien du bac à sable ne peut tourner en production.

## Le jour J d'une clé (ordre)

1. Charles crée la clé chez le fournisseur et la colle dans le CRM (jamais ailleurs). Le CRM la vérifie.
2. `pnpm ops:check-keys` sur le serveur : la clé est lisible.
3. **xAI** : `pnpm probe` (persona fictive), puis `pnpm evals`, résultats lus avant toute conversation ; Playground ; Copilote sur le fan « test » seulement ; jamais Automatique avant des évals vertes et l'accord de Charles.
4. **Google** : `pnpm probe:vision` sur des médias factices, puis un média envoyé par le fan « test ».
5. **Reveal CRM** : connecter, relier le modèle de Messa et le membre « bot » à l'agent, lire une page de ventes, lancer la vérification avec l'export du dashboard sur la dernière quinzaine terminée ; ajuster les noms de colonnes de l'export ; inscrire le webhook quand le support l'a ouvert.
6. **Session Reveal** : seulement après la capture, le connecteur écrit et sa suite de contrat verte.
7. Pour chaque clé : retirer la clé, vérifier que l'écran le dit et que rien ne casse ; remettre.

## Ce qui peut bloquer le jour J (à vérifier avant)

- Une clé refusée pendant que le worker garde l'ancienne : corrigé le 17/10 (refus vérifié auprès du fournisseur), à rejouer.
- Le plafond du jour de l'agent et celui des évals (3 €) sont séparés : vérifier qu'un passage d'évals ne mange pas le budget de l'agent.
- Les limites de Reveal (statistiques 10 appels par minute, 500 par jour pour l'agence) : la vérification à la main est limitée à 3 par minute ; vérifier que la vérification automatique et la lecture n'épuisent pas le quota.
- Le fuseau de Reveal (`Europe/Paris`) contre celui de l'agence : une vente à 23h30 le dernier jour d'une quinzaine.
- Le membre « bot » n'est pas encore relié à l'agent : ses ventes iraient à « chatteur non relié » ; la vérification le note (`bot_not_linked_to_agent`).
