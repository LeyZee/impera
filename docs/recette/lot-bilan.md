# Lot Bilan : API, base, worker, connecteurs, sécurité

Zone : `packages/contracts`, `packages/db`, `packages/llm` (passerelle), `apps/api/src` hors modules métier des autres lots, `apps/api/src/modules/connectors`, `providers`, `telegram`, `backups`, `notifications`, la CI. Écrans joués avec Extension : Réglages › Modèles IA, Ventes, Telegram, Sauvegardes, Sécurité, et tout ce qui touche la connexion.

## 0. Outillage commun (à livrer en premier)

1. Script de pile par agent (base `impera_rN` migrée, API + worker en ligne, Vite) et script de connexion Playwright avec TOTP.
2. Jeu de données de recette, inventé : 1 propriétaire, 2 managers, 4 chatteurs (un payé à la commission, un à l'heure, un suspendu, un parti), 1 opérateur, 3 créatrices (« Lina Test » complète, « Maya Démo » sans persona active, « Zoé Archivée » archivée), leurs comptes Reveal fictifs, 2 semaines de shifts, une quinzaine close et une ouverte, 30 fans fictifs. Fiche proposée : `docs/sessions/tasks/PROPOSED-recette-sandbox.md`.
3. Matrice d'accès automatique (reprise du 05/11) : chaque route × chaque profil, attendu 200 / 403 / 404, rejouée sur `main` à jour. Les routes nouvelles depuis le 05/11 (#600 à #615) y entrent.

## 1. Démarrage, santé, arrêt

| # | Parcours | Attendu |
|---|---|---|
| B1 | Démarrer l'API sans `CREDENTIALS_ENCRYPTION_KEYS`, puis sans `SESSION_ENCRYPTION_KEYS`, puis avec une valeur mal formée | refus de démarrer avec une phrase claire, jamais la valeur dans le log |
| B2 | `/health` et `/ready` avec base coupée, worker tué, verrou orphelin | `/ready` dit faux dès qu'un composant manque (constat MOT-02 du 05/11 à revérifier) |
| B3 | Arrêt propre (SIGTERM) pendant un job | job repris au redémarrage, rien en double |
| B4 | `pnpm ops:kill-switch --on --scope global --reason "recette"` puis `--off` | plus aucun brouillon ni envoi pendant l'arrêt, le Dashboard le montre, reprise sans perte |
| B5 | `pnpm ops:check-keys`, `pnpm ops:revoke-sessions --all`, `pnpm ops:reset-second-factor` sur un compte de recette | effet visible à l'écran, rien d'autre touché |

## 2. Authentification et sécurité

| # | Parcours | Attendu |
|---|---|---|
| B6 | Connexion de chaque rôle ; mauvais mot de passe 10 fois ; code 2FA rejoué ; code de secours utilisé deux fois | limite de tentatives, un code ne sert qu'une fois (SEC-03 du 05/11) |
| B7 | Invitation d'un membre, d'une créatrice : lien expiré, lien réutilisé, mot de passe fuité, service des mots de passe fuités injoignable | phrase juste à chaque cas (doublon CHAT-10 du 05/11 à revérifier) |
| B8 | Mot de passe oublié du propriétaire par Telegram (ADR 0068), sans bot relié | l'écran dit quoi faire, aucun envoi |
| B9 | Clé d'accès (passkey) : ajout, connexion, retrait | ADR 0053 |
| B10 | Session expirée au milieu d'un formulaire | retour à la connexion, pas d'écran figé (SEC-01) |
| B11 | Isolation : un opérateur, une créatrice, un chatteur tentent chaque route d'une autre créatrice (ids devinés) | 403 ou 404, jamais une donnée ; RLS forcée sur chaque table nouvelle |
| B12 | Entrées hostiles sur chaque route qui écrit : NUL, 1 Mo de texte, JSON profond, émojis, RTL, nombre négatif, date impossible | 400 propre, jamais 500 ni pile (MOT-05 à 08) |
| B13 | En-têtes : CSP, CORS, cookies `Secure`/`HttpOnly`/`SameSite`, Origin refusée | conformes ; webhook public seul sans contrôle d'Origin |

## 3. Clés d'IA (Réglages › Modèles IA)

Sans vraie clé : tout se joue avec des clés inventées et des fournisseurs injoignables.

| # | Parcours | Attendu |
|---|---|---|
| B14 | Coller une clé fausse pour xAI, Google, Mistral, ElevenLabs | refus avec la cause (« clé refusée », « fournisseur injoignable »), rien enregistré, ré-authentification demandée si plus de 10 min |
| B15 | Clé collée sur deux lignes, avec espaces, avec un gestionnaire de mots de passe | nettoyée ou refusée proprement |
| B16 | Aucune clé : Dashboard, Suivi, Playground, Créatrices › Persona | chaque écran dit ce qui manque, aucun plantage ; l'agent retient (`llm_unavailable`) |
| B17 | Budget du jour atteint (simuler le journal `llm_calls`) | bandeau agence, Telegram « plafond atteint » dans la file, plus de génération jusqu'à minuit |
| B18 | Rotation de `CREDENTIALS_ENCRYPTION_KEYS` puis `pnpm ops:reencrypt-credentials` | clés relisibles, ancienne version retirable |

## 4. Reveal par l'API CRM (Réglages › Ventes), contre FakeReveal

FakeReveal (API privée provisoire et API CRM) vit dans les tests : `apps/api/src/__tests__/fake-reveal/server.ts` et `apps/api/src/__tests__/fake-reveal/crm.ts`. Sur une pile de recette, l'adaptateur CRM pointe vers `api.reveal.me` sans moyen de le détourner, et rien ne lance FakeReveal : c'est le premier manque du mode simulé ([preparation-cles.md](preparation-cles.md)). En attendant, ces parcours se jouent en intégration.

| # | Parcours | Attendu |
|---|---|---|
| B19 | Connecter une clé : 401, 403, 429 avec `Retry-After`, réponse de forme inattendue | « à reconnecter », pause, page refusée entière ; jamais la clé renvoyée |
| B20 | Lecture des ventes : curseur, vente tardive, remboursement, vente d'une modèle non reliée (quarantaine), puis liaison | ventes en attente comptées à la liaison, une seule fois |
| B21 | Webhook : inscription (HTTPS seulement), livraison signée, rejouée, mal signée, `t` vieux de 6 min | une seule ligne, 401 sans rien garder, `lastRejectedAt` visible |
| B22 | Vérification (CheckPanel) avec un export CSV inventé : séparateurs `;` `,` tabulation, `12,34 €`, dates `JJ/MM/AAAA`, colonne inconnue | `match`, `mismatch`, `incomplete` justes ; colonne et ligne citées, jamais une valeur |
| B23 | Import des créatrices : cochées d'avance, double clic, nom pris, modèle bannie, écarter et reprendre | aucune créatrice en double, audit écrit |
| B24 | Veille de la liste : modèle disparue, bannie, de retour | Telegram Important sans nom, une seule fois |
| B25 | Vérification automatique du 2 et du 17 (`connector.check_sales`) | écart publié seulement après la relecture de 24 h |
| B26 | Lien du membre « bot » vers l'agent | ses ventes vont à l'agent, sans commission |

## 5. Connecteur de messagerie (session capturée)

| # | Parcours | Attendu |
|---|---|---|
| B27 | Suite de contrat de `FakeConnector` (`apps/api/src/modules/connectors/infra/__tests__/contract.test.ts`) | verte ; elle servira de barrière au futur `RevealApiConnector` |
| B28 | `POST /v1/connector/sessions` sans jeton, avec jeton faux, avec jeton juste et corps faux | 401 `device_unauthenticated` avant toute lecture, puis 400 |
| B29 | Ingestion : message avec caractère NUL, émoji composé, 20 000 caractères, même `platform_message_id` deux fois | aucune sortie du worker (MOT-01), une seule ligne |
| B30 | Envoi idempotent : erreur réseau après envoi, rejeu | `verifySent` avant tout renvoi, jamais deux bulles |
| B31 | Session expirée, coupe-circuit, rythme des relèves | `docs/runbooks/session-expired.md` suivi, alerte, aucun martèlement |

## 6. Jobs et worker

Pour chaque job de `apps/api/src/crontab.ts` : le lancer à la main sur le jeu de recette, le lancer deux fois (idempotence), le faire échouer (base coupée) et vérifier la reprise. Liste : `backups.check`, `connector.check_sales`, `connector.read_sales`, `connector.dispatch`, `content_drops.erase_originals`, `conversation.release_unavailable`, `fans.purge_facts`, `payroll.*` (9 jobs, avec Équipe), `providers.check_credentials`, `rate_limit.purge`, `scheduling.*` (3 jobs, avec Équipe), `scripts.ask_scripts` (avec Médias), `team.apply_roles`, `telegram.*` (6 jobs).

## 7. Telegram (Réglages › Telegram), sans bot réel

| # | Parcours | Attendu |
|---|---|---|
| B32 | Chaque onglet (Qui est prévenu, Ventes, Validations, Bots et groupes, Mon chat privé) vide, rempli, avec un jeton faux | refus clair, aucun jeton affiché |
| B33 | File de sortie : chaque type d'alerte produit son message (aperçu) sans nom de fan ni mot de fan | conforme à l'ADR 0020 |
| B34 | Résumés du matin et du soir, heures calmes | contenu juste sur le jeu de recette |

## 8. Sauvegardes

| # | Parcours | Attendu |
|---|---|---|
| B35 | Réglages › Sauvegardes sans `BACKUP_DATABASE_URL` ni destinataire age | l'écran dit ce qui manque ; bandeau du Dashboard |
| B36 | Sauvegarde lancée, test de restauration (`docs/runbooks/restore.md`) sur une base jetable | fichier chiffré, restauration complète, rien de réel |

## 9. Qualité continue

`pnpm check`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e` verts sur `main` ; tests instables listés avec leur cause (MOT-11 du 05/11) ; temps de chaque suite noté pour repérer une dérive.
