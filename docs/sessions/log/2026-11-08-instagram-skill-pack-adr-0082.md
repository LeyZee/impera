# 2026-11-08 — ADR 0082 : ce qu'on reprend d'un paquet de skills Instagram — proposed

**Session** : `claude/blissful-babbage-r9hlj2` · **Ordre** : Charles, 08/11 (« voici un dépôt skills que j'ai trouvé sur internet […] est-ce que ça peut t'aider pour la stratégie », puis « Et bien vas y 👌 »)

## Fait

- Analyse du paquet public `Jakeschincariol/instagram-agent-skill` (MIT, 13 skills, 5 scripts Python ; lu sans être exécuté ni installé). Pas à installer : en anglais seulement, son correcteur de « ton IA » existe déjà chez nous en français et dans le code (`AI_TICS`, caractères invisibles), son entonnoir est interdit par l'ADR 0057 § 6, sa recherche de viraux fait piloter un navigateur par un agent (ADR 0060 § 1).
- ADR 0082, `proposed` : la médiane du compte au lieu de la moyenne et l'écart visible par l'agence (§ 1) ; la fenêtre visible d'une légende Instagram, vérifiée pour le modèle, montrée à tous, jamais bloquante pour une personne (§ 2) ; la fiche reel dessinée chez la créatrice et écrite à la main par l'agence dès maintenant (§ 3) ; ce qui n'est pas repris (§ 4).
- Trois fiches `proposed` : `PROPOSED-standout-median.md` (ID proposé VEI-07), `PROPOSED-reel-brief.md` (VEI-08), `PROPOSED-caption-window.md` (PUB-03).
- Glossaire : écart (`standout`), fenêtre visible (`caption_window`), fiche reel (`reel_brief`). Index des ADR.

## Pas fait

- Aucun code : l'ADR 0082 contredit la lettre de l'ADR 0060 § 2 (« moyenne »), donc rien ne s'implémente avant l'accord de Charles.
- Les fiches VEI-03, VEI-06 et PUB-02 ne citent pas encore l'ADR 0082 : à ajouter à son acceptation, avec les ID et l'index des fiches.

## Découvertes

- Aucun code ne transforme un relevé de l'extension en signal (source 6 de l'ADR 0060) : `standsOut` n'est appelé que par son test, et seuls les liens collés écrivent dans `trend_signals`. La veille faite à la main ne nourrit donc encore aucune idée. Repris dans `PROPOSED-standout-median.md`.
- La coupure d'une légende de Reel n'est documentée nulle part par Meta (55 à 125 caractères selon les sources, recherche du 08/11) : à mesurer sur un téléphone à la recette de PUB-02.

## Candidats à suppression

- Aucun.

## Vérifié

- `pnpm check` (voir la PR). Docs seulement.
