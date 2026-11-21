# 2026-11-16 : le playground ne blâme plus Grok quand le serveur ne répond pas

- **Fiche** : recette visuelle du 16/11, constat V-ETA-06 (fil Playground).
- **Fait** : seul le code `llm_unavailable` envoyé par le serveur nomme Grok (« Grok ne répond pas », vérifier la clé). Un 502, 503 ou 504 sans ce code, ou aucune réponse du tout, devient `unreachable` : « Le serveur ne répond pas » en ambre, avec « Réessayer ».
- **Tests** : client (503 nu, 503 `llm_unavailable`, réseau coupé), écran (titres et ton).
- **Reste** : rien.
- **Découvertes** : aucune.
