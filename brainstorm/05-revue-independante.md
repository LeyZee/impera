# 05 · Revue indépendante du dossier (16 octobre 2026, nuit)

Demande de Charles : « refais une review complète du dossier, dis-moi si on a une bonne base pour commencer ou s'il manque des choses au niveau métier ». Revue faite à froid par une session Opus 5.5, sans reprendre le verdict de la note 04 : chaque affirmation vérifiable a été vérifiée (outillage installé dans un bac à sable, règles ESLint exécutées sur des violations volontaires, `check-repo` testé sur une erreur provoquée).

## Verdict

**Oui pour lancer P0-01, non pour croire que la base est complète.**

- **Technique : bonne base.** Architecture claire, ADR cohérentes, fiches P0 précises, sécurité pensée en amont. Un agent codeur qui arrive à froid comprend quoi faire et dans quel ordre. Mieux que la plupart des projets réels à ce stade.
- **Mais l'outillage n'avait jamais tourné.** La note 04 disait les frontières « vérifiées par des outils » : c'était faux. `eslint.config.js` plantait au chargement, et une fois la syntaxe réparée, deux protections sur quatre restaient silencieuses (voir §1). Corrigé et prouvé dans cette PR.
- **Métier : la base est sous-spécifiée.** Le dossier décrit très bien comment un message circule, et très peu comment l'agence gagne de l'argent. Le parcours fan, la valeur d'un fan, les types de vente, l'historique existant sur Reveal et le reporting ne sont écrits nulle part. Ça ne bloque pas la phase 0 (plomberie), mais ça doit exister **avant les fiches P3**, sinon les sessions Opus inventeront la logique commerciale dans le code.

## 1. Vérifié par l'exécution (corrigé dans cette PR)

| Constat | Preuve | Correction |
|---|---|---|
| `eslint.config.js` ne se chargeait pas | ESLint 9 : « Value ["module-domain",{"module":"connectors"}] should be string », puis les regex de `boundaries/external` refusées | `from: [own(...)]`, motifs micromatch (`@ai-sdk/*`, `node:!(crypto)`) |
| Les règles de graphe ne voyaient rien | Une fois chargée, aucun import interdit entre modules n'était signalé (pas de résolveur TS pour boundaries) et, lancé depuis `apps/api` comme le fait turbo, même `node:fs` dans `domain` passait | `boundaries/root-path`, `import/resolver` typescript, dépendance `eslint-import-resolver-typescript` |
| `import-x/no-cycle` inopérant | Cycle volontaire entre deux fichiers : aucun signalement | `import-x/parsers` + `import-x/extensions` |
| Après correction | Les quatre violations de test sont signalées, depuis la racine et depuis `apps/api`, avec boundaries 5.4 et 7.2 ; l'import autorisé passe | — |
| `check-repo` ne contrôlait pas les fiches P0/P1 | Regex `[A-Z]+-\d+` : « P0-01 » ne matche pas. Ligne P0-03 retirée de l'index : 0 erreur | `[A-Z]+\d*-\d+` ; la même suppression donne maintenant 1 erreur |
| `check-repo` ne lisait pas les commandes des blocs de code (dont celui de `CLAUDE.md`) | lecture du code | regex étendue aux lignes `pnpm …` |
| `prettier --check .` rouge sur 9 fichiers suivis | exécution | `prettier --write` |
| Routes contradictoires | `api.md` listait `/v1/events` « hors `/v1` » ; `/connector/sessions` avec ou sans `/v1` selon le fichier ; `/auth/*` contre `/v1/auth/*` | une règle : tout sous `/v1` sauf `/health` et `/ready` |
| `.env.example` envoyait Langfuse vers le cloud | contredit `threat-model.md` (traces intimes, auto-hébergé) | URL locale et commentaire |
| Petites erreurs de fiches | P0-06 citait l'ADR 0004 pour les files série (c'est 0006) ; P0-02 citait un événement `fan_fact_recorded` hors liste fermée ; P0-05 et P0-07 retiraient tous deux `demo.echo` ; P0-01 affirmait que les fixtures étaient déjà ignorées (faux) ; `sessions/README.md` demandait `pnpm test` « avec Docker » (c'est `test:all`) et son exemple de journal décrivait une P0-03 qui n'existe pas | corrigés |

Pièges notés dans P0-01 sans les trancher (c'est son travail) : `prepare: lefthook install` échoue hors dépôt git, donc dans un build Docker ; pnpm 10 bloque les scripts d'installation (`esbuild`, `lefthook`, `unrs-resolver`) ; `tsconfig.base.json` est en `NodeNext` alors que la fiche propose `bundler` ; `turbo` fait dépendre `typecheck` et `test` d'un `^build` inutile ; `pnpm up --latest` fait passer boundaries en 7.x (syntaxe dépréciée, à migrer avec le test de frontières comme filet).

## 2. Manques métier, par gravité

### Bloquants avant les fiches P3 (à écrire avec Charles et Messa)

1. **Parcours fan et valeur d'un fan.** Rien ne décrit les étapes d'un fan (nouveau, qualifié, acheteur, régulier, dormant, perdu), ni sa valeur (total dépensé, dernier achat, panier moyen, signal de budget), ni ce qu'on en fait (prioriser l'inbox, adapter l'offre, relancer les dormants). `fans` n'a ni dépense cumulée ni étape. La politique d'offre s'appuie sur un « KYC minimal atteint » que personne n'a défini. → Proposition : `docs/reference/fan-journey.md` (parcours, KYC, segments) + colonnes de projection sur `fans`. Fichiers : `data-model.md`, `ai-engine.md` §Politique, `persona-schema.md` §kyc.
2. **KYC : à quoi sert chaque slot.** Les slots du placeholder (`first_name`, `city`, `occupation`, `relationship`, `what_he_likes`, `budget_signal`) n'ont pas de « pour quelle décision ». Sans ça, le cerveau pose des questions pour poser des questions. Il manque aussi la règle de l'âge : rien ne dit si Reveal vérifie l'âge des fans (question à ajouter à P1-02) ni ce que fait le bot d'un doute. Fichiers : `persona-schema.md`, `connectors.md` §questions.
3. **Historique existant sur Reveal.** Le jour où le connecteur démarre, Messa a déjà des fans avec des mois de conversation et des achats. Rien ne prévoit de les importer : le bot repartirait d'une mémoire vide et l'anti-doublon (`media_sends`) laisserait revendre un média déjà acheté. → Ajouter aux questions de P1-02 « peut-on paginer tout l'historique et les achats passés ? » et une fiche P2 d'import initial (messages, ventes, faits de départ).
4. **La vente arrive trop tard.** Roadmap : copilote en P3, supervision P4, auto + PWA P5, **commerce P6**. Pendant trois phases, le bot discute sans vendre, alors que le revenu de l'agence, c'est le PPV. → Proposition : une vente minimale en P4 (quelques médias décrits à la main, prix fixe, anti-doublon, détection de vente), l'échelle de prix et les scripts restant en P6. Décision de Charles.

### Importants (avant P4 ou P6)

5. **Types de revenus absents.** Seul le PPV en message est modélisé. Manquent : pourboires, **customs** (demande personnalisée que Messa doit produire : prix, délai, à-faire dans sa PWA), notation de photos de fans (service payant classique, qui est justement l'usage métier de l'analyse des médias fans), **messages de masse** vers un segment (premier levier de CA sur OnlyFans), remboursements et contestations. Fichiers : `data-model.md` §Commercial, `media-vocabulary.md` §Usage, `roadmap.md` P6.
6. **Attribution des ventes et équipe.** IMPERA paie des chatteurs à la commission. Si le bot et un humain se partagent une conversation, qui a vendu ? Rien ne le dit (`drafts.decided_by` existe, pas d'attribution sur `sales`). L'ADR 0012 parle de « seuls utilisateurs Charles et Messa » alors que le rôle `operator` existe : il faut dire si les chatteurs de l'agence utiliseront Nirvana, avec quelles règles de répartition des conversations.
7. **Reporting métier.** `operations.md` liste des métriques techniques (latences, doublons, coût LLM). Rien sur ce que Charles et Messa regardent : CA par jour et par fan, conversion PPV (proposé / acheté), revenu par conversation, nouveaux fans, top fans, bot contre humain, coût LLM rapporté au CA. → Une section « Métriques métier » dans `operations.md` avant la fiche P4 du dashboard.
8. **OnlyFans n'est dans aucune phase.** Messa est aussi sur OnlyFans ; le port le permet, la roadmap ne le place nulle part (P7 = Instagram). À trancher : où vient OnlyFans par rapport à Instagram ?
9. **Rôle de Messa.** Qui valide la persona, les limites dures, les droits d'usage des médias, la note de qualité des évals (« seuil fixé avec Messa ») ? Le cahier dit « avec son accord » ; aucun circuit ne le décrit. Une ligne par point dans `sessions/README.md` §Rôles suffirait.
10. **Rapidité contre réalisme.** Le cahier vise moins de 2 minutes ; la persona autorise jusqu'à 15 minutes de première réponse, plus 30 à 90 s de debounce. Les deux sont défendables (vitesse = ventes, lenteur = crédibilité), mais il faut choisir, éventuellement selon la valeur du fan.

### Secondaires

11. **Persona réelle.** Placeholder seulement ; la vraie est « hors dépôt » sans dire où ni comment elle est construite (entretien avec Messa, corpus de vrais messages anonymisés pour calibrer la voix). Sans elle, les évals P3 ne mesurent rien.
12. **Langue des fans.** Tout est en français, la garde « langue attendue » bloque le reste. Si des fans écrivent en anglais, que fait-on ?

## 3. Sécurité et conformité

- **RGPD absent des docs** (zéro occurrence). Les faits intimes et les photos de fans sont des données sensibles au sens de l'article 9 ; elles partent chez xAI (États-Unis). La minimisation et la rétention sont bien pensées, mais il manque une page : base légale, registre des traitements, contrats de sous-traitance (xAI, Neon, Sentry), information des fans. À faire relire par un juriste avant la production, pas avant P0.
- **Rôle `nirvana_admin` et RLS** : avec `FORCE ROW LEVEL SECURITY`, le propriétaire des tables est soumis aux politiques sauf s'il a `BYPASSRLS`. En dev il est superutilisateur (Docker), donc tout marche ; en prod sur Neon, ça dépend de la façon dont le rôle est créé. Les jobs `*Unscoped` pourraient voir zéro ligne en prod. → P0-03 doit écrire `BYPASSRLS` explicitement et le tester sans superutilisateur.
- **Schéma Graphile Worker** : le worker installe ses tables au démarrage ; avec `nirvana_app` (sans droit `CREATE`), ça échoue. Aucune fiche ne dit avec quel rôle il migre. → P0-04.
- **Distributeur de l'outbox** : P0-05 écrit dans `domain_events`, aucune fiche ne crée le job qui les distribue (et son curseur). Pas bloquant en phase 0, mais il doit avoir un propriétaire avant P4.
- **Déjà signalé, toujours ouvert** : secrets d'Imperium à révoquer ; CGU Reveal non lues. Le second est le vrai risque existentiel : un bannissement du compte de Messa coûte plus cher que tout le reste du projet.
- **Décisions de Charles, rappelées sans les rediscuter** : l'ADR 0012 consigne déjà l'AI Act (art. 50) et la clause de transparence de xAI ; la conséquence pratique est que le repli de la voix (Venice, Mistral) doit être prêt dès P3, pas « si besoin ». Le cahier dit encore « ne pas exporter les cookies vers un serveur tiers » alors que l'option B le fait vers notre propre serveur : cohérent avec la décision, mais le cahier à la racine est périmé sur ce point (il est historique, les ADR priment).

## 4. Qualité et hygiène

- `check-repo --strict`, que H-01 doit lancer, transforme en erreur tous les chemins futurs cités par les docs (45 aujourd'hui) : il faut un moyen de distinguer « prévu » de « cassé » (liste des chemins prévus par fiche, ou marqueur), sinon H-01 ne peut pas passer.
- Commandes citées sans fiche qui les crée : `pnpm ops:reencrypt-sessions` (runbook de rotation), `erase-fan` (« dès la phase 2 »), `pnpm persona:validate` et `persona:load` (P3). À rattacher aux fiches P2/P3 quand elles seront écrites.
- La politique de nettoyage est écrite et en partie outillée (`check-repo`, `knip`, hooks) ; elle n'a jamais tourné pour de vrai, puisque rien n'a été installé avant cette revue.

## 5. Ordre recommandé

1. **Charles, maintenant** : obtenir l'accès créatrice Reveal et lire les CGU (chemin critique : tout le produit dépend de la faisabilité de l'option B) ; révoquer les secrets d'Imperium.
2. **P0-01**, puis **P1-01 en parallèle de P0-02** : on lève le risque Reveal tôt, la phase 0 n'est pas perdue si l'option C l'emporte.
3. **Avant d'écrire les fiches P3** : une séance avec Charles et Messa pour produire `fan-journey.md` (parcours, KYC, segments, valeur), la liste des types de vente et les métriques métier. C'est une demi-journée de discussion qui évite des semaines de code à refaire.
