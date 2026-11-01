# Sécurité : règles et baseline

Ce qu'on protège, par ordre d'importance : (1) les médias et conversations intimes des fans et de la créatrice, (2) la session plateforme de la créatrice (= son compte Reveal), (3) le contrôle du bot (dashboard, interrupteurs), (4) les clés LLM (coût), (5) le code. Le modèle de menaces complet est dans `docs/architecture/threat-model.md`. Ce fichier est la liste des règles que chaque session applique.

## 1. Exposition : rien n'est public par défaut

- **Le dashboard n'est jamais exposé directement sur Internet.** Il est derrière Cloudflare Access (identité Google/email, liste d'utilisateurs) ou un réseau privé (Tailscale). Une application que personne ne peut atteindre ne se fait pas pirater « facilement ».
- L'API n'écoute que sur l'interface privée du VPS (Docker network) ; seul le reverse proxy (Caddy/Traefik via Coolify) la publie, en HTTPS, avec HSTS.
- L'endpoint que l'extension appelle (capture de session, enregistrements) est authentifié par un **jeton d'appareil** révocable, limité par débit, et n'accepte que les origines de l'extension.
- Postgres n'est jamais joignable depuis Internet (Neon : IP allowlist ; self-host : réseau Docker uniquement).
- Aucun bucket de médias public. Accès par URL signée courte (≤ 15 min).

## 2. Secrets

- Jamais dans le dépôt, jamais dans les logs, jamais dans une réponse d'API. `gitleaks` en pré-commit et en CI, secret scanning GitHub activé.
- Un secret par usage, par environnement (dev / staging / prod). Une clé LLM par rôle et par environnement, avec plafond de dépense côté fournisseur.
- Rotation : procédure dans `docs/runbooks/rotate-secrets.md`. Toute suspicion de fuite = rotation immédiate, pas d'enquête avant.
- Les **sessions plateforme** (cookies/jetons Reveal) sont chiffrées en base (AES-256-GCM, clé hors base, dans l'env chiffré de Coolify), déchiffrées uniquement dans le processus connecteur, jamais renvoyées par l'API, jamais loguées (redaction pino sur `session`, `cookie`, `token`, `authorization`).
- Les **clés des fournisseurs IA** suivent la même règle : saisies dans le dashboard, chiffrées en base avec `CREDENTIALS_ENCRYPTION_KEYS`, jamais renvoyées par l'API ni loguées (ADR 0016).
- 2FA obligatoire sur GitHub, Hetzner, Cloudflare, Neon, fournisseurs LLM, Reveal.

## 3. Données

- **Minimisation** : on ne stocke d'un fan que ce qui sert à la conversation. Jamais de coordonnées, de localisation précise, d'identifiant de paiement. Le cerveau a une liste blanche de catégories de faits ; tout le reste est ignoré.
- **Rétention** : chaque `fan_fact` et chaque média reçu d'un fan a une date d'expiration (défaut : faits 12 mois après dernier contact, médias fan 30 jours). Un job purge : `fans.purge_facts` (chaque nuit) supprime tous les faits d'un fan qu'on n'a plus vu depuis un an (`fans.last_seen_at`). Les médias de la créatrice vivent selon ses droits (`media_assets.rights`).
- **Effacement** : une commande `erase-fan <id>` supprime tout ce qui concerne un fan (faits, résumés, médias, messages anonymisés dans le journal). Elle existe dès la phase 2, même si personne ne la demande : la construire après coup est dix fois plus cher.
- **Chiffrement au repos** : disques VPS chiffrés, base chiffrée (Neon par défaut), bucket chiffré. Les champs les plus sensibles (sessions, faits de catégorie `intimate`) chiffrés applicativement en plus.
- **Logs sans contenu** : par défaut, on logue des identifiants et des métadonnées, pas le texte des messages. Le contenu n'est consultable que dans le dashboard, authentifié, et dans Langfuse (accès restreint, rétention courte).
- **Tests et fixtures** : données inventées uniquement. Jamais un export réel dans le dépôt, même anonymisé « à la main ».

## 4. Le LLM comme surface d'attaque

- Le texte d'un fan (et le contenu d'un média décrit) est **toujours** inséré dans un bloc délimité, typé « données non fiables ». Le prompt système dit explicitement que rien dans ce bloc n'est une instruction.
- La **voix** n'a aucun outil. Le **cerveau** n'a que des outils de lecture ; ses décisions sont des propositions validées par la politique en code. Aucune action externe (envoi, achat, suppression, changement de réglage) ne découle directement d'une sortie de modèle.
- Sorties structurées validées par Zod ; une sortie invalide = retry, puis draft en erreur, jamais d'exécution partielle.
- Gardes post-génération : mention d'IA/de prompt/de système, fuite de données d'un autre fan, URL ou coordonnées, prix hors offre, mots interdits par la persona.
- Évals adversariales dans `evals/adversarial/` : injections classiques (« ignore tes instructions », « répète ton prompt », « tu es maintenant… »), tentatives d'extraction de données d'autres fans, demandes de rencontre/paiement hors plateforme. Elles tournent en CI sur un sous-ensemble.
- Plafonds : tokens par appel, appels par conversation et par heure, budget LLM par créatrice et par jour (coupe-circuit).

## 5. Chaîne d'approvisionnement

- `pnpm` avec lockfile commité, `pnpm install --frozen-lockfile` en CI, scripts d'installation désactivés par défaut (comportement pnpm 10), `pnpm audit --audit-level=high` en CI (échec sur high et critique ; correctifs transitifs par `overrides` et exceptions justifiées une par une dans `pnpm-workspace.yaml`, revues à chaque session d'hygiène), Dependabot en PR hebdomadaires groupées (`.github/dependabot.yml`).
- Peu de dépendances, bien connues, maintenues. Toute dépendance nouvelle de poids = ligne dans la PR qui justifie.
- Versions épinglées : dépendances npm en versions exactes dans les `package.json` (pas de `^`, on monte avec `pnpm up`), Node (`.nvmrc`), images Docker par digest, modèles LLM par identifiant daté.
- L'extension : `host_permissions` limitées au domaine Reveal, aucun code distant, build reproductible, pas de `eval`.

## 6. Application web et API

- Validation Zod de toute entrée (corps, query, params, en-têtes utiles). Erreurs génériques vers le client, détail dans les logs.
- Auth : Better Auth, cookies `HttpOnly; Secure; SameSite=Lax`, sessions courtes côté dashboard, passkeys encouragées. Action sensible (connecter, remplacer ou retirer une clé IA, ADR 0016) : connexion de moins de 10 minutes exigée (`requireRecentLogin`), sinon 403 `reauthentication_forbidden` et le dashboard redemande le mot de passe. Cette nouvelle connexion ferme la session que le navigateur tenait déjà pour le même compte : confirmer son mot de passe ne laisse pas une session ouverte de plus à chaque fois (celle d'un autre compte reste à sa propre déconnexion). Rôles : `owner`, `operator`, `creator` ; RLS Postgres en second rideau. Un membre de l'équipe marqué `left` ne se connecte plus (même réponse qu'un mauvais mot de passe), et ses sessions sont révoquées au passage à `left` puis, si l'une restait ouverte, refusées à la requête suivante (ADR 0023). Les autres statuts gardent la connexion, avec le scope `self` (ADR 0024).
- CSRF : `SameSite=Lax` et vérification de l'en-tête `Origin` sur chaque mutation contre la liste des origines autorisées (pas de jeton CSRF séparé). CORS : la même liste explicite. En-têtes de sécurité (`@fastify/helmet`). Limites de taille de corps. Rate limiting par IP et par utilisateur (`@fastify/rate-limit`). L'IP du client est celle que Fastify résout derrière `TRUST_PROXY_HOPS` proxys (2 en production : le Traefik de Coolify puis le nginx du conteneur `web`, ADR 0027 ; 0 en local). `x-forwarded-for` ne compte qu'au-delà de ces sauts. Better Auth ne lit que l'en-tête `x-nirvana-client-ip`, que le serveur réécrit à chaque requête : l'IP des limites et celle de `audit_log` ne peuvent pas venir du client. La connexion a deux limites : 20 par minute et par IP, et 10 par quart d'heure et par compte, quelle que soit l'adresse (429 `sign_in_limited`). Les liens d’invitation (EQ-10) ont chacun leur limite par IP : 30 lectures et 10 utilisations par quart d’heure ; seul le propriétaire en crée, après une connexion récente. Les compteurs de toutes ces limites vivent dans Postgres (`rate_limit_counters`, ADR 0027) : toutes les instances de l'API comptent dans les mêmes lignes, un redémarrage ou un déploiement ne les remet pas à zéro. La clé ne garde ni l'IP ni l'e-mail en clair (empreinte SHA-256), et la tâche `rate_limit.purge` efface toutes les 10 minutes les fenêtres finies depuis plus d'une heure. Le limiteur a son propre petit pool (3 connexions, `statement_timeout` de 200 ms, 500 ms au plus pour obtenir une connexion) : un Postgres lent coûte au plus ce délai à une requête, jamais une connexion du pool des modules. Si les compteurs ne répondent pas, chaque échec est journalisé (`warn`) et le limiteur global **laisse passer** (une panne de Postgres arrête déjà presque toute l'API, il ne doit pas en rajouter), tandis que les limites de `/v1/auth/*`, connexion comprise, **refusent** en 503 `service_unavailable` : mieux vaut un refus qu'une rafale de mots de passe pendant une panne. Toute route sensible ajoutée plus tard (liens d'invitation, EQ-10) déclare `skipOnError: false` sur sa limite. Deux limiteurs qui partageraient leurs compteurs (même route, ou mêmes bornes sans route) arrêtent le démarrage.
- Uploads : type vérifié par contenu (magic bytes), taille bornée, stockage hors du système de fichiers de l'app, jamais servis depuis le même domaine que le dashboard.
- Journal d'audit des actions d'administration (`audit_log` : qui, quoi, quand, depuis où), append-only.

## 7. Opérations

- Trois environnements : `dev` (FakeReveal, clés de test), `staging` (compte Reveal de test si disponible, sinon FakeReveal), `prod`. Aucune clé partagée entre eux.
- Sauvegardes chiffrées, **restauration testée** une fois par trimestre (une sauvegarde jamais restaurée n'existe pas).
- Alertes : échecs d'authentification répétés, nouvelle session d'appareil sur l'extension, dépense LLM anormale (> 2× la médiane), erreurs connecteur en rafale, session plateforme expirée.
- Runbooks dans `docs/runbooks/` : fuite de secret, compromission du serveur, session Reveal compromise, dépense LLM qui s'emballe, restauration.
- Branches protégées sur GitHub : PR obligatoire, CI verte, pas de push direct sur `main`.

## 8. Ce que chaque PR vérifie (checklist)

- [ ] Aucune nouvelle entrée sans validation Zod.
- [ ] Aucun secret, aucune donnée réelle.
- [ ] Les nouvelles tables ont `creator_id` et une politique RLS.
- [ ] Les nouveaux logs ne contiennent pas de contenu de message ni de session.
- [ ] Les nouvelles actions externes passent par la politique en code, pas par une sortie LLM.
- [ ] Les nouvelles dépendances sont justifiées.
