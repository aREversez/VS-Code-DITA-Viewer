// Webview script: the momentary highlight box of the topic preview, and the
// grouping that lets a merged conref run light up as one region. Moved out of
// topicScript.ts verbatim so it can be executed in a test -- nothing else in
// that file's template literal could be, and this logic (which elements form a
// run, which of them get the tint, how the highlight fades and is replaced)
// was previously covered by no test at all.
//
// Reads only `document`, `setTimeout` and `clearTimeout`; defines functions and
// a little state, runs nothing. The caller (topicScript.ts) supplies the
// scroll-sync side: findContaining picks the clicked element, then
// findRunElements / highlightElements below paint it.

export function getHighlightRunScript(): string {
  return `
  // A highlight is meant to be a momentary "here's where the cursor is"
  // cue, not a permanent marker -- previously nothing ever removed the
  // '__hl' class except a *later* highlight replacing it, so if the user
  // stopped moving the source cursor (or switched away from the editor)
  // the box stayed on screen indefinitely. hlClearTimer/hlFadeTimer below
  // give it a lifetime: it sits fully visible briefly, then CSS-fades out
  // over HL_FADE_MS, then the class is removed entirely so a stale
  // reference to el isn't left sitting in a closure.
  var HL_VISIBLE_MS = 1500;
  var HL_FADE_MS = 600;
  var hlFadeTimer = null;
  var hlClearTimer = null;
  // The elements currently highlighted, so a later highlight can clear them
  // all (a merged run is more than one box) rather than only the single
  // element a querySelector('.__hl') would find.
  var hlActive = [];

  // The full source range an element was stamped with. A conref/conkeyref/
  // conrefend merge re-stamps every transplanted node with the referencing
  // element's own range (see renderer.ts stampSourceRange), so a whole merged
  // run shares one identical key -- which is what lets us regroup them here.
  function rangeKey(el) {
    return el.getAttribute('data-line') + ':' + el.getAttribute('data-end-line') + ':' +
      el.getAttribute('data-start-col') + ':' + el.getAttribute('data-end-col');
  }

  // Every [data-line] element sharing best's exact range, reduced to the
  // outermost box of each contiguous group: a member whose parent is itself a
  // member is left out, so the tint paints each top-level box once instead of
  // stacking a translucent layer per nested child (which would darken the
  // overlaps and re-create the many-boxes look). For a normal element -- whose
  // children carry their own narrower ranges -- this is just that element.
  function findRunElements(best) {
    var all = document.querySelectorAll('[data-line]');
    var key = rangeKey(best);
    var members = [];
    for (var i = 0; i < all.length; i++) {
      if (rangeKey(all[i]) === key) members.push(all[i]);
    }
    var roots = members.filter(function (el) {
      return !el.parentElement || members.indexOf(el.parentElement) === -1;
    });
    return { isRun: members.length > 1, els: roots };
  }

  function clearHighlight() {
    if (hlFadeTimer) { clearTimeout(hlFadeTimer); hlFadeTimer = null; }
    if (hlClearTimer) { clearTimeout(hlClearTimer); hlClearTimer = null; }
    for (var i = 0; i < hlActive.length; i++) {
      hlActive[i].classList.remove('__hl');
      hlActive[i].classList.remove('__hl-run');
      hlActive[i].classList.remove('__hl-fade');
    }
    hlActive = [];
  }

  function highlightElements(els, isRun) {
    clearHighlight();
    if (!els || !els.length) return;
    for (var i = 0; i < els.length; i++) {
      els[i].classList.add('__hl');
      if (isRun) els[i].classList.add('__hl-run');
    }
    hlActive = els.slice();
    hlFadeTimer = setTimeout(function() {
      for (var j = 0; j < els.length; j++) els[j].classList.add('__hl-fade');
      hlClearTimer = setTimeout(function() {
        for (var k = 0; k < els.length; k++) {
          els[k].classList.remove('__hl');
          els[k].classList.remove('__hl-run');
          els[k].classList.remove('__hl-fade');
        }
        hlActive = [];
      }, HL_FADE_MS);
    }, HL_VISIBLE_MS);
  }
`;
}
