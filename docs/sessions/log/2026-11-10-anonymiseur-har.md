# 2026-11-10 — L'anonymiseur de capture Reveal corrigé après la première vraie capture

**Session** : Bilan · **Branche** : `claude/anonymizer-har-clean` · **Ordre** : « capture déposée » de Charles (10/11), relecture de la sortie sur son PC

Fait :
- `maskContacts` masque les mails et téléphones dans les chaînes de l'objet lu, plus dans le texte sérialisé : les « 00 » des durées devenaient `<phone>` et le fichier n'était plus du JSON.
- Ce qu'on tape pour chercher quelqu'un (`searchParticipants`, `searchValue`, `q`…) est du texte, même quand il ressemble à une valeur d'énumération : le pseudo du fan « test » passait par l'URL, l'en-tête `:path`, le Referer et les corps des server actions du dashboard.
- Les codes d'affiliation, d'invitation ou de parrainage sont masqués, et un code en majuscules mêlé de chiffres est haché ; `FR` ou `PPV_SENT` restent.
- Les réponses que Chrome exporte en base64 (messages, conversation, scripts…) sont décodées et anonymisées au lieu d'être jetées ; une clé d'objet qui est un identifiant (`counts.<modelId>`) est hachée.
- Un fichier coupé (pièce jointe tronquée à 100 Ko) est refusé avec un message clair au lieu d'une pile d'erreur.
- Tests : trois nouveaux dans `scripts/anonymize-har.test.mjs`, qui échouent sur l'ancien script.

Découvertes : Reveal n'a pas de WebSocket ; le temps réel du dashboard est un sondage (`GET conversations/:id/messages`, `conversations/model/count`, `typing`). À écrire dans `reveal-api-observed.md` à l'analyse (P1-02).

Candidats à suppression : aucun.

Relecture (Agent) : le pseudo d'un fan peut aussi passer par `slug`, `to`, `fan`, `participants`, `?s=` ou un segment de chemin. Ajouts : ces clés sont du texte, et `.scratch/inbox/.forbid` (sur le PC, jamais partagé) liste les mots qui ne doivent jamais sortir ; le script refuse d'écrire s'il en reste un, en ne donnant que son numéro. Runbooks mis à jour.

Incident : une première version de ce correctif (#676) citait en exemple le vrai code d'affiliation de l'agence, relevé dans la capture. Les exemples sont désormais inventés ; le sort de #676 est décidé par Charles.

Suite (même jour, branche `claude/anonymizer-har-uri`) : un segment d'URL mal encodé (`%E9` seul) faisait planter le script sur la deuxième capture ; il est désormais haché. Un mot interdit est aussi cherché sous sa forme encodée en URL (remarque d'Agent sur #677).
