import type { JSX } from 'react';

/**
 * The guide of the tax residence certificate for a chatter of Benin (EQ-06 lot 8b), word for word from
 * `docs/reference/residence-certificate-benin.md`, validated by Charles on 02/11 (« ok guide »): any change goes back
 * to him, and `BeninGuide.test.tsx` fails when the text drifts from the document. `year` fills the guide's « AAAA ».
 */
export function BeninGuide({ year }: { year: string }): JSX.Element {
  return (
    <div className="cf-guide__body">
      <h3>Ton attestation de domiciliation fiscale</h3>

      <h4>Pourquoi on te la demande</h4>
      <p>
        L’agence est une société française. Quand une société française paie quelqu’un qui vit à l’étranger,
        la France peut garder 25&nbsp;% de la somme en impôt. Entre la France et le Bénin, un accord (une
        «&nbsp;convention fiscale&nbsp;») dit que tu paies tes impôts au Bénin, pas en France. Pour que cet
        accord s’applique, on doit pouvoir prouver que tu vis bien au Bénin, avec un papier des impôts
        béninois.
      </p>
      <p>
        Ta facture part sans ce papier. Mais sans l’attestation de l’année du virement, on ne peut pas
        t’envoyer ton argent. Tes commissions ne sont pas perdues : elles sont calculées, facturées, et
        attendent. Dès que ton attestation est acceptée, ton versement peut partir.
      </p>

      <h4>C’est quoi</h4>
      <p>
        Un document officiel de la Direction générale des impôts du Bénin (DGI) qui dit : «&nbsp;cette
        personne a son domicile fiscal au Bénin&nbsp;». Dans ton dossier, il s’appelle «&nbsp;attestation de
        résidence fiscale&nbsp;» ; au guichet de la DGI, demande une{' '}
        <strong>attestation de domiciliation fiscale</strong>, modèle <strong>5000-FR</strong> (le modèle pour
        la France). Il vaut pour l’année en cours : il faut le refaire chaque année en janvier.
      </p>

      <p>
        <strong>Ce qui ne marche pas à la place</strong> : ton IFU seul, un certificat de résidence de la
        mairie, une attestation de régularité fiscale.
      </p>

      <h4>Comment l’obtenir</h4>
      <ol>
        <li>
          <strong>Ton IFU d’abord.</strong> Si tu n’en as pas, demande-le gratuitement sur
          e-services.impots.bj avec ton NPI : c’est immédiat.
        </li>
        <li>
          <strong>Prépare ton dossier</strong> :
          <ul>
            <li>le formulaire de demande d’actes ou de services (sur impots.bj) ;</li>
            <li>
              le formulaire 5000-FR (sur impots.gouv.fr, «&nbsp;attestation de résidence destinée à
              l’administration étrangère&nbsp;») : tu remplis ta partie (cadre III) et tu signes, la DGI
              remplit la sienne ;
            </li>
            <li>une copie de ta pièce d’identité ;</li>
            <li>un justificatif de ton domicile au Bénin.</li>
          </ul>
        </li>
        <li>
          <strong>Dépose-le au secrétariat de la DGI</strong>, puis retire l’attestation au secrétariat de la
          DCFR (on te dira où au dépôt).
        </li>
        <li>
          <strong>Délai</strong> : environ 3 jours ouvrés une fois le dossier complet.{' '}
          <strong>Gratuit.</strong>
        </li>
        <li>
          <strong>Bon à savoir</strong> : avant de la signer, la DGI vérifie que tu es à jour de tes
          déclarations et de tes impôts au Bénin. Si ce n’est pas le cas, elle te dira quoi régulariser.
        </li>
      </ol>

      <p>
        Une question sur ta situation ? La DGI répond au <strong>133</strong> ou à cdgi@finances.bj.
      </p>

      <h4>Quoi déposer ici</h4>
      <p>
        Le scan ou la photo nette de l’attestation signée (ou de ton 5000-FR avec la partie de la DGI remplie
        et signée). PDF, JPG ou PNG, 10 Mo au plus. L’année doit être lisible.
      </p>
      <p>
        Après l’envoi, l’agence vérifie le document. Tu vois ici son état : <em>à envoyer</em>,{' '}
        <em>en attente</em>, <em>acceptée jusqu’au 31 décembre {year}</em>, ou <em>refusée</em> avec la
        raison.
      </p>
    </div>
  );
}
