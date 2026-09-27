// "Surround selection with DITA tag" -- Oxygen-style: select text in a .dita
// or .ditamap source editor, press Enter, pick a tag (with search) from a
// QuickPick, and the selection is wrapped in <tag>...</tag>. Typing a name
// that isn't in the known candidate list offers a "wrap with <input>"
// fallback, so specializations and custom elements still work.

import * as vscode from 'vscode';
import {
  getWrapTagCandidates,
  isValidCustomTagName,
  orderCandidatesWithMru,
  pushMruTag,
  wrapTextWithTag,
  WrapTagCandidate,
} from './wrapSelectionTags';

const MRU_KEY_TOPIC = 'ditaViewer.wrapTagMru.topic';
const MRU_KEY_MAP = 'ditaViewer.wrapTagMru.map';

function isMapDocument(document: vscode.TextDocument): boolean {
  return document.languageId === 'ditamap' || document.uri.fsPath.toLowerCase().endsWith('.ditamap');
}

interface WrapQuickPickItem extends vscode.QuickPickItem {
  tag: string;
}

function toQuickPickItem(c: WrapTagCandidate): WrapQuickPickItem {
  return { tag: c.tag, label: `<${c.tag}>`, description: c.basetype };
}

/** Shows the searchable tag picker and resolves to the chosen tag name, or
 * undefined if the user dismissed it without picking anything. */
async function pickTag(candidates: WrapTagCandidate[]): Promise<string | undefined> {
  const baseItems = candidates.map(toQuickPickItem);
  const qp = vscode.window.createQuickPick<WrapQuickPickItem>();
  qp.placeholder = vscode.l10n.t('Select a tag to wrap the selection (type to search)');
  qp.matchOnDescription = true;
  qp.items = baseItems;

  return new Promise<string | undefined>((resolve) => {
    qp.onDidChangeValue((value) => {
      const trimmed = value.trim();
      const isKnown = candidates.some((c) => c.tag === trimmed);
      if (trimmed.length > 0 && isValidCustomTagName(trimmed) && !isKnown) {
        qp.items = [
          { tag: trimmed, label: `<${trimmed}>`, description: vscode.l10n.t('Custom tag') },
          ...baseItems,
        ];
      } else {
        qp.items = baseItems;
      }
    });
    qp.onDidAccept(() => {
      const picked = qp.selectedItems[0];
      qp.hide();
      resolve(picked?.tag);
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
