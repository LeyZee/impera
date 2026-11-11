# Session plateforme expirée

Symptômes : `platform_accounts.session_state = expired`, notification « Session Reveal expirée », le connecteur est arrêté (coupe-circuit).

La capture de session est le bouton « Synchroniser » du popup de l'extension, sur un onglet Reveal, pour le propriétaire seul (P2-01). Il envoie la session à `POST /v1/connector/sessions` avec la liaison de l'extension (`x-extension-link`). L'aide côté interface est `/aide/reveal` (« Reconnecter Reveal »).

1. Ouvrir Reveal dans Chrome avec l'extension installée et se connecter avec le compte du **membre d'équipe « bot »** créé dans Reveal pour l'agent, jamais avec la session de Charles ni celle d'un chatteur (décision de Charles du 17/10, `PROPOSED-reveal-connector.md`) : les messages de l'agent partent sous ce membre.
2. Ouvrir la messagerie de Reveal sur la bonne créatrice, puis popup de l'extension → « Session du connecteur » → **Synchroniser** sur la ligne du compte. L'extension lit la session dans les requêtes de l'onglet, l'envoie à `/v1/connector/sessions` (stockée chiffrée), puis l'oublie ; la ligne passe à « Session valide ». « Aucune session lue » : recharger la messagerie et réessayer. « Une autre créatrice » : l'onglet montre une autre créatrice que celle du compte (409).
3. Le connecteur redémarre seul (health check) ; vérifier dans Supervision que le poll reprend et qu'aucun message n'a été manqué (`connector.reconcile` tourne automatiquement après une re-sync).
4. Si `warning` (session proche de l'expiration) revient trop souvent : noter dans `reveal-api-observed.md` la durée de vie observée et ajuster l'alerte.
5. Si la session est invalidée **à chaque connexion ailleurs** (Reveal n'accepte qu'une session par compte) : ne pas ouvrir le compte du membre « bot » sur un autre appareil pendant que l'agent tourne (Charles et les chatteurs gardent leurs propres comptes), ou passer par l'option C (navigateur serveur) : à décider en phase 2.
