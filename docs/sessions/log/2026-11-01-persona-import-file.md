# 2026-11-01 — Persona : « Importer un fichier » (fil Extension) — done

Fait : dans Créatrices › Persona, « Importer un fichier » lit un fichier YAML de persona dans le navigateur (`readPersonaFile`, 256 Ko au plus, `PersonaSchema`) et le met à l'écran comme une saisie, à relire onglet par onglet ; « Enregistrer une version » le garde en version inactive, avec le numéro du fichier s'il vient après toutes ses versions (`versionOnSave`), et la version active ne change pas. Le fichier devient celui de la créatrice de l'écran (`importedDraft`). Un fichier refusé dit combien de problèmes et le premier sous son onglet et sa clé (`fileRefusal`), sans rien changer. L'en-tête garde le numéro et la date de sa dernière version enregistrée tant que l'import n'est pas enregistré. Fiche `PROPOSED-persona-screen.md` et glossaire mis à jour.
Décisions : « oui » de Charles du 01/11 ; l'écran dit « fichier », pas « brouillon », qui désigne une réponse de l'agent dans le glossaire ; aucun changement de serveur ni de contrat (la route des versions existe).
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : `pnpm check` et tests de `@nirvana/web` ; le brouillon de la persona de Messa (hors dépôt) se lit sans problème et garde sa version 1.0.0, vérifié par une sonde locale supprimée ensuite.
