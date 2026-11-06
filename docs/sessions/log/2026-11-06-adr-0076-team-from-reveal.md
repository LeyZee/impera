# 2026-11-06 — ADR 0076 : l'équipe importée de Reveal après revue

**Session** : Bilan · **Branche** : `claude/project-thread-a8l1w6` · **Ordre** : coordinateur, sur l'idée de Charles (06/11, 17 h 45) et ses mots-clés « ok détection chatteurs », « ok prestataires-lien-seul », « ok invitation-manager » (17 h 53)

## Fait

- `docs/adr/0076-team-imported-from-reveal-after-review.md`, `proposed` : suggestions de lien (e-mail, puis nom), l'agent pour le membre « bot », personne pour les bots de clé, invitation par le propriétaire ou un manager (rôle `chatter`, barème du propriétaire, mot de passe redemandé), prestataires en lien seulement, garde contre soi-même, retrait sur Reveal = alerte, badge du nouveau venu.
- Index des ADR mis à jour.
- Hors dépôt : `/mnt/project-files/crm-api-reference.md` complétée avec les deux routes de liens de suivi de la doc recopiée par Charles le 06/11 ; le reste de la doc n'a pas changé depuis le 02/11.

## Reste

- « ok 0076 » de Charles, puis le code : Bilan (schéma, suggestions, routes, FakeReveal), Équipe (invitation, alerte), Extension (écran).

## Découvertes

- Les liens de suivi (`/v1/tracking-links`) ne sont pas lus par le connecteur : piste pour Médias / Veille (CA par lien Instagram ; remboursements non retirés).
