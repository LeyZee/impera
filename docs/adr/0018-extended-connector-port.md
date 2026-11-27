# 0018. Port connecteur étendu : scripts natifs, notes, coffre, médias, garde d'écriture

<!-- bandeau-rangement-2026-11-27 -->
> **Changée en partie depuis.** Le texte ci-dessous est d’origine et reste valable, sauf pour les passages qu’une décision plus récente remplace. Ce qu’elle dit remplacer, avec ses propres mots :
>
> - [0050 · Reveal à deux voies : l'API CRM officielle pour les ventes et les chiffres, la session capturée pour tout le reste](0050-reveal-two-paths-crm-api-and-captured-session.md) : Remplace : dans l'ADR 0018, l'alternative rejetée « un second port », pour les seules ventes et les seuls chiffres ; dans l'ADR 0043 § 4, la phrase « une vente de la fenêtre sans attribution envoie le rapport au valideur » ; dans l'ADR 0043 § 5, la phrase « le rapport reste dû pour le commentaire, l'incident, les remontées et le contrôle ».
>
> Toutes les décisions du même sujet : [`docs/regles/reveal.md`](../regles/reveal.md).
<!-- /bandeau-rangement-2026-11-27 -->

Statut : accepted (Charles, 17/10, #39)
Date : 2026-10-17

## Contexte

Le port `PlatformConnector` livré par P0-06 (`apps/api/src/modules/connectors/domain/platform-connector.ts`) couvre la messagerie : boîte de réception, historique, texte, média, vérification d'envoi, transactions, lu et frappe, temps réel. L'inventaire du connecteur Reveal (`docs/reference/reveal-connector-inventory.md`) montre que l'agent a besoin de plus pour vendre comme un chatteur :

- le panneau de droite d'une conversation : note client, notes du modèle, statistiques du fan, onglet PPV ;
- les scripts natifs (bundles prêts, étapes, moment ☀️ / 🌙) : c'est le seul moyen de vente du bot (décision de Charles du 17/10, le bot n'envoie jamais de média libre) ;
- le coffre et les fichiers des médias, pour que la vision voie ce que le fan envoie et ce que contient un bundle.

Ces capacités ne sont pas propres à Reveal : OnlyFans, Fansly et notre future plateforme ont des notes, des PPV et des médias, sous d'autres noms. Elles doivent donc entrer dans le port, sans que le cœur connaisse Reveal (ADR 0003).

Aujourd'hui, rien n'empêche un compte enregistré d'écrire chez son fan dès que son adaptateur est branché.

## Décision

1. **Méthodes optionnelles** ajoutées à `PlatformConnector`, chacune annoncée par un drapeau de `capabilities`, avec la même règle que les méthodes existantes : erreurs typées (`ConnectorError`) seulement, clé d'idempotence sur toute écriture.

   | Méthode | Drapeau | Inventaire |
   |---|---|---|
   | `getFanProfile?(fanRef)` | `fanProfile` | L5 |
   | `getFanNote?(fanRef)` | `fanNoteRead` | L7 |
   | `setFanNote?(fanRef, text, key)` | `fanNoteWrite` | E4 |
   | `getCreatorNotes?(conversationRef)` | `creatorNotes` | L11 |
   | `getFanPpvStats?(fanRef)` | `ppvStats` | L12, L13 |
   | `listPlatformScripts?()` / `sendScriptStep?(conversationRef, scriptRef, stepIndex, key)` | `scripts` | L8, E3 |
   | `getScriptHistory?(fanRef)` | `scriptHistory` | L9 |
   | `listVaultMedia?(opts)` | `vault` | L10 |
   | `fetchMedia?(mediaRef)` | `mediaDownload` | L14, L15 |

   `getFanNote` lit la note client **en direct** sur la plateforme, pour le volet fan du lecteur de Suivi (`GET /v1/conversations/:id/fan-panel`, décision de Charles du 17/10) et pour le contexte de l'agent. Son contenu n'est jamais stocké ni journalisé chez nous : ni en base, ni dans les logs, ni dans `llm_calls` hors du prompt de l'appel en cours. Lecture et écriture ont chacune leur drapeau : une plateforme peut permettre de lire la note sans permettre de l'écrire.

   `setCreatorNotes` (E4b) attend que la capture montre la portée des notes du modèle.

2. **Schémas** dans `packages/contracts/src/connector.ts`, en vocabulaire du glossaire et sans aucun champ propre à Reveal :
   - `FanProfile`, `FanNote`, `CreatorNote`, `FanPpvStats` ;
   - `PlatformScript`, avec ses étapes (texte, médias vendus et d'aperçu, prix en unités mineures, gratuit possible) et son moment `day | night | null` ;
   - `VaultMedia`, `FetchedMedia` (type MIME, taille, flux ou URL temporaire).

   La traduction depuis les formes de la plateforme reste dans l'infra de chaque adaptateur, avec ses propres schémas Zod.

3. **Garde d'écriture** : `ConnectorConfigSchema` reçoit `writes: boolean`, `false` par défaut. Tant qu'elle vaut `false`, le module `connectors` refuse toute écriture avant l'appel réseau. Le refus est un échec définitif (`SendRefused` « connector_writes_disabled », sans nouvel essai). Le `FakeConnector` des tests et de l'e2e passe `writes: true` explicitement. Seul Charles active l'écriture d'un compte réel.

   La garde est livrée par P0-07b (#40, `application/outbound-sender.ts`) pour les envois existants. Les nouvelles écritures de cette ADR (`sendScriptStep`, `setFanNote`) lèvent la même erreur depuis le même point d'entrée (`run(…, writes: true)` dans `outbound-sender.ts`), jamais par un second contrôle à part. Elle s'ajoute au kill switch, elle ne le remplace pas.

4. Les **adaptateurs existants** déclarent les nouveaux drapeaux à `false` (`FakeConnector` compris) ; le drapeau est testé avant l'appel, jamais l'existence de la méthode seule. Ce contrôle vit dans un seul helper de l'application du module `connectors`, qui lève `ConnectorUnavailable` si le drapeau est faux ou si la méthode manque ; il n'est pas répété chez chaque appelant.

5. **Scripts déjà envoyés à un fan : la plateforme fait foi.** Reveal indique quand un script a déjà été envoyé ou utilisé avec un fan (Charles, 17/10). `getScriptHistory` lit cet indicateur, et c'est notre seule source : nous ne tenons pas d'historique parallèle qui pourrait diverger. La forme exacte de l'indicateur (par script ou par étape) sera arrêtée d'après la capture.

   Avant tout `sendScriptStep`, le cœur relit cet historique. Une étape déjà envoyée au fan ne repart jamais : la règle est dans le code, pas dans le prompt. Le média déjà vendu reste protégé par `media_sends`. Une plateforme qui n'aurait pas cet indicateur déclarerait `scriptHistory: false`, et l'appelant refuserait alors d'envoyer des scripts plutôt que de deviner.

   Un échec de `getScriptHistory` (erreur, session expirée, réponse illisible) signifie qu'aucune étape n'est envoyée : on ne vend jamais à l'aveugle. Le doublon immédiat (rejeu d'un même envoi) n'est pas couvert par l'indicateur de Reveal, qui peut arriver en retard : il est couvert par la clé d'idempotence de `sendScriptStep`.

## Conséquences

Positives :
- L'agent a le contexte d'un chatteur (notes, statistiques, scripts) sans qu'aucune notion Reveal ne remonte dans le cœur.
- Une nouvelle plateforme n'implémente que ce qu'elle sait faire.
- Brancher l'adaptateur Reveal ne peut plus écrire chez un fan par accident.

Négatives :
- « Seul Charles active l'écriture » se fait aujourd'hui à la main en base (`docs/runbooks/local-dev.md`) : un réglage audité dans le CRM devra suivre.
- Le port grossit. Chaque méthode ajoutée doit avoir un cas dans le test de contrat commun, joué au minimum contre FakeReveal.
- `ConnectorCapabilitiesSchema` est un objet fermé : chaque nouveau drapeau touche tous les adaptateurs.

À surveiller :
- Les signatures exactes (pagination, portée des notes, forme des étapes) seront arrêtées d'après la capture (`docs/reference/reveal-api-observed.md`), avant le passage en `accepted`.
- Les fichiers téléchargés par `fetchMedia` relèvent de la politique média (stockage, durée de rétention), qui n'est pas tranchée ici.

## Alternatives rejetées

- **Un second port `PlatformCrm` à côté de `PlatformConnector`.** Il faudrait deux fabriques, deux sessions à résoudre et deux tests de contrat pour un même compte et une même session. Le gain de séparation est faible.
- **Méthodes propres à Reveal exposées au cœur.** Cela contredit l'ADR 0003.
- **Garde d'écriture dans les prompts ou dans le moteur de vente seulement.** Cela contredit la règle 3 (les règles métier vivent dans le code, au plus près de l'effet). La garde doit tenir même si un autre appelant écrit.
