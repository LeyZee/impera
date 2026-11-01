# Suivi enrichi, page Ventes et mémoire du fan corrigible
Statut : proposed (ID à donner par Charles ; née de l'étude de Desirely du 27/10)
Phase : 4 (supervision)
Dépend de : `PROPOSED-tracking-reader.md` (lecteur), P3-12 (note de désir), P6-01 (`script_runs`, `sales`), P3-02 (mémoire du fan), ADR 0018, 0023, 0024
Branche : task/<id>-tracking-sales

## Objectif
Dans le Suivi, voir d'un coup d'œil où en est chaque fan sans alourdir la liste, et agir sur plusieurs conversations à la fois ; une page Ventes dit qui a vendu quoi, l'agent ou un humain ; la mémoire du fan se corrige à la main sans diverger de la note Reveal.

## Contexte à lire
`apps/web/src/screens/tracking/view.ts` (`tr-layout`), `PROPOSED-tracking-reader.md`, P3-12, P6-01, le module `fans` (`readProposedFacts`), ADR 0018 (la note Reveal fait foi), ADR 0023 (la créatrice ne voit ni conversation ni fan), ADR 0024 (rails), ADR 0025, `docs/design/README.md`, `docs/reference/desirely-analysis.md` (§ Conversations, § Transactions).

## Ce que fait Desirely
Page Conversations : colonnes Désir (neutre, joueur, acheteur), Scripts « x / y », dernier message, état de l'IA ; fiche du fan à droite ; sélection multiple pour couper ou rendre l'IA. Panneau Mémoire éditable. Page Transactions : date, fan, montant, script, étape, vendu par l'IA ou non.

## À faire
- [ ] **Liste du Suivi** : elle garde ses deux lignes (nom, puis sous-ligne) et ne gagne qu'une donnée, la bande de désir en mot (P3-12 : neutre, joueur, chaud), qui dit déjà presque ce que dirait une phase. Elle tient avec le lecteur à droite et à 400 px.
- [ ] **Fiche du fan du lecteur** : la phase, calculée par une règle pure côté serveur à partir du curseur de sexualisation et des `script_runs` de P6-01 (découverte, sexualisation, vente, après-vente) ; les scripts vus sur les scripts proposables ; le total dépensé ; la prochaine étape prévue (relance, script, attente) ; le lien vers la conversation Reveal (lien sortant, avec son icône). Une vue « Tableau » sur bureau seulement peut les reprendre en colonnes, si Charles la veut.
- [ ] **Actions en masse** (propriétaire et manager) : rendre la main, reprendre, mettre en pause l'agent, marquer comme traité ; une action, une ligne de journal par conversation, rejouable. La sélection est une lumière neutre (`select`), jamais du néon ; la barre d'actions flotte en verre (`nv-glass--float`, le seul verre de l'écran) et donne le compte (« 3 conversations ») ; « Mettre en pause l'agent » se confirme, sans rouge.
- [ ] **Mémoire du fan corrigible** : corriger, ajouter ou retirer un fait, avec auteur et date. Deux règles :
  - entre Nirvana et le cerveau, l'humain gagne : un fait `declared` posé par un humain n'est jamais remplacé par un fait proposé par le cerveau sur la même clé (`readProposedFacts`, module `fans`) ;
  - entre Nirvana et Reveal, Reveal gagne (ADR 0018) : la correction est écrite dans la note Reveal dans la même action (`setFanNote`, derrière `connector_config.writes`), et c'est la note relue qui fait foi ensuite. Une modification faite dans Reveal vient aussi d'un humain, elle n'a pas à être défendue. Tant que les écritures sont fermées pour ce compte, le bouton « Corriger » est remplacé par « Corriger dans Reveal », pour qu'aucune correction ne vive seulement chez nous.
- [ ] **Page Ventes** : une sous-vue du Dashboard, sans nouvel onglet (ADR 0024), dont l'onglet et l'adresse sont réservés au propriétaire (leçon de #217). Vente confirmée par la plateforme, créatrice, script et étape, auteur écrit en mot (agent, chatteur, inconnu, sans couleur par auteur), montant brut et net estimé en `sale` et en euros (ADR 0011) ; aucune vue chez la créatrice (ADR 0023).

## Critères d'acceptation
- Tests : action en masse rejouable sans double effet ; un fait humain n'est pas écrasé par le cerveau ; une correction part dans la note Reveal et la relecture la retrouve ; sans écritures ouvertes, aucune correction locale ; une créatrice ne lit ni Ventes ni Suivi.
- Écrans : Nuit et Jour, 1 440 et 400 px, mouvement réduit, état « Le serveur ne répond pas » ; zéro bruit (un seul rouge : ce qui attend un humain).

## Hors périmètre
Le calcul des commissions (Paie, EQ), les messages de masse, la note de désir elle-même (P3-12).

## Notes de session
