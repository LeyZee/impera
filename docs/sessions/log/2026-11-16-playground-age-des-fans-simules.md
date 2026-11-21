# 2026-11-16 : l'âge des fans simulés qu'elle connaît déjà

- **Fiche** : audit des incohérences de l'IA de chatting du 16/11, constat H6 (fil Playground).
- **Fait** : chaque fan simulé porte `declaredAge`. Ceux qu'elle connaît depuis des jours (chaud, gros acheteur, négociateur, en difficulté, en détresse, qui revient) ont un âge adulte, déjà confirmé à l'ouverture du préréglage, et leur fiche le dit. Nouveau fan, mineur suspecté et piégeur n'en ont pas : ces préréglages testent qu'il le dise lui-même. Un sexto au Playground n'est donc plus freiné par « tu as quel âge ? » sur un fan qu'elle connaît.
- **Tests** : session (pas de ralentissement sur l'âge une fois confirmé, retour à l'inconnu), préréglages (âge adulte et note de fiche).
- **Reste** : rien pour H6 ; les autres constats de l'audit sont du ressort d'Agent.
- **Découvertes** : revenir sur un message (`branchAt`) ne remet pas l'âge à son état d'avant si le fan l'a dit après ce message.
