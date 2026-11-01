# Projets antérieurs : Imperium et OnlyScript

Décision de Charles : on emprunte des **concepts**, pas de code (« pas de reprise de code »). Les deux dépôts sont des références en lecture seule.

## Imperium (`LeyZee/imperium`, Express + SQLite + Prisma + React)

Outil de gestion d'agence : chatteurs, planning, comptabilité, statistiques.

Emprunté :
- La spec PWA (Web Push avec VAPID, service worker, installation sur mobile) pour l'app mobile de la modèle (phase 5).
- Les entités de comptabilité pour le futur pont Nirvana → Imperium (ventes → revenus par modèle).

Laissé :
- SQLite, `setInterval` comme ordonnanceur, logique dans les routes.

**27/10/2026** : Imperium est à l'arrêt et la gestion d'équipe entre dans Nirvana (ADR 0023) : planning, rapports de fin de shift saisis dans l'application (plus de Telegram), paie, factures, routine des créatrices. Les règles d'Imperium sont reprises telles quelles et son historique est importé par un script testé sur des données inventées (aucune donnée réelle dans le dépôt). Toujours des concepts, jamais du code ; la PWA et les entités de comptabilité ci-dessus en font partie.

**Alerte sécurité** (constatée le 2026-10-16) : le dépôt contient des secrets commités (`server/.env` avec `DATABASE_URL` et `CLERK_WEBHOOK_SECRET`, fichiers de cookies `cookies.txt`, `UsersUSERcookie.txt`). À faire par Charles : **révoquer et régénérer** ces secrets, puis purger l'historique (ou considérer le dépôt comme compromis et le recréer). Nirvana impose `gitleaks` en pre-commit et en CI pour ne pas reproduire cela.

## OnlyScript (`LeyZee/onlyscript`, FastAPI + Vertex Gemini)

Générateur de scripts de vente à partir d'analyse de médias.

Emprunté :
- Le **vocabulaire de description de médias** (`media-vocabulary.md`) : `factual_description`, `not_visible`, `confidence_low`, `intensity`, `anatomy_visible`, `mood`, `cast_mode`. C'est le contrat du rôle `sense`.
- La **vision du sexting** : kinks exploités, **dégoûts garantis par le code** et non par le prompt, structures d'échange en étapes (« cartons »), identité de script. Base du module `scripts` (phase 6).
- Le principe « le modèle décrit, le code décide ».
- La preuve que Gemini 2.5 Flash sur Vertex avec `BLOCK_NONE` analyse des médias adultes (repli pour `sense`).

Laissé :
- Python, l'absence de base de données, les scripts à usage unique.

**27/10/2026** : Charles veut l'atelier de scripts d'OnlyScript refait de zéro dans Nirvana, « avec le système des cartons en mieux travaillé », plus robuste et dans le même design. C'est le second temps, après la capture Reveal et le catalogue (P6-01) ; la fiche proposée `PROPOSED-script-studio.md` pose d'abord la question de la source des scripts (Reveal ou Nirvana), à trancher par une ADR.
