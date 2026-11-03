# 2026-11-03 — CR-02 lot c3 : Ventes, ses fans et une conversation en lecture — done
Fait : onglet Ventes de la créatrice (`/ventes`, rail Aujourd'hui · Ventes · Moi) ; « Tes fans » avec le prix des messages débloqués TTC par devise et « vu il y a … » ; lecteur de conversation en lecture seule (sens du message, jamais l'auteur, regroupé par jour, médias, messages payants, « Messages plus anciens ») ; `screens/sales/` (api, view, page, lecteur, CSS) ; tests (view, page, rail) ; fiche CR-02.
Décisions : l'ouverture d'une conversation, écrite au journal d'audit par le serveur, n'est lue qu'une fois par ouverture ; Ventes est un seul écran sans sous-onglet tant que CR-04 n'y met pas ses gains ; le lecteur reprend `bringIntoView` de Suivi pour s'ouvrir sur le dernier message.
Pas fait : gains et ventes (CR-04) ; textes de l'éditeur de persona qui nomment « l'agent » devant elle ; insights agrégés de sa base.
Découvertes : aucune.
