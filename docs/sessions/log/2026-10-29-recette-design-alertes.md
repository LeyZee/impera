# 2026-10-29 — Recette design, Réglages › Alertes — done

Fait :
- REG-16 : une ligne par alerte (nom, créatrices, « Pause » si elle met l'agent en pause, interrupteur) ; la phrase, les mots, ce qu'elle fait et « Modifier » / « Archiver » s'ouvrent d'un tap sur le nom. La ligne Telegram ne s'affiche que s'il y a un souci (aucun groupe pour une créatrice, notification coupée) ; le résumé « Une phrase et 2 mots-clés » disparaît (`watchLine` retiré).
- REG-17 : les exemples s'écrivent « Ex. : … » en encre pâle, par une prop `example` du champ partagé avec la Persona.
- REG-18 : une nouvelle alerte coche toutes les créatrices ; « Une phrase, des mots-clés, ou les deux » marque aussi le champ de la phrase.
- REG-13 : sous « Mots-clés de la persona », un lien par créatrice vers sa Persona (`/creatrices?creatrice=…`) ; dans Réglages › Telegram, « Modifier les mots dans la Persona » mène à la créatrice du filtre.
- REG-21 : la page qui ne se charge pas dit « Le serveur ne répond pas », puis « Les alertes n'ont pas pu être lues. » et « Réessayer ».
- REG-30 : l'introduction dit « Le code les lève lui-même. Sauf les mots-clés, chacune se coupe créatrice par créatrice. » ; « Doute sur la personne » devient « Le fan demande si c'est un bot ». L'exemple Telegram disait déjà « Validé par Hugo ».
Décisions : une alerte coupée garde sa ligne compacte, atténuée ; « Pause » ne s'affiche que pour une alerte active.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check ✓, tests web ✓ (ligne compacte puis ouverte, exemples « Ex. : », toutes les créatrices cochées, phrase marquée, liens vers la Persona, intitulé du bot, serveur muet).
