# INS-03 « Mes liens » chez la créatrice : ses liens de redirection, leur phrase d'usage, un bouton Copier
Statut : todo
Phase : Instagram (ADR 0121)
Dépend de : ADR 0121 acceptée ; l'endroit d'un lien (ADR 0120 § 3, migration partagée avec INS-02)
Branche : task/ins-03-creator-links-screen
Propriétaire : fil Instagram ; relecture Design (écran de la créatrice) et Bilan (migration, route)

## Objectif
La créatrice ouvre « Mes liens » sur son téléphone, lit à quoi sert chaque lien et le copie d'un geste.

## Contexte à lire
ADR 0121 § 1, ADR 0120 § 3, ADR 0080 § 4, ADR 0042, `packages/contracts/src/telegram-channel.ts`, `apps/web/src/creators/telegram/`.

## À faire
- [ ] Migration nouvelle et additive sur le lien de redirection : endroit (`NULL` pour les liens existants) et phrase d'usage (120 caractères au plus, jamais d'adresse).
- [ ] Contrats Zod : phrase d'usage, carte de lien montrée à la créatrice (nom, endroit, phrase, adresse).
- [ ] Agence : endroit et phrase d'usage réglables dans l'écran des liens de redirection ; un lien existant affiche « à renseigner ».
- [ ] Créatrice : route de lecture de ses seuls liens actifs qui ont un endroit, ordre des endroits (story du jour d'abord).
- [ ] Écran « Mes liens » téléphone d'abord : une carte par lien, bouton Copier avec retour visible, aucun chiffre.
- [ ] Captures Nuit/Jour, téléphone et PC, vues par Design puis par Charles avant fusion.

## Critères d'acceptation
- Une créatrice ne lit jamais les liens d'une autre (test d'isolation) ; route nouvelle : authentication-sweep, origin-sweep.
- Un lien sans endroit ou éteint n'apparaît pas ; une phrase d'usage qui contient une adresse est refusée.
- Aucune adresse ni domaine réel dans un test, une fixture ou une doc.

## Hors périmètre
Le rattachement à un lien de suivi, les paliers, l'écran « Trafic » et le récap (fiches suivantes de l'ADR 0121) ; le rappel de story.

## Notes de session
