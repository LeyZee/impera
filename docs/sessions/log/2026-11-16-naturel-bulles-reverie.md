# 2026-11-16 — Naturel ce soir : bulles comptées et espacées, rêverie au conditionnel — review
Fait : budget de bulles fixé par le code (`bubbleBudget`, une par défaut, trois rarement) et donné à la voix ; bulles en trop laissées de côté, jamais collées (`fitBubbles`) ; temps de frappe entre deux bulles à l'envoi réel (`bubbleDelays`, port `TypingRhythm` du job d'envoi), exporté pour le playground ; `meet_request` réservé à une proposition concrète, la voix joue le jeu d'une rêverie sans rien promettre (cerveau 1.17.0, voix 1.11.0) ; gardes de rencontre qui laissent passer le cadre imaginaire et le sexto ; exemples de voix du playground limités à sa créatrice, sa version et ses gardes (recette AGE-07) ; `inbound_minutes_ago` facultatif dans un scénario d'éval.
Pas fait : normaliseur typographique (bulle qui commence par « [ ») et suite du lot 1 de l'audit.
Décisions : aucune ADR (les règles de bulles et de rencontre restent dans le code, sous l'ADR 0009 et l'ADR 0021).
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié : pnpm check, pnpm test, test d'intégration de l'envoi.
