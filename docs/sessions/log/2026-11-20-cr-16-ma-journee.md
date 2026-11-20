# 2026-11-20 — CR-16, second avenant : « Ma journée » — done

Fait : rythme du jour dicté par Charles dans `domain/day.ts` (`DAY_DEFAULTS`). L'essentiel du jour vient d'abord : story Reveal, vidéo du jour, story qui mène à Reveal. Le bonus Instagram et Telegram suit.
Table `creator_day_ticks` (migration 0238, RLS forcée, écrite par elle seule, lue par son équipe, SELECT pour `impera_service`). Routes `GET /v1/creator-space/day` et `PUT /v1/creator-space/day/:day/items/:item`, test d'intégration et isolation (paramètres `day`, `item`).
Carte « Ma journée » au-dessus de sa semaine : une coche par post et des couleurs partagées avec sa semaine (Instagram et Telegram ajoutés). Palette et icônes sorties dans `week-parts.tsx`.
Second avenant à l'ADR 0140 ; glossaire (Ma journée, Essentiel du jour, Story qui mène à Reveal).
Reste : captures validées par Charles, puis fusion dans la voie ordonnée (migration). Réglages par créatrice au lot 3.
Découvertes : aucune.
