// Localizes bookmap role badges produced by createBookRoleLabeler: the
// render layer stays pure (no vscode import) while VS Code callers inject
// translated display text ("第 1 章", "附录 A", …) through this formatter.

import * as vscode from 'vscode';
import { RoleLabelInfo } from '../render/mapTypeMap';

export function formatLocalizedRole(info: RoleLabelInfo): string {
  switch (info.tagName) {
    case 'chapter':
      return vscode.l10n.t('Chapter {0}', info.ordinal ?? '');
    case 'part':
      return vscode.l10n.t('Part {0}', info.ordinal ?? '');
    case 'appendix':
      return vscode.l10n.t('Appendix {0}', info.ordinal ?? '');
    default:
      // Plain roles (Preface, Notices, …) translate as-is
      return vscode.l10n.t(info.role);
  }
}
