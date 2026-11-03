# Poste du chatteur en copilote, dans l'extension sur Reveal : l'interface (ID à attribuer)
Statut : proposed (décision de Charles le 17/10 à 21h44, recommandation du coordinateur ; à coder après la clé xAI et la capture Reveal)
Phase : 3
Dépend de : `docs/sessions/tasks/PROPOSED-copilot-api.md` (fil Bilan : contrat `copilot.ts`, routes, notes `live`), capture HAR Reveal (P1-02), lot A Reveal
Branche : task/<id>-copilot-extension

## Objectif (1 phrase)

Le chatteur voit le brouillon de l'agent à côté de la conversation Reveal ouverte et choisit Envoyer, Retoucher ou Refuser avec une raison, sans quitter Reveal.

Le côté serveur (brouillon en attente, verdict idempotent, note de calibrage `live`, rapprochement avec le message sortant) est dans la fiche « Copilote côté API » ; cette fiche ne le redéfinit pas. Elle couvre l'extension et ce qu'elle demande au contrat.

## Contexte à lire

- `docs/sessions/tasks/PROPOSED-copilot-api.md` (fil Bilan), en entier : l'envoi par défaut, le verdict, les routes.
- `docs/design/README.md` : « Copilote et raccourcis », « Extension Chrome » (rien de stylé injecté dans la page Reveal), « Clarté ».
- `packages/contracts/src/playground.ts` : verdicts et raisons de refus, les mêmes qu'au playground.
- `apps/extension` (WXT), ADR 0008 (session capturée par l'extension), ADR 0012 (`identity_policy`).

## Comment ça se passe pour le chatteur

1. Il ouvre une conversation dans Reveal. Le panneau latéral de l'extension montre le brouillon de l'agent pour ce fan, ou « L'agent n'a rien proposé pour ce fan ».
2. **Envoyer** (`a`) : l'extension place le texte dans le champ de saisie de Reveal ; le chatteur relit et appuie lui-même sur Envoyer dans Reveal. L'agent n'envoie rien pendant cette phase et la garde d'écriture reste fermée (fiche API).
3. **Retoucher** (`e`) : édition en place dans le panneau, puis même chemin qu'Envoyer, verdict `corrected` avec les bulles finales.
4. **Refuser** (`r`) : raison en puces (liste fermée du playground) et note libre facultative ; rien n'est placé dans Reveal, le chatteur écrit sa propre réponse.
5. Le panneau passe à « Envoyé » quand l'API a rapproché le message sortant du brouillon, pas au clic.

## Accordé avec le fil Bilan (17/10)

- **Qui valide** : la session `operator` ou `owner` du chatteur, comme dans le CRM (`requireRole`) ; la note de calibrage porte donc le membre. Pas de jeton d'appareil sur les routes `copilot` : il reste réservé à la capture de session. L'origine `chrome-extension://<id>` entre dans les origines de confiance de Better Auth et dans le CORS, avec les routes (fil Bilan). Le panneau demande la connexion une fois.
- **Placer le texte dans Reveal** : le script de contenu écrit dans le champ de saisie, sans style ni clic simulé sur Envoyer, à confirmer par la capture. Repli accepté : copie dans le presse-papiers et « Colle dans Reveal ». Le rapprochement avec le message sortant se fait côté API.
- **Mise à jour du panneau** : interrogation de la route brouillon toutes les 5 s tant que le panneau est visible ; pas de flux SSE pour l'instant.
- **Raisons de refus** : la liste fermée du playground, déjà dans `@impera/contracts`.
- **« Envoyé »** : le panneau ne le dit qu'une fois le rapprochement lu sur la route brouillon, jamais au clic.

## À faire (liste vérifiable)

1. Panneau latéral WXT (`entrypoints/sidepanel`, `chrome.sidePanel`), design system importé (`@impera/design-system/styles.css`).
2. Connexion du chatteur dans le panneau, puis détection de la conversation Reveal ouverte (URL ou requête observée, d'après la capture) et appel de la route brouillon.
3. Brouillon affiché bulle par bulle, avec ce que l'agent sait du fan en une ligne ; trois gestes et leurs raccourcis, communs au playground.
4. États, en mots de chatteur : aucun brouillon, l'agent écrit, à valider, envoyé, un humain doit répondre (raison en mots), session Reveal expirée.
5. Tests : unitaires sur la logique du panneau ; détection de conversation et placement du texte contre `FakeReveal` ; aucun envoi réel.
6. Glossaire : « Poste du chatteur » si le terme est retenu (« Copilote » et « Verdict » viennent de la fiche API).

## Critères d'acceptation

- Contre `FakeReveal`, un chatteur connecté place, retouche ou refuse un brouillon depuis le panneau ; le verdict part une fois (rejeu sans effet) et le panneau ne dit « Envoyé » qu'après le rapprochement.
- Aucun style ni aucun élément injecté dans la page Reveal ; aucun clic simulé sur Envoyer.
- L'extension ne porte aucune clé LLM.
- `pnpm check` et `pnpm test:all` verts.

## Hors périmètre

- Les routes, le contrat et la migration (fiche API du fil Bilan).
- Le mode Automatique et son verrou (contrôle unique de la barre du CRM).
- Les vocaux.
- Toute écriture vers un vrai fan avant l'accord explicite de Charles.

## Notes de session
