# P6-01 Catalogue tarifé : index des scripts Reveal, de leurs étapes et de leurs bundles
Statut : todo
Phase : 6
Dépend de : P3-02, P1-02, P1-03
Branche : task/p6-01-sales-catalog

## Objectif
Donner à l'agent le catalogue qu'il vend tel qu'il existe sur Reveal. Le bot n'envoie que des scripts Reveal, et chaque étape d'un script contient un bundle préparé à l'avance (Charles, 17/10 à 18h18) ; il n'envoie jamais un média isolé. Le catalogue est donc l'index de ces scripts, de leurs étapes et de leurs bundles : prix, moment jour ou nuit, médias, et une description de chaque média que l'agent peut raconter au fan. Aucun script n'est rejoué à un fan, aucun bundle ne lui est revendu.

## Contexte à lire
`docs/architecture/data-model.md` (§ Médias, § Commercial), `docs/reference/media-vocabulary.md`, `docs/architecture/ai-engine.md` (§ La politique, point 5), `docs/reference/onlychat-analysis.md`, `docs/roadmap.md` (phase 6). Besoin métier : messages de Charles du 17/10 à 17h18, 17h52, 18h01 et 18h18, `/mnt/project-files/chatting/methode-chatting.md` §2.3, §3 et §6, `/mnt/project-files/onlychat/README.md` §2 (hors dépôt ; la remise unique du §4 est supprimée).

## Ce qui existe
Conçus : `media_assets`, `media_descriptions` (rôle `sense`, vocabulaire fermé, `factual_description` en texte libre), `media_sends` (anti-doublon par fan, avec le prix). Réservés sans conception : `offers`, `sales`, `scripts`, `script_steps`, `script_runs`, `cards`. Le principe est acté : les prix sont tenus par le code, jamais par le prompt. Ce que montre l'inventaire de Reveal (PR #15) : les scripts sont natifs, un bundle est un PPV, et rien n'indique qu'un script a déjà été envoyé à un fan. La forme exacte des scripts et des bundles dans l'API n'est pas connue avant P1-02.

## Proposition (validée par Charles le 17/10 à 18h35)
- **Source** : les scripts se créent et se modifient dans Reveal, pas dans Impera. Le connecteur les lit (capacité `listScripts`, à confirmer en P1-02) et le module `scripts` tient un index synchronisé ; un script disparu de Reveal est désactivé, jamais supprimé.
- `scripts` : `id`, `creator_id`, `platform_script_id` (unique par compte), `name`, `moment` (`day` | `night` | `any`), `active`, `synced_at`.
- `script_steps` : `script_id`, `rank`, `kind` (`teaser` gratuit | `bundle` payant), `bundle_id`, `caption` lue dans Reveal (la voix écrit le texte autour, jamais à la place).
- `bundles` (remplace `offers`) : `id`, `creator_id`, `platform_bundle_id`, `price_minor`, `currency`, `media_asset_ids[]`, `moment`, `intensity` (calculée depuis les descriptions).
- **Prix** : lu dans le bundle Reveal, jamais choisi ni annoncé autrement par le LLM. Aucune remise, on ne négocie jamais (méthode de chatting, §3). À l'import, le code signale un script dont une étape coûte plus du double de la précédente (tripler a coupé net chez l'ancien bot) ou dépasse 40 $ ; c'est un avertissement à Charles, pas un blocage.
- **Moment** (Charles, 17/10 à 17h52) : Reveal range scripts et dossiers du Vault en « Jour » ☀️ et « Nuit » 🌙. La politique ne propose qu'un script dont le moment correspond à l'heure locale du fan (fuseau tiré du slot `location`, sinon celui de la créatrice). Les heures qui bornent le jour et la nuit sont un réglage de la créatrice.
- **Description par média** (Charles, 17/10 à 18h01) : l'agent doit pouvoir dire ce qui se passe dans un média quand un fan le demande, pour donner envie d'acheter. Chaque média d'un bundle a une fiche média, produite à l'import par le rôle `sense` (`media_descriptions`) et reliée à l'étape de script qui l'envoie. Pour une vidéo, elle dit ce qui se passe et à quel moment, la tenue, le lieu, jour ou nuit, ce qu'on voit et ce qu'on ne voit pas. Charles ou Messa la relisent une fois (`validated_by`, `validated_at`, correction éventuelle), et Messa peut y ajouter son ressenti dans un champ libre (`creator_note`), que la voix reprend pour des réponses plus vraies (comparatif des modèles, §8, `/mnt/project-files/modeles-ia/comparatif-modeles.md`). Un script n'est proposable que si tous les médias de ses bundles ont une description validée ; la voix ne décrit un média qu'à partir de cette description, jamais de son imagination.
- **Accès aux médias (question ouverte)** : pour décrire un média, il faut le récupérer depuis Reveal, vidéos comprises. Pistes : import des originaux par le dashboard (le plus simple, ne dépend pas de Reveal ; le média importé est relié au bundle Reveal qui le contient) ; téléchargement par la session capturée (P1-02 dit si l'API expose une URL du fichier) ; capture par l'extension au moment où Charles ouvre le Vault. Côté vision, une vidéo se décrit par images clés et transcription si le modèle ne lit pas la vidéo entière (sujet du fil « Meilleur modèle »). Le fichier sert à la description puis n'est pas gardé, sauf décision contraire (ADR à écrire).
- `script_runs` : `(fan_id, script_id)` unique, la garantie qu'un script n'est jamais rejoué au même fan. Reveal n'ayant pas d'indicateur « déjà envoyé », c'est Impera qui le tient, en partant des envois passés relus à l'import.
- `sales` : `id`, `creator_id`, `fan_id`, `bundle_id` (nullable si inconnu), `amount_minor`, `currency`, `platform_transaction_id` (unique), `detected_at`. Source : `listTransactions` du connecteur ou détection dans les messages.
- Règles en code (politique et gardes) : seul un script peut partir, jamais un média seul ; prix toujours celui du bundle ; aucune remise ; un bundle déjà acheté par ce fan n'est jamais reproposé ; un média n'est annoncé que s'il part réellement ; pas de script si la mémoire du fan l'interdit (drapeaux, âge non confirmé, cooldown de `persona.strategies.script_launch`) ; notification « plus de script » quand tous les scripts actifs ont été joués à ce fan.
- Historique par fan : `script_runs` + `media_sends` + `sales`, exposés par le module `fans` (`playedScriptIds`, `sentMediaIds`, `purchaseSummary`).

## À faire
- ADR « Catalogue = index des scripts Reveal » et ADR « Récupération et conservation des médias ». La seconde tranche la question ouverte de l'accès aux médias ; elle se décide avec Charles avant d'écrire ce code.
- Contrats, schéma Drizzle et migration (`scripts`, `script_steps`, `bundles`, `script_runs`, `sales`, validation de `media_descriptions`), synchronisation par le connecteur contre `FakeReveal`, règles de politique, tests.
- Les vrais scripts, bundles et prix de Messa restent hors dépôt (ADR 0010) ; les tests utilisent un catalogue fictif.

## Critères d'acceptation
- Tests du domaine : script de nuit refusé à 15 h chez le fan, script refusé tant qu'une description n'est pas validée, script jamais rejoué, bundle jamais revendu, média seul jamais envoyé, prix toujours celui du bundle, avertissement à l'import pour un palier ×3 ou au-dessus de 40 $.
- Test du connecteur contre `FakeReveal` : un script modifié dans Reveal est resynchronisé, un script supprimé est désactivé.
- Évals : fan qui refuse le prix, fan qui demande « c'est ton prix le plus bas ? », fan qui demande ce qu'il y a dans la vidéo, fan qui a déjà tout acheté.

## Hors périmètre
Création ou modification de scripts depuis Impera, génération de la description par le rôle `sense` (déjà conçue ; seuls l'import et la validation entrent ici), lecture des médias envoyés par les fans (rôle `sense`, autre fiche), interface du catalogue.

## Notes de session
