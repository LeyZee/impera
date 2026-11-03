# Module `providers`

**Rôle.** Connecter, vérifier, remplacer et déconnecter les clés des services IA (xAI pour Grok, Google pour Gemini, ElevenLabs pour les vocaux) depuis Réglages › Modèles IA, et les fournir à la passerelle LLM (ADR 0016, fiche P3-03).

**Peut dépendre de.** Aucun module. `packages/contracts` ; l'infra parle aux API des fournisseurs (lecture seule).

**Tables possédées.** `provider_credentials` (`packages/db/src/schema/credentials.ts`) : clé scellée par `CREDENTIALS_ENCRYPTION_KEYS`, hors RLS, retirée au rôle applicatif, lue et écrite par `withAdmin` seulement.

**Routes.** `/v1/settings/providers` : `GET`, `PUT /:provider/key`, `POST /:provider/verify`, `PUT /:provider/settings`, `DELETE /:provider`, derrière `requireRole('owner')` (montées avec P0-07a).

**Jobs émis.** `providers.check_credentials`, toutes les 15 minutes (`crontab.ts`) : revérifie les clés enregistrées (crédit, clé révoquée, retour à la normale).

## Règles propres

- Une clé n'est enregistrée qu'après une vérification réussie ; un remplacement refusé laisse l'ancienne clé en place.
- Aucune fonction publique ne renvoie une clé, sauf `apiKeySource`, lue en mémoire par la passerelle et le client vocal.
- Une seule table de textes (`domain/messages.ts`) : la feuille, la ligne, le bandeau et le journal disent la même chose pour le même problème. Jamais de code HTTP à l'écran.
- Un fournisseur injoignable ne dit rien de la clé : l'état ne change pas.
- Un refus sur un vrai appel (401, 403) passe le service à « à reconnecter » tout de suite (`reportRefusedKey`).
- Alerte « connexion en panne » (Telegram P3-12, `domain/connection-signal.ts`) : après chaque écriture d'une ligne, le module dit `down` (`refused`, ou `low_credit` pour un crédit bas ou épuisé) ou `back` ; un fournisseur injoignable ne passe `down` (`unreachable`) qu'après 45 minutes sans réponse, soit trois vérifications, et jamais sur un quota (429). La composition branche `publishConnectionState` (`src/connection-state.ts`), qui n'écrit `connection_state_changed` qu'à la bascule. Venice, en secours, n'est pas surveillé.

## Structure

- `domain/` : profils des services, forme des clés, textes, états, prochaine action. Pur, testé.
- `application/` : connexion, revérification, déconnexion, réglages (voix, modèle Vision), cache des clés.
- `infra/` : un vérificateur par fournisseur (un `GET` en lecture seule, réponses validées par Zod), magasin Postgres (et en mémoire pour les tests et le développement sans clé de chiffrement), routes.
- `index.ts` : `startProvidersModule(options)` pour le composition root, `createProvidersModule(deps)` pour les tests.

Les chemins d'API des fournisseurs (`/v1/api-key` chez xAI, `/v1beta/models` chez Google, `/v1/user/subscription` et `/v1/voices` chez ElevenLabs) sont à reconfirmer avec une vraie clé lors de la première connexion.
