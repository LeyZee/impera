# VEI-07 Veille : les relevés deviennent des signaux, sur la médiane du compte, et l'agence voit l'écart
Statut : todo
Phase : veille (ADR 0060, ADR 0082 § 1)
Dépend de : VEI-01 (lots a à d, faits), VEI-02 (fait), ADR 0082 (acceptée le 08/11/2026)
Branche : task/vei-07-standout-median
Propriétaire proposé : Bilan (contrats, base, module, job) ; Extension (la ligne de l'écran « Idées du jour »)

## Objectif (1 phrase)

Les posts que l'extension relève deviennent des signaux quand quelqu'un les marque ou qu'ils ressortent de leur compte sur la médiane, et l'agence voit de combien (« 40 × ses vues habituelles »).

## Pourquoi maintenant

L'extension relève déjà (VEI-02), mais aucun code ne transforme un relevé en signal : la veille faite à la main ne nourrit encore aucune idée. Et la règle actuelle (`standsOut`, trois fois la **moyenne** des autres posts) rate le deuxième post viral d'un compte, parce que le premier gonfle la moyenne (exemple chiffré dans l'ADR 0082, Contexte).

## Contexte à lire

- ADR 0082 § 1, ADR 0060 § 2 (source 6) et § 4, ADR 0010 (aucune donnée réelle).
- `apps/api/src/modules/trends/README.md`, `domain/signals.ts` et son test, `infra/db/signal-store.ts`, `application/captures.ts` (qui lit les relevés marqués).
- `docs/architecture/jsonb.md` (le job trie sur l'écart : colonnes, pas jsonb).
- `apps/web/src/creators/ideas/IdeasSection.tsx` (la tendance citée, `iv-signal`).

## À faire (liste vérifiable)

### Lot a : Bilan

- [ ] **Domaine** : `standoutOf(post, others)` remplace `standsOut`. Médiane des autres posts du même compte (nombre pair : moyenne des deux du milieu) ; `STANDS_OUT_FACTOR` (3) et `STANDS_OUT_MIN_POSTS` (5) inchangés ; les vues, sinon les j'aime. Rend `{ figure, multiple, compared }` ou `null`. Le multiple est arrondi vers le bas ; médiane nulle : le post ressort dès un chiffre d'au moins un, avec `multiple: null`.
- [ ] **Contrat** : `TrendStandoutSchema` (`figure: 'views' | 'likes'`, `multiple: entier ≥ 3 | null`, `compared: entier ≥ 5`) ; `TrendSignalSchema.standout`, nullable.
- [ ] **Base** : trois colonnes nullables sur `trend_signals` (`standout_figure`, `standout_multiple`, `standout_compared`) avec leurs `CHECK` (toutes nulles ou toutes posées, sauf le multiple ; multiple ≥ 3 ; comparés ≥ 5). Nouvelle migration, numéro donné par la coordination à l'ouverture.
- [ ] **Job « relevés → signaux »** (source `passive_capture`) :
  - mis en file à chaque lot de relevés reçu (`POST /v1/trends/readings`), une clé de job par session de veille, de sorte qu'un seul attend à la fois ; rejouable ; écrit par `withAdmin` ;
  - un post **marqué** pour une créatrice devient un signal de cette créatrice, qu'il ressorte ou non (l'écart est posé s'il ressort) ;
  - un post **non marqué qui ressort** devient un signal de toute l'agence (`creator_id` nul), avec son écart ;
  - il compare le post aux autres posts du même compte relevés pendant la durée de vie d'un signal (14 jours), toutes sessions et toutes personnes confondues ;
  - texte court tiré du relevé : le compte, le son s'il est connu, le début de la légende ; le lien du post ; le format ; les chiffres ; jamais le média ;
  - un post déjà devenu signal (même créatrice, ou même agence, même code de post) n'en refait pas un : un signal ne se change pas, il expire ;
  - aucun appel au modèle, donc aucun budget, et aucune connexion sortante (étendre le test existant).
- [ ] README du module : la règle de la médiane, l'écart, le job, à la place de « dépasse nettement la moyenne ».

### Lot b : Extension

- [ ] **« Idées du jour »** : sur la tendance citée, l'écart en clair, à côté des chiffres déjà montrés, en `nv-num` : « 40 × ses vues habituelles », « 12 × ses j'aime habituels », ou « Nettement au-dessus de ses habitudes » quand la médiane était nulle. Rien quand le signal n'a pas d'écart. Pas de néon : ce n'est pas une action.
- [ ] Test du composant (les trois formes, et l'absence).

## Critères d'acceptation

- Tests du domaine : l'exemple de l'ADR 0082 (quatre posts à 10 000 vues et un à 1 000 000 ; un post à 400 000 ressort à × 40, ce que la moyenne ratait) ; nombre pair de posts ; médiane nulle ; moins de cinq posts comparables ; vues absentes, j'aime lus.
- Test d'intégration : un lot de relevés (comptes et chiffres inventés) donne un signal d'agence avec son écart pour le post qui ressort, un signal de créatrice pour le post marqué, rien pour les autres ; rejoué, rien de plus ; la créatrice ne lit aucun signal (RLS) ; aucune connexion sortante.
- `pnpm check` et `pnpm test:all` verts.

## Hors périmètre

- Les comptes de référence (VEI-06) et les statistiques de la créatrice (VEI-05) : ils appelleront `standoutOf` quand ils existeront.
- Le classement des signaux par écart dans la génération du matin (VEI-03, bloquée par la clé xAI) : sa fiche lit l'ADR 0082 § 1.
- La phrase d'aide sur la taille des comptes de référence (VEI-06).

## Notes de session
