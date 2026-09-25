import * as assert from 'assert';
import { mapTreeLabel, mapTreeIconId, TOPIC_TYPE_ICON_IDS } from '../../language/mapTreePresentation';
import { parseDitamap, preprocessEntities } from '../../parser/ditaParser';
import { expandDitamapRefs } from '../../editor/ditaRenderUtils';
import { DitaNode } from '../../parser/domTypes';

/**
 * What a row of the Explorer map tree says and which icon it carries. The
 * labels are the user-visible half of the tree's Oxygen alignment: the main
 * map and submaps answer to their titles (keyrefs resolved -- the
 * version-number-in-title pattern software manuals use), not their file
 * names.
 */
const parse = (xml: string): DitaNode => parseDitamap(preprocessEntities(xml)).root;

const KEYS: Record<string, string> = {
  'product-name': '星枢 N1',
  version: '2.1.0',
};
const resolveKey = (key: string): string | undefined => KEYS[key];
const noTitle = () => undefined;

describe('mapTreeLabel', () => {
  it('shows the main map\'s own title as the root row, keyrefs resolved', () => {
    const root = parse(
      '<map><title><keyword keyref="product-name"/> 用户手册 <ph keyref="version"/></title>' +
        '<topicref href="a.dita"/></map>',
    );
    const label = mapTreeLabel(root, { isRoot: true, resolveKey, readTitle: noTitle, rootFallback: 'main' });
    assert.strictEqual(label, '星枢 N1 用户手册 2.1.0');
  });

  it('prefers a bookmap\'s mainbooktitle over its other title parts for the root row', () => {
    const root = parse(
      '<bookmap><title>ignored outer</title><booktitle><mainbooktitle>安装指南</mainbooktitle>' +
        '<subtitle>副标题</subtitle></booktitle><chapter href="a.dita"/></bookmap>',
    );
    const label = mapTreeLabel(root, { isRoot: true, resolveKey, readTitle: noTitle, rootFallback: 'main' });
    assert.strictEqual(label, '安装指南');
  });

  it('falls back to the map file name when the map carries no parsable title', () => {
    const root = parse('<map><topicref href="a.dita"/></map>');
    const label = mapTreeLabel(root, { isRoot: true, resolveKey, readTitle: noTitle, rootFallback: '用户手册' });
    assert.strictEqual(label, '用户手册');
  });

  it('names a submap row by the referenced map\'s own inlined title, keyrefs resolved', () => {
    // The exact shape expandDitamapRefs leaves behind: the referenced
    // map's own top-level children -- <title> included -- spliced in as
    // the mapref node's DOM children.
    const root = parse(
      '<map><mapref href="sub/develop.ditamap">' +
        '<title><keyword keyref="product-name"/> 开发者手册</title>' +
        '<topicref href="sub/api.dita"/>' +
        '</mapref></map>',
    );
    const mapref = root.children.find((c) => c.tagName === 'mapref')!;
    const label = mapTreeLabel(mapref, { isRoot: false, resolveKey, readTitle: noTitle, rootFallback: 'main' });
    assert.strictEqual(label, '星枢 N1 开发者手册');
  });

  it('reads a duplicate mapref\'s title from disk, since the second ref is never inlined', () => {
    // expandDitamapRefs skips re-inlining a map already spliced in once
    // (cycle guard), so the duplicate mapref carries no <title> child.
    const readTitle = (href: string) => (href === 'sub/develop.ditamap' ? '开发者手册' : undefined);
    const root = parse('<map><mapref href="sub/develop.ditamap"/></map>');
    const mapref = root.children[0];
    const label = mapTreeLabel(mapref, { isRoot: false, resolveKey, readTitle, rootFallback: 'main' });
    assert.strictEqual(label, '开发者手册');
  });

  it('prefers the parent map\'s own navtitle for a submap over the submap\'s title', () => {
    const root = parse(
      '<map><mapref href="sub.ditamap">' +
        '<topicmeta><navtitle>第二部分：进阶</navtitle></topicmeta>' +
        '<title>开发者手册</title>' +
        '</mapref></map>',
    );
    const mapref = root.children[0];
    const label = mapTreeLabel(mapref, { isRoot: false, resolveKey, readTitle: noTitle, rootFallback: 'main' });
    assert.strictEqual(label, '第二部分：进阶');
  });

  it('falls back to the href file name when a submap\'s title can be read neither inlined nor off disk', () => {
    const root = parse('<map><mapref href="sub/develop.ditamap"/></map>');
    const label = mapTreeLabel(root.children[0], {
      isRoot: false,
      resolveKey,
      readTitle: noTitle,
      rootFallback: 'main',
    });
    assert.strictEqual(label, 'develop', 'getDisplayNameInfo\'s href filename fallback');
  });

  it('answers a keydef by its key, never by the target topic\'s own title', () => {
    const root = parse(
      '<map>' +
        '<keydef keys="product-name"><topicmeta><keywords><keyword>星枢 N1</keyword></keywords></topicmeta></keydef>' +
        '<keydef keys="logo" href="images/logo.svg"/>' +
        '</map>',
    );
    const named = mapTreeLabel(root.children[0], { isRoot: false, resolveKey, readTitle: () => '不应对 keydef 读标题', rootFallback: 'main' });
    assert.strictEqual(named, '星枢 N1');
    // No keyword/linktext: the keys value is the keydef's identity
    const bare = mapTreeLabel(root.children[1], { isRoot: false, resolveKey, readTitle: () => '不应对 keydef 读标题', rootFallback: 'main' });
    assert.strictEqual(bare, 'logo');
  });

  it('reads a referenced topic\'s own title off disk when the map named nothing', () => {
    const root = parse('<map><topicref href="topics/install.dita"/></map>');
    const label = mapTreeLabel(root.children[0], {
      isRoot: false,
      resolveKey,
      readTitle: (href) => (href === 'topics/install.dita' ? '安装设备' : undefined),
      rootFallback: 'main',
    });
    assert.strictEqual(label, '安装设备');
  });

  it('prefers the map\'s explicit navtitle over the topic\'s own title', () => {
    const root = parse(
      '<map><topicref href="topics/install.dita"><topicmeta><navtitle>快速安装</navtitle></topicmeta></topicref></map>',
    );
    const label = mapTreeLabel(root.children[0], {
      isRoot: false,
      resolveKey,
      readTitle: () => '安装设备',
      rootFallback: 'main',
    });
    assert.strictEqual(label, '快速安装');
  });

  it('labels a bookmap structural container by its tag name', () => {
    const root = parse('<bookmap><frontmatter><chapter href="a.dita"/></frontmatter></bookmap>');
    const frontmatter = root.children[0];
    const label = mapTreeLabel(frontmatter, { isRoot: false, resolveKey, readTitle: noTitle, rootFallback: 'main' });
    assert.strictEqual(label, 'frontmatter');
  });

  it('resolves keyrefs inside an authored navtitle', () => {
    const root = parse(
      '<map><topicref href="topics/whatsnew.dita">' +
        '<topicmeta><navtitle><keyword keyref="product-name"/> 的新功能</navtitle></topicmeta>' +
        '</topicref></map>',
    );
    const label = mapTreeLabel(root.children[0], { isRoot: false, resolveKey, readTitle: noTitle, rootFallback: 'main' });
    assert.strictEqual(label, '星枢 N1 的新功能');
  });
});

describe('mapTreeLabel against a real expandDitamapRefs pass', () => {
  it('labels a mapref by the submap title expandDitamapRefs inlined from disk', () => {
    const submapXml =
      '<map><title><keyword keyref="product-name"/> 开发者手册</title><topicref href="api.dita"/></map>';
    const root = parse('<map><title>主手册</title><mapref href="sub/develop.ditamap"/></map>');
    // Matched on a path suffix rather than an absolute-path key (same style
    // as the expandDitamapRefs tests in ditaRenderUtils.test.ts):
    // expandDitamapRefs resolves the href against docDir with path.resolve,
    // which on Windows turns '/w' into '<cwd drive>:\w' -- a POSIX-shaped
    // key would miss, the reader's throw would be swallowed as a missing
    // file, and nothing would be spliced in for reasons that have nothing
    // to do with the label under test.
    expandDitamapRefs(root, '/w', (path) => {
      if (path.replace(/\\/g, '/').endsWith('/w/sub/develop.ditamap')) return submapXml;
      throw new Error(`unexpected read: ${path}`);
    });
    const mapref = root.children.find((c) => c.tagName === 'mapref')!;
    assert.ok(mapref.children.length > 0, 'the submap\'s children were spliced in');
    const label = mapTreeLabel(mapref, { isRoot: false, resolveKey, readTitle: noTitle, rootFallback: 'main' });
    assert.strictEqual(label, '星枢 N1 开发者手册');
  });
});

describe('mapTreeIconId', () => {
  it('marks the main map row with a filled map icon and submaps with a map icon', () => {
    assert.strictEqual(
      mapTreeIconId({ isRoot: true, isMapRef: false, baseType: 'map/map' }),
      'map-filled',
    );
    assert.strictEqual(
      mapTreeIconId({ isRoot: false, isMapRef: true, baseType: 'map/topicref' }),
      'map',
    );
    // A mapref whose href is external is still a map by its tag
    assert.strictEqual(
      mapTreeIconId({ isRoot: false, isMapRef: false, baseType: 'map/mapref' }),
      'map',
    );
  });

  it('marks keydefs with a key icon', () => {
    assert.strictEqual(
      mapTreeIconId({ isRoot: false, isMapRef: false, baseType: 'map/keydef' }),
      'key',
    );
  });

  it('marks groupings (topichead, bookmap structural containers) with a folder icon', () => {
    assert.strictEqual(
      mapTreeIconId({ isRoot: false, isMapRef: false, baseType: 'map/topichead' }),
      'folder',
    );
    assert.strictEqual(
      mapTreeIconId({ isRoot: false, isMapRef: false, baseType: 'map/bookmap-structural' }),
      'folder',
    );
  });

  it('gives each topic information type its own icon, as sniffed from the target file', () => {
    assert.strictEqual(TOPIC_TYPE_ICON_IDS.task, 'checklist');
    assert.strictEqual(TOPIC_TYPE_ICON_IDS.concept, 'lightbulb');
    assert.strictEqual(TOPIC_TYPE_ICON_IDS.reference, 'references');
    assert.strictEqual(TOPIC_TYPE_ICON_IDS.troubleshooting, 'wrench');
    assert.strictEqual(TOPIC_TYPE_ICON_IDS.glossentry, 'book');
    assert.strictEqual(TOPIC_TYPE_ICON_IDS.topic, 'file');
    assert.strictEqual(
      mapTreeIconId({ isRoot: false, isMapRef: false, baseType: 'map/topicref', topicType: 'task' }),
      'checklist',
    );
    assert.strictEqual(
      mapTreeIconId({ isRoot: false, isMapRef: false, baseType: 'map/topicref', topicType: 'concept' }),
      'lightbulb',
    );
  });

  it('falls back to a book icon for a numbered division whose target cannot be read, a file icon otherwise', () => {
    assert.strictEqual(
      mapTreeIconId({ isRoot: false, isMapRef: false, baseType: 'map/topicref', hasRole: true }),
      'book',
    );
    assert.strictEqual(
      mapTreeIconId({ isRoot: false, isMapRef: false, baseType: 'map/topicref' }),
      'file',
    );
  });
});
