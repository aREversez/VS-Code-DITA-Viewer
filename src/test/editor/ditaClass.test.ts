import * as assert from 'assert';
import {
  chainHas,
  classChain,
  classElementTag,
  classPairTag,
  classSyntaxProblem,
  defaultClassOf,
  effectiveClassOf,
  isDitaDoctype,
  readDoctype,
  sideOfRoot,
} from '../../editor/ditaClass';

/**
 * The @class helpers the completeness checks are built on: the generated DTD
 * default table, the precedence of a written @class over it, the topic/map
 * split, and the observed syntax rules.
 */

describe('the generated @class table', () => {
  it('keeps the topic and map vocabularies apart', () => {
    assert.strictEqual(defaultClassOf('shortdesc', 'topic'), '- topic/shortdesc');
    assert.strictEqual(defaultClassOf('shortdesc', 'map'), '- map/shortdesc');
  });

  it('has no map entry for an element whose class belongs to the topic vocabulary', () => {
    // A map's <title> carries the topic default; the map table is bucketed by
    // the first pair, so the lookup on that side finds nothing.
    assert.strictEqual(defaultClassOf('title', 'topic'), '- topic/title');
    assert.strictEqual(defaultClassOf('title', 'map'), undefined);
  });

  it('carries a specialization chain, most general ancestor first', () => {
    assert.strictEqual(defaultClassOf('step', 'topic'), '- topic/li task/step');
    assert.strictEqual(defaultClassOf('chapter', 'map'), '- map/topicref bookmap/chapter');
    assert.strictEqual(defaultClassOf('bookmap', 'map'), '- map/map bookmap/bookmap');
  });

  it('does not know a vocabulary the scan leaves out', () => {
    // learning/ is not scanned (see the header of ditaClassDefaults.ts), so an
    // element from it has no known class and the checks skip it.
    assert.strictEqual(defaultClassOf('lcAssessment', 'topic'), undefined);
    assert.strictEqual(defaultClassOf('not-an-element', 'map'), undefined);
  });
});

describe('class chains', () => {
  it('drops the scope marker and keeps the module/tag pairs', () => {
    assert.deepStrictEqual(classChain('- topic/li task/step '), ['topic/li', 'task/step']);
    assert.deepStrictEqual(classChain('+ topic/ph hi-d/b'), ['topic/ph', 'hi-d/b']);
    assert.deepStrictEqual(classChain('- topic/p'), ['topic/p']);
  });

  it('has no pairs for a missing or unreadable value', () => {
    assert.deepStrictEqual(classChain(undefined), []);
    assert.deepStrictEqual(classChain(''), []);
    assert.deepStrictEqual(classChain('-'), []);
  });

  it('reads the tag half of a pair', () => {
    assert.strictEqual(classPairTag('task/step'), 'step');
    assert.strictEqual(classPairTag('step'), 'step');
  });

  it('names the element itself from the last pair', () => {
    assert.strictEqual(classElementTag('- topic/li task/step '), 'step');
    assert.strictEqual(classElementTag('- topic/p'), 'p');
    assert.strictEqual(classElementTag(undefined), undefined);
  });

  it('finds any ancestor pair in the chain', () => {
    assert.strictEqual(chainHas('- topic/li task/step ', 'topic/li'), true);
    assert.strictEqual(chainHas('- topic/li task/step ', 'task/step'), true);
    assert.strictEqual(chainHas('- topic/li task/step ', 'topic/p'), false);
    assert.strictEqual(chainHas(undefined, 'topic/p'), false);
  });
});

describe('effective @class', () => {
  it('takes a written value over the DTD default, even a wrong-looking one', () => {
    assert.strictEqual(effectiveClassOf('p', '+ topic/p my-d/myp', 'topic'), '+ topic/p my-d/myp');
    assert.strictEqual(effectiveClassOf('b', '- topic/b ', 'topic'), '- topic/b ');
  });

  it('treats a written empty value as written', () => {
    assert.strictEqual(effectiveClassOf('p', '', 'topic'), '');
  });

  it('falls back to the table for the element\'s own side only', () => {
    assert.strictEqual(effectiveClassOf('p', undefined, 'topic'), '- topic/p');
    assert.strictEqual(effectiveClassOf('shortdesc', undefined, 'map'), '- map/shortdesc');
  });

  it('has nothing when neither the file nor the table says', () => {
    assert.strictEqual(effectiveClassOf('lcAssessment', undefined, 'topic'), undefined);
  });
});

describe('the side of a file', () => {
  it('reads a map root from the class chain', () => {
    assert.strictEqual(sideOfRoot('bookmap', undefined), 'map');
    assert.strictEqual(sideOfRoot('mybook', '- map/map bookmap/bookmap my-d/mybook'), 'map');
  });

  it('reads a topic root from the class chain', () => {
    assert.strictEqual(sideOfRoot('task', undefined), 'topic');
    assert.strictEqual(sideOfRoot('mytopic', '+ topic/topic my-d/mytopic'), 'topic');
  });

  it('falls back to the root tag, then to topic', () => {
    assert.strictEqual(sideOfRoot('map', undefined), 'map');
    assert.strictEqual(sideOfRoot('unknown-root', undefined), 'topic');
  });
});

describe('written @class syntax', () => {
  it('rejects an empty value', () => {
    assert.strictEqual(classSyntaxProblem(''), 'empty');
    assert.strictEqual(classSyntaxProblem('   '), 'empty');
  });

  it('requires the leading scope marker', () => {
    assert.strictEqual(classSyntaxProblem('topic/p '), 'no-marker');
  });

  it('requires the trailing separator', () => {
    assert.strictEqual(classSyntaxProblem('- topic/p'), 'no-trailing-space');
  });

  it('accepts the value the DTD itself declares', () => {
    assert.strictEqual(classSyntaxProblem('- topic/p '), undefined);
    assert.strictEqual(classSyntaxProblem('+ topic/ph hi-d/b '), undefined);
  });
});

describe('DOCTYPE reading', () => {
  it('has nothing for a file without a declaration', () => {
    assert.strictEqual(readDoctype('<?xml version="1.0"?><topic/>'), undefined);
  });

  it('reads a PUBLIC identifier and its system id', () => {
    const raw = '<?xml version="1.0"?>\n<!DOCTYPE topic PUBLIC "-//OASIS//DTD DITA Topic//EN" "topic.dtd">\n<topic/>';
    assert.deepStrictEqual(readDoctype(raw), {
      publicId: '-//OASIS//DTD DITA Topic//EN',
      systemId: 'topic.dtd',
    });
  });

  it('reads a SYSTEM identifier alone', () => {
    assert.deepStrictEqual(readDoctype('<!DOCTYPE topic SYSTEM "../dtd/topic.dtd"><topic/>'), {
      systemId: '../dtd/topic.dtd',
    });
  });

  it('skips an internal subset that contains a closing angle bracket', () => {
    const raw = '<!DOCTYPE topic SYSTEM "about:legacy-compat" [\n<!ENTITY gt "a > b">\n]>\n<topic/>';
    assert.deepStrictEqual(readDoctype(raw), { systemId: 'about:legacy-compat' });
  });

  it('honours single quotes', () => {
    assert.deepStrictEqual(readDoctype("<!DOCTYPE topic SYSTEM 'topic.dtd'><topic/>"), {
      systemId: 'topic.dtd',
    });
  });
});

describe('DITA DOCTYPE recognition', () => {
  it('accepts every OASIS DITA public identifier', () => {
    assert.strictEqual(isDitaDoctype({ publicId: '-//OASIS//DTD DITA Topic//EN', systemId: 'topic.dtd' }), true);
    assert.strictEqual(isDitaDoctype({ publicId: '-//OASIS//DTD DITA BookMap//EN', systemId: 'bookmap.dtd' }), true);
  });

  it('falls back to the root DTD a system id names', () => {
    assert.strictEqual(isDitaDoctype({ systemId: '../org.oasis-open.dita.v1_3/dtd/technicalContent/dtd/task.dtd' }), true);
    assert.strictEqual(isDitaDoctype({ systemId: 'C:\\dtd\\map.dtd' }), true);
  });

  it('rejects another vocabulary and a missing declaration', () => {
    assert.strictEqual(isDitaDoctype({ publicId: '-//W3C//DTD XHTML 1.0 Strict//EN', systemId: 'xhtml1-strict.dtd' }), false);
    assert.strictEqual(isDitaDoctype({ systemId: 'config.dtd' }), false);
    assert.strictEqual(isDitaDoctype({}), false);
    assert.strictEqual(isDitaDoctype(undefined), false);
  });
});
