# 2026-11-14 — DSH-03 La part de l'agence lue chez Reveal, le pourcentage facultatif — review
Fait : amendement ADR 0054 § 4 à § 8 ; part constatée (somme de la part de l'agence sur somme du net, par compte et devise, 30 jours et trois quinzaines) servie à la fiche du propriétaire ; événement `agency_share_changed` publié par le contrôle des pourcentages quand la part bouge de plus d'un point d'une quinzaine à l'autre (migration 0199 provisoire : contraintes de type, index unique, déclencheur Telegram) ; notification Telegram « Important » ; ligne de mise en route faite dès qu'un compte Reveal est relié ; écran « Part de l'agence » avec la part lue en premier et le pourcentage facultatif.
Pas fait : captures et relectures (Équipe, Bilan, Design) ; confirmation du numéro de migration au tour de fusion.
Décisions : seuil de changement fixé à plus de 100 points de base (ADR 0054 § 5) ; une quinzaine sans net n'est comparée à rien ; la note de mise en route `share_read_on_platform` dit que la part est lue chez Reveal.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : voir la PR.
