import * as assert from 'assert';
import { parseMapViewState, nextMapViewState, MapViewState } from '../../editor/mapViewState';

describe('parseMapViewState', () => {
  it('accepts each mode, with or without a site page', () => {
    assert.deepStrictEqual(parseMapViewState({ mode: 'tree' }), { mode: 'tree' });
    assert.deepStrictEqual(parseMapViewState({ mode: 'book' }), { mode: 'book' });
    assert.deepStrictEqual(parseMapViewState({ mode: 'site', sitePage: '/w/a.dita' }), { mode: 'site', sitePage: '/w/a.dita' });
  });

  it('has nothing to say about a missing or non-object entry', () => {
    for (const raw of [undefined, null, 'site', 3, ['site']]) {
      assert.strictEqual(parseMapViewState(raw), undefined);
    }
  });

  it('falls back to the outline tree for an unknown mode (a value from a newer or older version) but keeps the page', () => {
    assert.deepStrictEqual(parseMapViewState({ mode: 'wiki', sitePage: '/w/a.dita' }), { mode: 'tree', sitePage: '/w/a.dita' });
    assert.deepStrictEqual(parseMapViewState({ sitePage: '/w/a.dita' }), { mode: 'tree', sitePage: '/w/a.dita' });
  });

  it('drops a site page that is not a non-empty string', () => {
    for (const sitePage of [42, '', null, {}, ['/w/a.dita']]) {
      assert.deepStrictEqual(parseMapViewState({ mode: 'site', sitePage }), { mode: 'site' });
    }
  });
});

describe('nextMapViewState', () => {
  const site: MapViewState = { mode: 'site', sitePage: '/w/a.dita' };

  it('writes nothing while everything is still the default', () => {
    assert.strictEqual(nextMapViewState(undefined, 'tree', undefined), undefined);
  });

  it('writes nothing when neither the mode nor the page changed', () => {
    assert.strictEqual(nextMapViewState(site, 'site', '/w/a.dita'), undefined);
    assert.strictEqual(nextMapViewState({ mode: 'book' }, 'book', undefined), undefined);
  });

  it('records a mode change and a page change', () => {
    assert.deepStrictEqual(nextMapViewState(undefined, 'book', undefined), { mode: 'book' });
    assert.deepStrictEqual(nextMapViewState(undefined, 'site', '/w/a.dita'), site);
    assert.deepStrictEqual(nextMapViewState(site, 'site', '/w/b.dita'), { mode: 'site', sitePage: '/w/b.dita' });
  });

  it('keeps the last site page while the mode moves away from site and back', () => {
    // Leaving site mode for book mode must not forget which page the reader was on.
    assert.deepStrictEqual(nextMapViewState(site, 'book', undefined), { mode: 'book', sitePage: '/w/a.dita' });
    assert.deepStrictEqual(nextMapViewState(site, 'tree', undefined), { mode: 'tree', sitePage: '/w/a.dita' });
  });

  it('records a return to the outline tree once something else was remembered', () => {
    assert.deepStrictEqual(nextMapViewState({ mode: 'book' }, 'tree', undefined), { mode: 'tree' });
  });
});
