import * as assert from 'assert';
import {
  ROOT_NODE_ID,
  ExpansionDeviations,
  expansionFor,
  isExpandedByDefault,
  markExpanded,
  markCollapsed,
  nodeSegment,
  nodeIdFor,
  parseExpansionDeviations,
  pruneExpansionDeviations,
  treeItemId,
} from '../../language/mapExpansionState';
import { parseDitamap } from '../../parser/ditaParser';
import { DitaNode } from '../../parser/domTypes';

/**
 * The Explorer map tree's expansion state, keyed by structural node ids.
 * The two behaviors worth pinning down: a deviation record only stores
 * what differs from the defaults (root expanded, everything else
 * collapsed), and the TreeItem id encodes the state so that changing it
 * re-creates the row -- the mechanism a scoped collapse-all depends on,
 * since the TreeView API has no way to collapse a rendered node.
 */
describe('mapExpansionState', () => {
  describe('defaults and deviation bookkeeping', () => {
    it('expands the root map row and collapses every other branch by default', () => {
      assert.strictEqual(isExpandedByDefault(ROOT_NODE_ID), true);
      assert.strictEqual(isExpandedByDefault('root/topics/install.dita'), false);
      assert.strictEqual(expansionFor({}, ROOT_NODE_ID), 'e');
      assert.strictEqual(expansionFor({}, 'root/anything'), 'c');
    });

    it('records an expanded branch as a deviation', () => {
      const deviations: ExpansionDeviations = {};
      markExpanded(deviations, 'root/chapters');
      assert.strictEqual(deviations['root/chapters'], 'e');
      assert.strictEqual(expansionFor(deviations, 'root/chapters'), 'e');
    });

    it('returns a branch to the collapsed default rather than storing a redundant mark', () => {
      const deviations: ExpansionDeviations = {};
      markExpanded(deviations, 'root/chapters');
      markCollapsed(deviations, 'root/chapters');
      assert.strictEqual('root/chapters' in deviations, false);
      assert.strictEqual(expansionFor(deviations, 'root/chapters'), 'c');
    });

    it('records a collapsed root, since expanded is its default', () => {
      const deviations: ExpansionDeviations = {};
      markCollapsed(deviations, ROOT_NODE_ID);
      assert.strictEqual(deviations[ROOT_NODE_ID], 'c');
      assert.strictEqual(expansionFor(deviations, ROOT_NODE_ID), 'c');
      // and expanding it drops the mark again
      markExpanded(deviations, ROOT_NODE_ID);
      assert.strictEqual(ROOT_NODE_ID in deviations, false);
      assert.strictEqual(expansionFor(deviations, ROOT_NODE_ID), 'e');
    });
  });

  describe('parseExpansionDeviations', () => {
    it('accepts an object of e/c marks', () => {
      assert.deepStrictEqual(parseExpansionDeviations({ 'root/a': 'e', 'root/b': 'c' }), {
        'root/a': 'e',
        'root/b': 'c',
      });
    });

    it('drops junk rather than trusting workspaceState', () => {
      assert.deepStrictEqual(
        parseExpansionDeviations({ ok: 'e', bad: 'x', worse: null, num: 1, empty: '' }),
        { ok: 'e' },
      );
      assert.deepStrictEqual(parseExpansionDeviations(undefined), {});
      assert.deepStrictEqual(parseExpansionDeviations('nonsense'), {});
      assert.deepStrictEqual(parseExpansionDeviations(['e']), {});
    });
  });

  describe('pruneExpansionDeviations', () => {
    it('keeps only ids the current tree still contains', () => {
      const deviations: ExpansionDeviations = {
        'root/gone.ditamap': 'e',
        'root/kept.dita': 'e',
        root: 'c',
      };
      const pruned = pruneExpansionDeviations(deviations, new Set(['root', 'root/kept.dita']));
      assert.deepStrictEqual(pruned, { 'root/kept.dita': 'e', root: 'c' });
    });
  });

  describe('nodeSegment / nodeIdFor', () => {
    const parse = (xml: string): DitaNode => parseDitamap(xml).root;

    it('keys a segment by what the node references, not its position', () => {
      const root = parse(
        '<map><topicref href="topics/install.dita"/><topichead navtitle="Setup"><topicref keys="setup-key"/></topichead></map>',
      );
      const hrefNode = root.children[0];
      const head = root.children[1];
      const keyed = head.children[0];
      assert.strictEqual(nodeSegment(hrefNode), 'topics/install.dita');
      assert.strictEqual(nodeSegment(head), 'topichead:Setup');
      assert.strictEqual(nodeSegment(keyed), 'topicref:keys=setup-key');
    });

    it('disambiguates duplicate references without renumbering the first', () => {
      const root = parse(
        '<map>' +
          '<topicref href="a.dita"/>' +
          '<topicref href="a.dita"/>' +
          '<topicref href="a.dita"/>' +
          '<topicref href="b.dita"/>' +
          '</map>',
      );
      const none = new Map<string, number>();
      const first = nodeIdFor('root', root.children[0], none);
      const seenOnce = new Map([['a.dita', 1]]);
      const second = nodeIdFor('root', root.children[1], seenOnce);
      const seenTwice = new Map([['a.dita', 2]]);
      const third = nodeIdFor('root', root.children[2], seenTwice);
      assert.strictEqual(first, 'root/a.dita', 'first occurrence carries no suffix');
      assert.strictEqual(second, 'root/a.dita~2');
      assert.strictEqual(third, 'root/a.dita~3');
      // A different href never picks up another href's suffix
      assert.strictEqual(nodeIdFor('root', root.children[3], seenTwice), 'root/b.dita');
    });

    it('builds child ids under their parent id, keeping subtrees from colliding', () => {
      const root = parse(
        '<map><topichead navtitle="A"><topicref href="a.dita"/></topichead>' +
          '<topichead navtitle="B"><topicref href="a.dita"/></topichead></map>',
      );
      const headA = root.children[0];
      const headB = root.children[1];
      assert.notStrictEqual(
        nodeIdFor('root/topichead:A', headA.children[0], new Map()),
        nodeIdFor('root/topichead:B', headB.children[0], new Map()),
      );
    });

    it('strips the fragment off an href so a same-topic anchor ref keeps one id', () => {
      const root = parse('<map><topicref href="a.dita#section"/></map>');
      assert.strictEqual(nodeSegment(root.children[0]), 'a.dita');
    });
  });

  describe('treeItemId', () => {
    it('changes when the recorded state changes, so the row is rebuilt in the new state', () => {
      const collapsed = treeItemId('/w/main.ditamap', 'root/sub.ditamap', 'c');
      const expanded = treeItemId('/w/main.ditamap', 'root/sub.ditamap', 'e');
      assert.notStrictEqual(collapsed, expanded);
    });

    it('stays put while the state does, so reloads keep the row and its expansion', () => {
      assert.strictEqual(
        treeItemId('/w/main.ditamap', 'root/sub.ditamap', 'e'),
        treeItemId('/w/main.ditamap', 'root/sub.ditamap', 'e'),
      );
    });

    it('separates maps, so switching maps can never match another map\'s rows', () => {
      assert.notStrictEqual(
        treeItemId('/w/a.ditamap', 'root/chapter', 'e'),
        treeItemId('/w/b.ditamap', 'root/chapter', 'e'),
      );
    });

    it('omits the state slot for leaf rows, which have no expansion to encode', () => {
      assert.strictEqual(treeItemId('/w/m.ditamap', 'root/leaf.dita'), '/w/m.ditamap|root/leaf.dita');
    });
  });
});
