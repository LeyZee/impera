import type {
  ContractorDocumentKind,
  ContractorFile,
  ContractorFileDocument,
  ContractText,
} from '@nirvana/contracts';
import { useState, type JSX } from 'react';

import {
  DocumentsPanel,
  IdentityFacts,
  ReviewDialog,
  TextDialog,
  TextsPanel,
  UploadDialog,
  type FileReader,
} from './FileParts';
import { OwnerIdentityTools, RegimePanel } from './OwnerTools';
import { ProfileDialog } from './ProfileDialog';

import { useBillingRegimes, useContractorFile, useContractTexts } from '@/contractors/api';
import { regimeInForce, type TextStanding } from '@/contractors/model';
import '@/payroll/pay.css';
import { useSchedulingSettings } from '@/reports/api';
import '@/reports/reports.css';
import '@/scheduling/scheduling.css';
import { Empty, Loading, Unreachable } from '@/screens/pay/parts';
import '@/screens/team/team.css';
import { Panel } from '@/shell/layout';

/** What the reader opened on the file. */
type Opened =
  | { readonly kind: 'profile' }
  | { readonly kind: 'text'; readonly text: ContractText; readonly standing: TextStanding }
  | { readonly kind: 'upload'; readonly document: ContractorDocumentKind }
  | { readonly kind: 'review'; readonly document: ContractorFileDocument };

/**
 * A contractor's file, whole (EQ-06 lot 8b): his identity, his regime for the owner, his contract and mandate, his
 * documents. Moi › Dossier reads it as his own; Équipe › Membres › Dossier as the owner's, who checks it.
 */
export function FileBoard({
  memberId,
  name,
  reader,
}: {
  memberId: string;
  /** The member's name, for the owner's sentences. */
  name: string;
  reader: FileReader;
}): JSX.Element {
  const file = useContractorFile(memberId);
  const texts = useContractTexts();
  const regimes = useBillingRegimes();
  const timeZone = useSchedulingSettings().data?.timeZone ?? null;
  const [opened, setOpened] = useState<Opened | null>(null);
  const close = (): void => {
    setOpened(null);
  };

  if (file.isError && file.data === undefined)
    return (
      <Panel className="nv-enter">
        <Unreachable
          what={reader.self ? 'ton dossier' : 'son dossier'}
          onRetry={() => {
            void file.refetch();
          }}
        />
      </Panel>
    );
  if (file.data === undefined || timeZone === null)
    return (
      <Panel className="nv-enter">
        <Loading rows={4} />
      </Panel>
    );

  const data = file.data;
  const inForce = regimeInForce(data);
  const regime =
    inForce === null ? null : (regimes.data?.regimes.find((one) => one.id === inForce.regimeId) ?? null);

  return (
    <>
      <Panel
        className="nv-enter"
        eyebrow="Identité"
        title={reader.self ? 'Ton dossier' : 'Son dossier'}
        actions={
          reader.self && data.profile !== null ? (
            <button
              type="button"
              className="nv-btn nv-btn--soft nv-btn--sm"
              onClick={() => {
                setOpened({ kind: 'profile' });
              }}
            >
              Modifier
            </button>
          ) : undefined
        }
      >
        {data.profile === null ? (
          <ProfileMissing
            self={reader.self}
            name={name}
            onFill={() => {
              setOpened({ kind: 'profile' });
            }}
          />
        ) : (
          <IdentityFacts file={data} reader={reader} timeZone={timeZone} />
        )}
        {reader.self ? null : <OwnerIdentityTools file={data} name={name} checks={reader.checks} />}
      </Panel>
      {reader.self ? null : <RegimePanel file={data} regimes={regimes} name={name} checks={reader.checks} />}
      {texts.data === undefined ? (
        <Panel
          className="nv-enter"
          eyebrow="Contrat et mandat"
          title={reader.self ? 'Tes textes' : 'Ses textes'}
        >
          {texts.isError ? (
            <Unreachable
              what="la liste des textes"
              onRetry={() => {
                void texts.refetch();
              }}
            />
          ) : (
            <Loading rows={2} />
          )}
        </Panel>
      ) : (
        <TextsPanel
          file={data}
          texts={texts.data.texts}
          reader={reader}
          timeZone={timeZone}
          onRead={(text, standing) => {
            setOpened({ kind: 'text', text, standing });
          }}
        />
      )}
      {inForce !== null && regimes.data === undefined ? (
        <Panel className="nv-enter" eyebrow="Pièces" title={reader.self ? 'Tes pièces' : 'Ses pièces'}>
          {regimes.isError ? (
            <Unreachable
              what="la liste des régimes"
              onRetry={() => {
                void regimes.refetch();
              }}
            />
          ) : (
            <Loading rows={2} />
          )}
        </Panel>
      ) : (
        <DocumentsPanel
          file={data}
          regime={regime}
          reader={reader}
          name={name}
          onUpload={(document) => {
            setOpened({ kind: 'upload', document });
          }}
          onReview={(document) => {
            setOpened({ kind: 'review', document });
          }}
        />
      )}
      <Dialogs
        opened={opened}
        file={data}
        name={name}
        reader={reader}
        taxIdRequired={regime?.taxIdRequired ?? false}
        onClose={close}
      />
    </>
  );
}

function ProfileMissing({
  self,
  name,
  onFill,
}: {
  self: boolean;
  name: string;
  onFill: () => void;
}): JSX.Element {
  return (
    <div className="rp-sec">
      <Empty
        whisper={self ? 'Ton dossier est vide.' : `${name} n’a pas encore rempli son dossier.`}
        text={
          self
            ? 'Il donne le nom et l’adresse que tes factures imprimeront : aucune facture ne part en ton nom sans lui.'
            : 'Aucune facture ne part en son nom sans lui. Il le remplit depuis son espace, dans Moi.'
        }
      />
      {self ? (
        <button type="button" className="nv-btn nv-btn--neon cf-fill" onClick={onFill}>
          Remplir mon dossier
        </button>
      ) : null}
    </div>
  );
}

function Dialogs({
  opened,
  file,
  name,
  reader,
  taxIdRequired,
  onClose,
}: {
  opened: Opened | null;
  file: ContractorFile;
  name: string;
  reader: FileReader;
  taxIdRequired: boolean;
  onClose: () => void;
}): JSX.Element | null {
  if (opened === null) return null;
  switch (opened.kind) {
    case 'profile':
      return <ProfileDialog file={file} taxIdRequired={taxIdRequired} onClose={onClose} />;
    case 'text':
      return <TextDialog text={opened.text} standing={opened.standing} reader={reader} onClose={onClose} />;
    case 'upload':
      return (
        <UploadDialog memberId={file.memberId} kind={opened.document} today={file.today} onClose={onClose} />
      );
    case 'review':
      return (
        <ReviewDialog memberId={file.memberId} name={name} document={opened.document} onClose={onClose} />
      );
  }
}
