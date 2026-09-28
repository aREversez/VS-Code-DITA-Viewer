// "Surround selection with DITA tag" -- Oxygen-style: select text in a .dita
// or .ditamap source editor, press Enter, pick a tag (with search) from a
// QuickPick, and the selection is wrapped in <tag>...</tag>. Only known DITA
// tags are offered (no custom names); typing filters by tag-name PREFIX.
// Selections whose tags are unpaired, or whose edges cut through a tag, are
// refused so the result is always well-formed XML.

import * as vscode from 'vscode';
import {
  filterWrapCandidates,
  getWrapTagCandidates,
  orderCandidatesWithMru,
  pushMruTag,
  wrapTextWithTag,
  WrapTagCandidate,
} from './wrapSelectionTags';
import { validateWrapSelection } from '../language/xmlTagBalance';

const MRU_KEY_TOPIC = 'ditaViewer.wrapTagMru.topic';
const MRU_KEY_MAP = 'ditaViewer.wrapTagMru.map';

function isMapDocument(document: vscode.TextDocument): boolean {
  return document.languageId === 'ditamap' || document.uri.fsPath.toLowerCase().endsWith('.ditamap');
}

interface WrapQuickPickItem extends vscode.QuickPickItem {
  tag: string;
}

function toQuickPickItem(c: WrapTagCandidate): WrapQuickPickItem {
  // alwaysShow: we filter ourselves (prefix match); VS Code's own fuzzy
  // substring filter would re-admit tags that merely contain the letters.
  return { tag: c.tag, label: `<${c.tag}>`, description: c.basetype, alwaysShow: true };
}

/** Shows the searchable tag picker and resolves to the chosen tag name, or
 * undefined if the user dismissed it without picking anything. */
async function pickTag(candidates: WrapTagCandidate[]): Promise<string | undefined> {
  const qp = vscode.window.createQuickPick<WrapQuickPickItem>();
  qp.placeholder = vscode.l10n.t('Select a tag to wrap the selection (type to search)');
  qp.matchOnDescription = false;
  qp.items = candidates.map(toQuickPickItem);

  return new Promise<string | undefined>((resolve) => {
    qp.onDidChangeValue((value) => {
      qp.items = filterWrapCandidates(candidates, value).map(toQuickPickItem);
    });
    qp.onDidAccept(() => {
      const picked = qp.selectedItems[0];
      if (!picked) return; // nothing matches: keep the picker open
      qp.hide();
      resolve(picked.tag);
    });
    qp.onDidHide(() => {
      qp.dispose();
      resolve(undefined);
    });
    qp.show();
  });
}

/** New selection ranges after replacing `original` with `<tag>text</tag>`,
 * covering just the wrapped payload so a further Enter press can nest
 * another tag around it immediately (matches Oxygen's chaining behavior). */
function innerSelectionAfterWrap(original: vscode.Selection, tag: string): vscode.Selection {
  const openLen = tag.length + 2; // "<tag>"
  const newStart = original.start.translate(0, openLen);
  const newEnd = original.start.line === original.end.line
    ? original.end.translate(0, openLen)
    : original.end; // closing tag is appended after this position, so it doesn't move
  return new vscode.Selection(newStart, newEnd);
}

export function registerWrapSelectionCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerTextEditorCommand(
      'ditaViewer.wrapSelectionWithTag',
      async (editor) => {
        const selections = editor.selections.filter((s) => !s.isEmpty);
        if (selections.length === 0) {
          vscode.window.showInformationMessage(
            vscode.l10n.t('Select some text in a DITA topic or map to wrap it with a tag.'),
          );
          return;
        }

        const fullText = editor.document.getText();
        for (const selection of selections) {
          const check = validateWrapSelection(
            fullText,
            editor.document.offsetAt(selection.start),
            editor.document.offsetAt(selection.end),
          );
          if (check.ok) continue;
          const message = check.reason === 'cuts-markup'
            ? vscode.l10n.t('Cannot wrap: the selection starts or ends inside a tag or comment. Select whole text or whole elements.')
            : check.tagName
              ? vscode.l10n.t('Cannot wrap: the selection contains an unpaired tag <{0}>. Select the whole element, including its end tag.', check.tagName)
              : vscode.l10n.t('Cannot wrap: the selection contains unpaired tags. Select whole elements.');
          vscode.window.showWarningMessage(message);
          return;
        }

        const isMap = isMapDocument(editor.document);
        const mruKey = isMap ? MRU_KEY_MAP : MRU_KEY_TOPIC;
        const mru = context.globalState.get<string[]>(mruKey, []);
        const candidates = orderCandidatesWithMru(getWrapTagCandidates(isMap), mru);

        const tag = await pickTag(candidates);
        if (!tag) return;

        await editor.edit((editBuilder) => {
          for (const selection of selections) {
            const text = editor.document.getText(selection);
            editBuilder.replace(selection, wrapTextWithTag(text, tag));
          }
        });

        editor.selections = selections.map((sel) => innerSelectionAfterWrap(sel, tag));

        await context.globalState.update(mruKey, pushMruTag(mru, tag));
      },
    ),
  );
}
