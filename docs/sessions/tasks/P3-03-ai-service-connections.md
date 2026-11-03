# P3-03 Connecter Grok, Gemini et ElevenLabs depuis le dashboard
Statut : in_progress
Phase : 3
Dépend de : P0-03 (base, chiffrement), P0-04 (serveur, SSE), P0-07a (Better Auth, rôles), P3-01 (passerelle), D-01 (design system dans `apps/web`)
Branche : task/p3-03-ai-service-connections

## Objectif
Permettre à Charles de connecter, vérifier, remplacer et déconnecter les clés de xAI, Google (Gemini) et ElevenLabs depuis Réglages › Modèles IA, dans un parcours guidé où il sait toujours quoi faire, avec des clés chiffrées côté serveur (ADR 0016).

## Contexte à lire
`docs/adr/0016-provider-keys-entered-in-dashboard.md`, `docs/adr/0009-llm-gateway-three-roles.md`, `docs/architecture/ai-engine.md`, `docs/conventions/security.md`, `docs/runbooks/rotate-secrets.md`, `docs/playbooks/add-an-llm-provider.md`, `docs/design/README.md`, `packages/llm/src/config.ts` et `health.ts`, `docs/sessions/tasks/PROPOSED-voice-notes.md` (interface `speech`). Demande de Charles : fil « Connecter Grok, Gemini, ElevenLabs », 17/10 de 18h29 à 18h49. Maquette de référence (données fictives) : https://claude.ai/artifact/DzMQhb9KcpEcmTt5juizmY.

## Le parcours (ce que Charles voit)

**Panneau.** Réglages › Modèles IA, section « Services », sous les cartes des rôles.
- En tête, une seule ligne « prochaine action » : pastille, phrase, un seul bouton néon. Par ordre de priorité : une clé refusée (« xAI refuse la clé. Seul Mistral, s'il est branché, écrit en attendant. », bouton « Remplacer la clé ») ; des crédits bas (« Remplacer » devient « Recharger ↗ ») ; le prochain service non connecté (« Connecte Grok ») ; sinon « Tout est connecté ». Dessous, une barre fine en trois segments : services connectés sur trois.
- Trois lignes, dans cet ordre : Grok (xAI) « Écrit les messages et décide », Gemini (Google) « Regarde les photos et vidéos », ElevenLabs (Vocaux) « Parle avec la voix de Messa ». Chaque ligne a une pastille et une seule phrase : ce qu'on perd sans le service (« Sans lui, l'agent n'écrit qu'avec le relais Mistral, s'il est branché ») ou ce qui marche (« Grok 4.7 écrit et décide · vérifié il y a 2 min »). Menu `⋯` : Vérifier maintenant, Remplacer la clé, Déconnecter.
- Quatre états seulement : non connecté, connecté, crédits bas (ambre), à reconnecter (rouge, pastille qui pulse). Aucun code HTTP à l'écran.
- Le mot « connecteur » n'apparaît pas (il désigne les plateformes, glossaire).
- Hors du panneau : si Grok est à reconnecter, bandeau en haut du Dashboard avec le même texte et le même bouton, et pastille sur l'icône Réglages. Le bouton ouvre la feuille de Grok directement à l'étape 2.

**Feuille de connexion** (`nv-glass--thick`, une feuille, pas de changement de page, une seule étape ouverte à la fois).
1. « Crée une clé chez xAI » : les réglages à choisir, écrits comme dans la console du fournisseur, chaque valeur à reprendre avec un bouton Copier ; une ligne d'avertissement si nécessaire ; bouton néon « Ouvrir la console xAI ↗ » (nouvel onglet, page exacte). L'étape se replie quand on a ouvert la console (« Revoir » la rouvre) ; « J'ai déjà ma clé » la saute.
2. « Colle-la ici » : un champ masqué. Au collage, la vérification part seule (pas de bouton Tester), pastille qui respire « Vérification auprès de xAI… ». Une clé d'un autre fournisseur est reconnue à son préfixe (`xai-`, `AIza`, `sk_`) : « Cette clé vient de Google : elle va dans Gemini. »
3. Succès : la feuille ne montre plus les étapes, seulement une coche qui se dessine, deux ou trois faits (modèle trouvé, rôle, crédits du mois en `countUp`) et un bouton néon « Continuer avec Gemini » (service suivant non connecté) ou « Terminé ». Après un remplacement : « L'ancienne clé ne sert plus : supprime-la chez xAI ↗ ».

**Par fournisseur.**
| | Console | Réglages indiqués | Vérification | Faits affichés |
|---|---|---|---|---|
| xAI | console.x.ai, API Keys | nom `impera-prod` ; modèles `grok-4.7` et `grok-4.3` ; accès Chat ; « Le compte xAI doit avoir du crédit. » | la clé est reconnue, ni bloquée ni désactivée, `grok-4.7` est accessible ; nom de la clé lu | Modèle Grok 4.7 ; utilisé pour la voix et les décisions |
| Google | aistudio.google.com/apikey | projet `Impera` ; Restrict to Gemini API only ; « Active la facturation du projet. En offre gratuite, Google peut garder les médias des fans. » | liste des modèles : l'identifiant exact du modèle Vision choisi (Gemini 3.8 Flash) est résolu ici et enregistré dans `settings` ; Gemini 4 Argon signalé s'il est visible | Modèle Gemini 3.8 Flash ; si Gemini refuse un média, Grok prend le relais |
| ElevenLabs | elevenlabs.io/app/settings/api-keys | nom `impera-prod` ; accès Text to Speech, Voices et User en lecture ; limite 100 000 caractères par mois | la clé lit les voix et l'abonnement ; crédits restants | vocaux possibles ce mois ; choix de la voix (présélection du nom contenant « Messa », bouton « Écouter » qui génère une phrase courte) ; « Chaque vocal passe par toi avant d'être envoyé. » ; sans voix clonée : « Aucune voix clonée sur ce compte. Crée la voix de Messa dans ElevenLabs, puis reviens : Impera la trouvera. » |

Les chemins d'API exacts de chaque vérification sont lus dans la doc du fournisseur au moment du code et notés dans la PR.

**Déconnecter** se confirme dans la page (`nv-confirm`) : « Déconnecter Grok ? Seul Mistral, s'il est branché, écrira tant que Grok n'est pas reconnecté. La clé est effacée d’Impera. Chez xAI, elle reste valide tant que tu ne la supprimes pas. »

## À faire
1. **Contrats** (`packages/contracts`) : `ProviderId` (`xai`, `google`, `elevenlabs`, `mistral`, `venice`), `ProviderConnectionState` (`not_connected`, `connected`, `low_credit`, `needs_reconnect`), DTO de l'état d'un service (sans clé), corps des routes. Zod partout.
2. **Base** : migration `provider_credentials` (`provider` unique, `ciphertext`, `nonce`, `key_version`, `key_label`, `settings` jsonb validé par Zod, `state`, `verified_at`, `last_error_kind`, `created_by`, horodatages), hors RLS, accès `withAdmin`. Réutiliser l'aide de chiffrement des sessions plateforme avec `CREDENTIALS_ENCRYPTION_KEYS` ; une commande de rechiffrement pour la rotation, sur le modèle de celle des sessions.
3. **`ProviderVerifier`** par fournisseur : un appel court en lecture seule, réponse validée par Zod, traduite en `{ state, facts, error }`. **Une seule table de traduction** (état + texte français) sert à la feuille, à la ligne, au bandeau et au journal. Textes : section « Quand ça ne marche pas » ci-dessous.
4. **Port `CredentialStore`** (domaine) avec deux adaptateurs : Postgres (production) et environnement (hors production seulement ; l'écran affiche alors « Clé lue depuis l'environnement de développement »). La passerelle accepte déjà une source de clés synchrone (`ApiKeySource`, PR #19) : le magasin la fournit depuis un cache mémoire, rechargé à chaque connexion, remplacement ou déconnexion. Pas de changement dans `LlmGateway`. L'interface `speech` lit la même source.
5. **Routes** (`/v1/settings/providers`) : `GET` (états), `PUT /:provider/key` (vérifie puis chiffre et enregistre ; en cas d'échec rien ne change ; réponse sans clé), `POST /:provider/verify`, `PUT /:provider/settings` (voix, modèle Vision), `DELETE /:provider`. Rôle `owner`, ré-authentification au-delà de 10 minutes de session, limite de débit, redaction Pino du corps. Événements `provider_key.connected`, `.replaced`, `.disconnected`, `.state_changed`, sans clé.
6. **Un vrai échec compte plus que la revérification** : un 401 ou un 403 renvoyé par un appel de production passe le service à `needs_reconnect` immédiatement (la passerelle prévient le magasin). Le job de revérification (toutes les 15 minutes) ne sert qu'au retour à la normale et aux crédits.
7. **Crédits bas** : sous 10 % du quota mensuel ElevenLabs, état `low_credit`. Pour xAI, seulement si son API expose le solde (à vérifier) ; sinon rien de plus que le budget du jour existant.
8. **Temps réel** : l'état des services est poussé par le flux SSE de l'API ; une clé révoquée pendant que l'écran est ouvert change la ligne sans recharger.
9. **Interface** (`apps/web`) : panneau et feuille comme décrits, classes `nv-*`, un seul néon par écran, mouvements du design system (entrée décalée de 40 ms, coche dessinée `nv-draw`, `countUp`, transitions de couleur 300 ms, rien ne bouge en continu sauf les pastilles d'attente et d'erreur, `prefers-reduced-motion` coupe tout). Cibles ≥ 44 px, clavier complet, `Échap` ferme la feuille.
10. **Docs alignées** : `.env.example` (`CREDENTIALS_ENCRYPTION_KEYS`, clés LLM et ElevenLabs marquées « dev seulement », `GOOGLE_VERTEX_*` retirées au profit de `LLM_GOOGLE_API_KEY`), `docs/architecture/ai-engine.md` (Gemini par clé d'API), `docs/runbooks/rotate-secrets.md`. Le playbook `add-an-llm-provider.md` et `config.ts` sont déjà alignés par la PR #19.

## Quand ça ne marche pas (table de traduction)
| Cas | Texte |
|---|---|
| Clé trop courte | « Cette clé paraît incomplète. Copie-la en entier depuis xAI. » |
| Clé d'un autre fournisseur | « Cette clé vient de Google : elle va dans Gemini. » |
| 401 | « xAI ne reconnaît pas cette clé. Vérifie qu'elle est copiée en entier. » |
| Modèle non autorisé (xAI) | « Cette clé n'a pas accès à Grok 4.7. Dans la console xAI, ajoute grok-4.7 à ses modèles. » |
| Crédit épuisé | « Le compte xAI n'a plus de crédit. Recharge-le, puis réessaie. » |
| API Gemini non activée | « Ce projet Google n'a pas accès à l'API Gemini. Recrée la clé depuis AI Studio. » |
| Modèle Vision introuvable | « Gemini 3.8 Flash n'est pas visible avec cette clé. Modèles trouvés : … » (menu pour choisir) |
| Permission manquante (ElevenLabs) | « La clé ne peut pas lire tes voix. Ajoute Voices en lecture à ses accès. » |
| Fournisseur injoignable | « xAI ne répond pas. Ta clé n'est pas en cause ; réessaie dans une minute. » (rien n'est enregistré) |
| Révoquée en production | Grok : « xAI refuse la clé. Seul Mistral, s'il est branché, écrit en attendant. » ; Gemini : « Google refuse la clé. Grok regarde les médias en attendant. » ; ElevenLabs : « ElevenLabs refuse la clé. Pas de vocaux pour l'instant. » |
| Crédits bas | « Plus que 40 vocaux ce mois. Recharge avant d'en manquer. » |

## Critères d'acceptation
- Tests unitaires : chaque ligne de la table de traduction, pour chaque fournisseur, à partir de réponses enregistrées et inventées ; détection du préfixe ; ordre de priorité de la ligne « prochaine action ».
- Tests d'intégration (Testcontainers) : chiffrement aller-retour, rotation `v2,v1`, une clé refusée ne remplace pas la clé en place, aucune route ne renvoie de clé, la clé n'apparaît dans aucun log capturé.
- Test de bout en bout Playwright contre de faux serveurs xAI, Google et ElevenLabs : connexion des trois services à la suite, clé refusée, accès incomplet, crédits bas, révocation pendant que l'écran est ouvert (la ligne change sans recharger), déconnexion confirmée.
- Avec une clé en base et aucune variable d'environnement, `pnpm probe` en production lit la base ; hors production, sans base, il lit l'environnement.
- Aucune vraie clé dans le dépôt, les tests, les fixtures ou les logs. `gitleaks` vert.
- `pnpm check` et `pnpm test:all` verts.

## Hors périmètre
- Le choix de modèle par rôle et les cartes des rôles (spec du panneau Modèles IA).
- Le clonage de la voix de Messa (il se fait dans ElevenLabs) et la génération des vocaux (fiche vocaux).
- Venice dans l'interface : le magasin l'accepte, sa ligne viendra quand un rôle s'en servira. (Mistral, le relais de Grok, a sa ligne depuis la recette du 17/10.)
- Plusieurs agences.

## Notes de session

2026-10-17 (V1, branche `claude/crm-connecteurs-ux-g38gh5`, menée en parallèle de la plomberie avec l'accord du coordinateur) : fait les points 1, 3, 4 (port `CredentialStore`, cache de clés et repli sur l'environnement ; adaptateur mémoire seulement), 6 et 7 côté domaine, plus la priorité de l'action suivante. Puis la table et sa migration (point 2), le magasin Postgres, les routes (point 5, testées derrière un garde factice), le module dans `composition-root.ts` (Postgres si `CREDENTIALS_ENCRYPTION_KEYS`, sinon mémoire hors production), `config.ts`, `.env.example`, `ai-engine.md`, `rotate-secrets.md` (point 10). Puis les routes montées derrière `requireRole('owner')` et la page (point 9), montée provisoirement dans `App.tsx` jusqu'à la navigation du shell. Reste : la ré-authentification au-delà de 10 minutes de session et les événements `provider_key.*` (point 5) ; brancher `apiKeySource` dans la passerelle et le rapport des refus (point 6) avec le fil agent ; SSE (point 8 ; le job de 15 minutes `providers.check_credentials` est fait) ; pas de commande de rechiffrement (la rotation passe par « Vérifier maintenant », `rotate-secrets.md`).
2026-10-17 (recette, PR #58 puis la suivante) : corrigé ce que la recette a trouvé. Un 429 ne compte plus comme un refus. Un refus vu en production passe au rouge tout de suite quand la clé refusée est celle en service ; il est vérifié auprès du fournisseur quand il peut venir de la clé précédente (changée il y a moins de 5 minutes). `pnpm ops:reencrypt-credentials` rechiffre les clés (point 10). La ré-authentification (#41) et le branchement de la passerelle sont faits. `audit_log` reçoit une ligne à chaque connexion, remplacement et déconnexion (qui, adresse, empreinte de 8 caractères, jamais la clé). La ligne d'une clé refusée dit pourquoi (refus, crédit, accès, clé illisible). La page traite la session expirée, le 403 de rôle et le 429, n'est plus lue par les gestionnaires de mots de passe et retire les espaces d'une clé collée. Les routes de collage et de vérification sont limitées à 10 par minute. Mistral, le relais de l'écriture quand Grok ne répond plus, a sa ligne, son guide et son vérificateur (`GET /v1/models`, Mistral Large requis) ; le serveur lit aussi `LLM_MISTRAL_API_KEY` et `LLM_VENICE_API_KEY` en développement (Bilan). Reste : les événements `provider_key.*` (point 5), le SSE (point 8), l'e2e Playwright, le bandeau du Dashboard, et des tests de composants (pas de bibliothèque DOM dans `apps/web`).
