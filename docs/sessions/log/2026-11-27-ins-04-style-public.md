# 2026-11-27 — INS-04 lot e : le style public de l'agence dans les réponses aux commentaires

- Fiche : INS-04 (lot e), ADR 0122 amendement du 26/11, § 19.
- Fait : la partie « public » du style de base actif entre dans le système du prompt `voice/instagram-comment` 1.4.0, dans le bloc `agency_public_style` (`publicStyleBlock`), absente sans style ; le calibrage la lit en lecture seule.
- Reste : retirer la ligne du merci simple du prompt quand le style actif la porte ; banque en base et import par le propriétaire ; dernier calibrage après la fiche 2.3.0.
- Découvertes : aucune.
