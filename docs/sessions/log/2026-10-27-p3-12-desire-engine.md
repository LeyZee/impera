# 2026-10-27 — P3-12 Note de désir, part moteur — done
Fait :
- `agent/domain/desire.ts` : `desireScore` (signaux du cerveau, intention, sentiment, mesures du code, poids `desire-1`, bornes 0 et 100), `desireNow` (mi-vie de 90 min vers un plancher, à la lecture), `measureDesire` (longueur rapportée à sa médiane, vitesse, emojis suggestifs, messages à la suite). Bandes et seuils 40/70 pris des contrats (`desireBandOf`, `DESIRE_BAND_FLOORS`), signaux en liste fermée `DESIRE_SIGNALS` dans les contrats (dont `minor_suspected`, `age_disputed`, `frozen`) dont le cerveau tire sa liste, `before` à `null` avant la première note, rien d'écrit pour une première note à 0 (`desireMoved`), après les relectures de Bilan et d'Extension.
- `BriefSchema.desireSignals` (facultatif, liste fermée) et prompt du cerveau 1.7.0.
- Politique : `low_desire` remplace `not_sexualizing` dans `offerDecision` ; le seuil d'ouverture s'ajoute à `no_opening` dans `sexualizationDecision`.
- Persona : `min_desire_to_open` (20 à 70, défaut 40) et `min_desire` (50 à 90, défaut 70), facultatifs ; persona demo à 45 et 75.
- Composeur : `desire` en entrée (note stockée), `desire` en sortie seulement quand la note bouge, sur un brouillon comme sur un `held` ; jamais recompté.
- Playground (note dans la trace, retour en arrière compris), évals (`situation.desire`, deux attentes, trois scénarios `full`).
- Doc : `ai-engine.md` (Brief, politique 5 bis), `persona-schema.md`, fiche.
Pas fait :
- Contrat `ComposeInput.desire` et `ComposeResult.desire`, événement `desire_scored`, projection et migration 0022 : Bilan (#221) ; lecture du Suivi (note retombée, points de la courbe) : Bilan.
- Écrans (Suivi, lecteur, réglage des seuils) : Extension.
- Ligne de la note Reveal (après la capture) ; calibration sur le corpus.
Décisions :
- Le moteur compare à la note stockée retombée jusqu'à maintenant : un message qui ne la fait pas bouger n'écrit rien, et la retombée continue depuis l'ancien `desire_at`, ce qui garde la projection exacte.
- `busy_now` pèse −30 : un fan chaud qui dit être au travail sort de « chaud » sur ce seul signal.
- Test par combinaisons (480 contextes) plutôt qu'une nouvelle dépendance de tests par propriétés.
Découvertes : `counted` compare `desire_at` (horloge du serveur) à l'heure du dernier message du fan (horodatage Reveal) ; à vérifier sur la capture Reveal (remarque de Bilan sur #222).
Candidats à suppression : aucun.
Vérifié : pnpm check, pnpm test (dont un test exhaustif : tout code émis par `desireScore` est dans `DESIRE_SIGNALS` et réciproquement), pnpm test:integration (38 fichiers) ; évals non lancées (pas de clé xAI ici).
