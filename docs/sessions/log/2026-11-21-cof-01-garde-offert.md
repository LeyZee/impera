# 2026-11-21 — COF-01 Un média offert n'est jamais revendu — done

Fait : la synchronisation du coffre garde la marque « envoyé gratuitement » de Reveal (colonne `sent_for_free_at`, migration additive, jamais effacée). Un média offert (cette marque, ou son fichier dans un dépôt gratuit non retiré) bloque l'étape payante qui le vend : le script natif n'est plus proposable, le script en préparation ne passe pas « prêt à copier ». Dans l'autre sens, l'archive d'un dépôt gratuit laisse de côté un média vendu par un script et le dit dans sa fiche. Avenant à l'ADR 0145, deux termes au glossaire, tests unitaires et d'intégration.
Reste : les rôles de dossier de l'ADR 0145 et leur écran (feu vert de Charles) ; la publication Telegram et le Mass DM automatique appellent `mediaInScript` quand ils arrivent.
Découvertes : ce que Reveal met exactement dans `sentForFree` est à vérifier à la première vraie lecture du coffre.
