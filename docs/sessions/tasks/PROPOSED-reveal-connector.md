# PROPOSED Connecteur Reveal : lecture, scripts natifs, notes client, envoi

Statut : proposed (écrite le 2026-10-17 par le fil Connexion Reveal ; ID à attribuer par Charles)
Phase : 2 (avancée par la revue du cap du 17/10 : chantier 8, « connecteur Reveal en lecture + copilote »)
Dépend de : P0-06 (port `PlatformConnector`, `FakeConnector`, test de contrat), P1-02 (capture analysée, `reveal-api-observed.md` rempli, FakeReveal)
Branche : task/<id>-reveal-connector

## Objectif

Un `RevealApiConnector` qui lit la boîte de réception, les conversations, les profils, les achats, les notes client, les notes du modèle, les statistiques PPV, les scripts natifs et leur historique par fan, et qui sait envoyer un texte, un PPV, une étape de script et une note, testé contre FakeReveal, sans jamais écrire vers un vrai fan.

## Contexte à lire

- ADR 0008, ADR 0018, `docs/architecture/connectors.md` (port, règles de bonne conduite), ADR 0003 (cœur agnostique).
- `docs/reference/reveal-connector-inventory.md` (capacités L1 à L10, E1 à E6), `docs/reference/reveal-api-observed.md` (rempli par P1-02), `docs/reference/fake-reveal.md`.
- `docs/conventions/testing.md` (contrat, FakeReveal), `docs/conventions/security.md` (sessions chiffrées), `docs/runbooks/session-expired.md`.

## À faire

- **Ne rien commencer si `reveal-api-observed.md` est vide** : passer la fiche en `blocked` et le dire.
- Schémas Zod stricts des réponses Reveal utilisées, tels qu'observés, dans `infra/reveal/` du module `connectors` (jamais dans `packages/contracts` : le cœur ne voit pas les formes Reveal) ; mappage vers `ConversationSnapshot`, `ExternalMessage`, `ExternalTransaction`.
- Port : ajouter les méthodes optionnelles de l'inventaire (`getFanProfile`, `getFanNote`, `setFanNote`, `getCreatorNotes`, `setCreatorNotes`, `getFanPpvStats`, `listPlatformScripts`, `sendScriptStep`, `listVaultMedia`, `fetchMedia`, `getScriptHistory`) et les drapeaux `capabilities` correspondants, selon l'ADR 0018 (à faire accepter d'abord ; lot coordonné avec le fil Bilan).
- `RevealApiConnector` (infra du module `connectors`) : client HTTP `undici`, en-têtes et User-Agent du vrai client, erreurs typées (`SessionExpired`, `RateLimited`, `NotFound`, `Transient`, `Fatal`), pagination complète de l'historique, idempotence (nonce client si Reveal l'accepte, sinon `verifySent` avant tout rejeu).
- Bonne conduite (ADR 0008) : un client par compte, rythme humain avec jitter, coupe-circuit après N erreurs, arrêt total sur `SessionExpired`, sortie par l'IP configurée, session jamais loguée.
- Session du **membre d'équipe « bot »** créé dans Reveal (décision de Charles, 17/10), jamais celle de Charles ; les messages sortants doivent porter ce membre comme auteur (test contre FakeReveal).
- Exposer le moment d'un script (`day` ☀️, `night` 🌙, ou aucun) depuis son nom ou son dossier du Vault, pour la règle « temps présent » appliquée par le moteur de vente (inventaire, Décisions de Charles).
- Garde d'écriture : toute écriture refuse de partir si le compte n'est pas en mode autorisé (réglage `connector_config.writes`, désactivé par défaut) ; les tests écrivent seulement vers FakeReveal.
- FakeReveal (`apps/api/src/__tests__/fake-reveal/`, convention de `testing.md`) complété pour chaque endpoint utilisé, avec ses scénarios (`fake-reveal.md`).
- Test de contrat commun : vert contre `FakeConnector` et contre `RevealApiConnector` + FakeReveal, y compris les scénarios `session_expired`, `rate_limited`, `shape_changed`, `challenge`.
- Tests unitaires du mappage (chaque type de message, PPV acheté ou non, étape de script) et de la lecture de l'indicateur « script déjà envoyé » de Reveal.
- `reveal-api-observed.md` : section « Capacités déclarées » à jour.
- Achats à observer (à anticiper, contrat à définir avec le fil Bilan d'après la capture) : l'onglet Ventes des alertes Telegram et l'entonnoir du Dashboard ont besoin de chaque achat payé, par conversation, avec montant, bundle, et vendu par l'agent ou un chatteur. Le connecteur les lit là où Reveal les expose (historique des bundles du panneau PPV, dépenses du panneau Analytics, transactions) et les publie comme événement de domaine.

## Critères d'acceptation

- `pnpm check` et `pnpm test:all` verts.
- Test de contrat vert sur les deux adaptateurs ; chaque scénario d'erreur produit l'erreur typée attendue et déclenche le coupe-circuit au bon seuil.
- Contre FakeReveal : liste → conversation (historique complet) → profil, achats, note → scripts et étapes déjà envoyées → envoi texte, PPV, étape de script, note → relecture : tout est cohérent, et un rejeu avec la même clé ne crée pas de doublon.
- Aucune écriture possible quand `connector_config.writes` est désactivé (test).
- Aucun identifiant, cookie ou contenu réel dans le dépôt (relecture + gitleaks).

## Hors périmètre

Capture de session par l'extension et endpoint `/v1/connector/sessions` (fiche à part), poller et ingestion (P0-05, P0-06), moteur de vente, interface copilote, mise en production, tout appel au vrai Reveal (un test manuel en lecture seule se fait seulement à la demande de Charles).

## Notes de session

- 2026-10-30 (fil Extension, accord du coordinateur) : route `/aide/reveal` (apps/web, propriétaire) réservée pour l'aide « Reconnecter Reveal ». Elle s'écrit dans la même PR que la capture de session (fiche à part), d'après `docs/runbooks/session-expired.md`, et le lead « Reveal est déconnecté » du Dashboard y mènera (DASH-18, recette design). Le runbook dit désormais la session du membre « bot », comme cette fiche.
