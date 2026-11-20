import { AUDIT_EXPORT_MAX, DomainError, type AUDIT_ERROR_CODES } from '@impera/contracts';

type AuditErrorCode = (typeof AUDIT_ERROR_CODES)[number];

/** 400: a cursor this server did not give, or one altered on the way. */
export class AuditCursorInvalid extends DomainError {
  constructor() {
    super('audit_cursor_invalid' satisfies AuditErrorCode, 'Ce curseur du journal est illisible');
  }
}

/** 422: the selection is wider than one export holds; a shorter period is asked. */
export class AuditExportUnprocessable extends DomainError {
  constructor() {
    super(
      'audit_export_unprocessable' satisfies AuditErrorCode,
      `Plus de ${String(AUDIT_EXPORT_MAX)} lignes : choisissez une période plus courte`,
      { details: { max: AUDIT_EXPORT_MAX } },
    );
  }
}
