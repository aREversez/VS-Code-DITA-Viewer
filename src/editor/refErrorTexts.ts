// Localized wording for the renderer's broken-reference hints
// (RenderContext.refError / refErrorTexts). The core ships English
// defaults (DEFAULT_REF_ERROR_TEXTS); the extension fills the same six
// strings from its own l10n catalog so the hints follow the editor's
// display language, the same way note labels follow uiLanguage.
//
// l10n.t is called WITHOUT arguments on purpose: the {0}/{1} placeholders
// must survive into the template -- the core renderer fills them with the
// raw reference and the diagnosis reason at render time (see
// fillRefErrorTemplate), not here.
//
// The literals below are the l10n keys and must stay equal to
// DEFAULT_REF_ERROR_TEXTS (refErrorTexts.test.ts locks the parity).

import * as vscode from 'vscode';
import { RefErrorTexts } from '@dita-viewer/core';

export function refErrorTexts(): RefErrorTexts {
  return {
    content: vscode.l10n.t('Referenced content could not be resolved ({0})'),
    xref: vscode.l10n.t('→ {0} ({1})'),
    missingKey: vscode.l10n.t('key is not defined or has no target'),
    missingFile: vscode.l10n.t('target file does not exist'),
    parseError: vscode.l10n.t('target file cannot be parsed as XML'),
    missingId: vscode.l10n.t('target ID does not exist'),
    outsideWorkspace: vscode.l10n.t('target file is outside the workspace'),
  };
}