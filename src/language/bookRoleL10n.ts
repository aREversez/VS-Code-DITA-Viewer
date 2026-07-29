// Localizes bookmap role badges produced by createBookRoleLabeler: the
// render layer stays pure (no vscode import) while VS Code callers inject
// translated display text ("第 1 章", "附录 A", …) through this formatter.

import * as vscode from 'vscode';
import { RoleLabelInfo } from '../render/mapTypeMap';

export function formatLocalizedRole(info: RoleLabelInfo): string {
  if (info.ordinal) {
    switch (info.tagName) {
      case 'chapter':
        return vscode.l10n.t('Chapter {0}', info.ordinal);
      case 'part':
        return vscode.l10n.t('Part {0}', info.ordinal);
      case 'appendix':
        return vscode.l10n.t('Appendix {0}', info.ordinal);
    }
  }
  // Plain roles (Preface, Notices, …) and divisions without an ordinal
  // translate as-is — avoids dangling "Chapter " / "第  章" spacing
  return vscode.l10n.t(info.role);
}
