# Session plateforme expirée

Symptômes : `platform_accounts.session_state = expired`, notification « Session Reveal expirée », le connecteur est arrêté (coupe-circuit).

La capture de session dans l'extension (bouton Sync) n'est pas encore codée (phase 2, fiche à part de `PROPOSED-reveal-connector.md`) ; la route qui la reçoit, `POST /v1/connector/sessions`, existe déjà côté serveur (jeton d'appareil `x-extension-token`). Cette procédure est celle que le bouton mettra en place. L'aide côté interface, « Reconnecter Reveal », s'écrit avec elle sur la route réservée `/aide/reveal`.

1. Ouvrir Reveal dans Chrome avec l'extension installée et se connecter avec le compte du **membre d'équipe « bot »** créé dans Reveal pour l'agent, jamais avec la session de Charles ni celle d'un chatteur (décision de Charles du 17/10, `PROPOSED-reveal-connector.md`) : les messages de l'agent partent sous ce membre.
2. Popup de l'extension → **Sync**. L'extension envoie la session chiffrée à `/v1/connector/sessions` ; le dashboard affiche `valid` dans la minute.
3. Le connecteur redémarre seul (health check) ; vérifier dans Supervision que le poll reprend et qu'aucun message n'a été manqué (`connector.reconcile` tourne automatiquement après une re-sync).
4. Si `warning` (session proche de l'expiration) revient trop souvent : noter dans `reveal-api-observed.md` la durée de vie observée et ajuster l'alerte.
5. Si la session est invalidée **à chaque connexion ailleurs** (Reveal n'accepte qu'une session par compte) : ne pas ouvrir le compte du membre « bot » sur un autre appareil pendant que l'agent tourne (Charles et les chatteurs gardent leurs propres comptes), ou passer par l'option C (navigateur serveur) : à décider en phase 2.
