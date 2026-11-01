# Module `agent`

**Rôle.** Pipeline sens → cerveau → politique → voix → gardes. Produit un `DraftProposal` à partir d'un `ConversationContext`.

**Peut dépendre de.** fans, persona, media, packages/llm

**Règles propres.** Pas d'I/O plateforme, pas d'écriture en base hors `llm_calls` (via packages/llm). Les règles commerciales et les gardes vivent ici, en code, testées unitairement.

## Composeur

`startDraftComposer` répond à `conversation.respond` (port `DraftComposer` de `conversations`, reconnu par sa forme : `agent` n'importe pas `conversations`). Même chemin que le playground (`composeTurn` : cerveau, voix, gardes), avec les réponses corrigées au playground comme exemples de voix. Il n'envoie jamais rien : un brouillon attend toujours un humain.

Persona (recette 28/10, G4 ; ADR 0010, 0022) : chaque brouillon et chaque relance s'écrivent avec la version **active** de la persona de la créatrice de la conversation, lue en base à chaque message par le port `ActivePersonaSource` (`persona.versions.active`, câblé par la racine de composition) : fiche, nom, limites d'offre et de sexualisation, mots d'alerte, esprit des relances. Rien n'est gardé en mémoire. Elle est lue après ce que la sécurité lit sans elle (limites du fan, médias). Sans version active, rien n'est écrit et la main passe à un chatteur (`handoff`, cause `persona_inactive`, détail `persona_inactive`) ; une version qui ne se lit plus fait de même (détail `persona_unreadable`) ; jamais une autre persona, jamais celle de démonstration. Une relance sans persona active n'est pas écrite (`no_reply`, `follow_up_persona_inactive`), sans alerte. Lisent la même version, à chaque appel : les délais de relance (`startFollowUpPlan` : aucun sans elle), la garde rejouée à l'approbation (`startBubbleGuard`, port `BubbleGuard.forCreator` de `conversations` : sans version active, `null`, et rien n'est approuvé, en fail-closed) et « À apprendre » (`startKycSlots` : `null` sans elle, et `fans` montre alors toutes les cases). Seul le playground, banc d'essai, garde le fichier `PLAYGROUND_PERSONA_PATH`.

Retenue (`held`), décidée dans le code :

- `handoff` : média signalé, ou risque `minor_suspected`, `distress`, `self_harm` (`domain/hold.ts`), quoi que propose le cerveau, et avant tout appel à la voix ;
- `no_reply` : le cerveau dit d'attendre ;
- `budget_reached` : plafond du jour ; `llm_unavailable` : aucune clé de voix ou tous les modèles en échec ;
- `guard_blocked` : une garde bloquante sur la réponse écrite.

Limites du fan (P3-02, `fans` passé à `startDraftComposer`) : avant tout appel, un fan « ne plus écrire » (`doNotContact`) part chez un chatteur sans rien écrire (`do_not_contact`), comme un fan dont les limites ne se lisent pas (`limits_unreadable`). Sur un `handoff` dû à un risque, la politique pose elle-même ses limites (`protectionFor`, `domain/hold.ts`), auteur `system`, jusqu'à ce qu'un humain décide : un mineur présumé (`minor_suspected`, `possible_minor`) perd son âge confirmé ; la détresse ou une menace (`distress`, `self_harm`, `real_abuse`, `harassment`, `dangerous_request`, `weapon`) pose « ne plus écrire ». Rien n'est posé quand elle répond. Si l'écriture échoue, la main passe quand même, avec `limits_not_saved` dans le détail.

## Structure

- `domain/` : types, règles pures, machines d'état. Zéro I/O, zéro import de framework.
- `application/` : cas d'usage (commandes, requêtes, handlers de jobs). Orchestrent le domaine et les ports.
- `infra/` : implémentations (Drizzle, HTTP Fastify, jobs Graphile, clients externes).
- `index.ts` : **seule** porte d'entrée publique du module. Tout ce qui n'y est pas exporté est privé.

Voir `docs/architecture/modules.md` pour les règles communes et `docs/playbooks/add-a-module.md` pour en créer un.
