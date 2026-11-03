# 2026-11-03 — OPS-03 : les deux tests instables de la CI — done
Fait :
- Arrêt du worker : la CI recevait un code `null` au lieu de 0, ce qui veut dire que le processus avait été tué par le signal lui-même. `SIGTERM` n'avait d'écouteur qu'après `startWorker`, alors que le test l'envoie dès « worker started », qui est journalisé à l'intérieur de `startWorker`. Désormais `exitGracefully(logger)` est appelé à la première ligne de `worker.ts` et `index.ts` ; un signal reçu pendant le démarrage est gardé, et `stopWith` lance l'arrêt une fois le démarrage fini.
- Seau des factures : reproduit en local. MinIO ferme la connexion juste après avoir répondu 412 à un PUT conditionnel, sans `Connection: close`. En direct, Node voit la fermeture à temps. Derrière un proxy qui la retarde (docker-proxy en IPv6 sur la CI), la lecture suivante part sur la connexion fermée : 20 échecs sur 20 avec un retard de 50 ms. Une lecture (GET, HEAD) repart maintenant une fois sur une nouvelle connexion dans ce seul cas (`UND_ERR_SOCKET` ou reset). Un PUT ne repart jamais, puisqu'il pourrait recevoir un 412 sur son propre objet ; un délai dépassé ne repart pas non plus.
Pas fait : rien.
Décisions :
- Le seau relit une seule fois, pour cette seule cause, dans le code du produit et pas dans les tests : un fournisseur peut fermer une connexion gardée ouverte, et le job d'émission aurait sinon un essai perdu.
- Aucun changement de la CI : aucune des deux causes n'y est.
Découvertes : aucune.
Candidats à suppression : aucun.
Vérifié :
- `shutdown.test.ts` : 2 tests.
- Test unitaire du seau : 1 cas.
- Intégration `invoice-buckets` : 11 tests. Le cas du proxy échoue sans le correctif (`other side closed`) et passe avec.
- `shutdown.integration.test.ts` vert.
