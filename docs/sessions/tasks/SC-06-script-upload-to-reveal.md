# SC-06 Téléverser un script dans Reveal, dans l'ordre
Statut : blocked (capture Reveal : coffre, dossiers, scripts natifs)
Phase : scripts (ADR 0056)
Dépend de : SC-03, SC-05, la capture Reveal, la garde d'écriture (ADR 0018)
Branche : task/sc-06-script-upload

## Objectif
À l'acceptation de l'agence, le connecteur crée le dossier du coffre, téléverse les fichiers un à un dans l'ordre des noms et crée le script natif ; une reprise repart de la position atteinte.

## Contexte à lire
ADR 0056 § 7, ADR 0018, ADR 0003, `docs/architecture/connectors.md`, `docs/reference/fake-reveal.md`, `docs/reference/reveal-connector-inventory.md` (Vault, Scripts).

## À faire
- [ ] Capacités facultatives du port (propriétaire des contrats et du module `connectors`) : créer un dossier, téléverser un média, créer un script natif ; `FakeReveal` d'abord.
- [ ] Envoi séquentiel, clé d'idempotence par fichier, garde d'écriture, ambre à la position atteinte, reprise.
- [ ] Bascule de la source : état du script au journal ; la médiathèque relit le dossier (ADR 0030 § 2).
- [ ] Effacement des originaux 30 jours après le téléversement.

## Critères d'acceptation
- Tests contre `FakeReveal` : ordre respecté, double acceptation sans double fichier, coupure au milieu puis reprise, garde fermée = rien ne part.

## Hors périmètre
Les Mass DM et le feed (CR-08, CR-11).

## Notes de session
