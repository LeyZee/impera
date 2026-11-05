# 2026-11-05 — Recette EQP-08, 09 : le PDF d'une facture se lit avant de s'enregistrer, et un PDF perdu est dit perdu — done

Fait :

- EQP-08 : les trois boutons « PDF » d'une facture (sa ligne, le dialogue « J'accepte » / « Je conteste », l'historique) étaient des liens `<a href download>`. Un 503 du serveur s'enregistrait en « pdf.json », sans un mot à l'écran. Ce sont maintenant des boutons qui lisent le PDF (`readInvoicePdf`), vérifient qu'il est en `application/pdf`, l'enregistrent sous le numéro du document (`MIA-2026-0001.pdf`), et sinon disent pourquoi sous les boutons (`pdfRefusalText`).
- EQP-09 : en développement, les seaux en mémoire perdent les PDF quand l'API redémarre. Un PDF ainsi perdu ne sera jamais refait (ADR 0037) :
  - le téléchargement répond `invoice_pdf_gone` (410), « Ce PDF est perdu : le serveur de développement le gardait en mémoire et l'a oublié en redémarrant. Il ne sera pas refait. », au lieu de « momentanément indisponible, réessaie » ;
  - l'archive du comptable l'écrit dans `manifeste.csv` : « PDF perdu au redémarrage du serveur de développement, jamais refait », au lieu de « hébergeurs injoignables, relancer l'export » ;
  - `readChecked` rend `forgotten` pour un objet absent d'un seau `volatile`. `checkedInvoicePdf` ne dit « perdu » que si aucun seau ne peut plus le rendre : un seau muet garde « hors d'atteinte ».

Décisions :
- 410 `*_gone`, comme `contractor_document_file_gone` : la ressource a existé et ne reviendra pas.
- La liste garde `pdfReady: true` : vérifier chaque PDF à la lecture de la liste coûterait une lecture de seau par ligne, pour un cas qui n'existe qu'en développement. Le bouton dit la vérité au clic.

Découvertes : les fichiers du dossier d'un prestataire (`screens/me/FileParts.tsx`, « Voir le fichier » et « Ouvrir le fichier ») sont encore des `<a href download>` : un refus du serveur s'y enregistrerait aussi comme un fichier JSON.

Candidats à suppression : aucun.

Vérifié :
- `pnpm check` ;
- unitaires API : `invoice-pdfs` (perdu, hors d'atteinte, faux), `archive` (ligne du manifeste), `server` (410) ;
- unitaires web : `MyInvoicesPage` (refus dit sans fichier, page qui n'est pas un PDF, PDF enregistré sous son numéro), `invoices/model`, et toute la paie.
