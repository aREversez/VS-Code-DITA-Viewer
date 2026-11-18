// Webview script: click a code block's language chip to copy the block's code.
//
// The core renderer wraps a <codeblock> that carries a language in
// <div class="codeblock-wrap"><pre>…</pre><div class="codeblock-lang">xml</div></div>
// (packages/core/src/render/baseTypeMap.ts). The chip is a sibling of <pre>,
// not a child, so the copied text is the <pre>'s textContent -- never the chip
// label -- and a block without a language has no chip and so no copy target.
//
// Same conventions as lightboxScript.ts: a dependency-free leaf, every
// listener registered on `document` (delegation), so replacing
// #dita-content-root's HTML or book mode's per-entry patches never orphans
// anything and nothing needs re-running from a content-swap hook. All three
// strings are raw values, quoted here internally.
//
// styles.css keeps `.codeblock-lang` inert (pointer-events: none) for hosts
// that don't run this script; the script marks <html> with `dv-code-copy`,
// and `.dv-code-copy .codeblock-lang` turns the chip into a clickable one.
// The renderer emits the chip as a plain <div> (it must stay an inert label
// in the diff view and exported HTML), so the button semantics -- role,
// tabindex, Enter/Space activation and a polite live region for the result
// -- are added here, once at startup and via MutationObserver for every
// later content swap or book-mode patch (same self-maintaining shape as
// imageMapScript's rescale observer).
export function getCodeCopyScript(opts: {
  copyTitle: string;
  doneLabel: string;
  failedLabel: string;
}): string {
  // JSON.stringify alone leaves `<` literal, so a label containing
  // `</script>` would close the surrounding <script> element when this
  // string is interpolated into the webview HTML. \u003c decodes to the
  // exact same JS string but cannot terminate the HTML script block.
  const jsString = (s: string) => JSON.stringify(s).replace(/</g, '\\u003c');
  const copyTitle = jsString(opts.copyTitle);
  const doneLabel = jsString(opts.doneLabel);
  const failedLabel = jsString(opts.failedLabel);
  return `
  (function() {
    var COPY_TITLE = ${copyTitle};
    var DONE_LABEL = ${doneLabel};
    var FAILED_LABEL = ${failedLabel};
    var FEEDBACK_MS = 1200;
    document.documentElement.classList.add('dv-code-copy');

    function chipOf(target) {
      return target && target.closest ? target.closest('.codeblock-lang') : null;
    }

    // Tooltip is set lazily on hover so it needs no pass over the DOM after
    // a content swap.
    document.addEventListener('mouseover', function(e) {
      var chip = chipOf(e.target);
      if (chip && !chip.title) chip.title = COPY_TITLE;
    });

    // Button semantics for keyboard and screen-reader users. Idempotent:
    // re-enhancing an already-enhanced chip changes nothing.
    function enhance(chip) {
      if (!chip.getAttribute('role')) {
        chip.setAttribute('role', 'button');
        chip.setAttribute('tabindex', '0');
      }
      if (!chip.title) chip.title = COPY_TITLE;
    }

    function enhanceIn(node) {
      if (!node || node.nodeType !== 1) return;
      if (node.matches && node.matches('.codeblock-lang')) enhance(node);
      if (!node.querySelectorAll) return;
      var chips = node.querySelectorAll('.codeblock-lang');
      for (var i = 0; i < chips.length; i++) enhance(chips[i]);
    }

    // One pass at startup, then the observer covers every content swap and
    // book-mode patch -- no re-run from a content-swap hook, same shape as
    // imageMapScript's rescale observer.
    enhanceIn(document.body);
    if (typeof MutationObserver === 'function') {
      new MutationObserver(function(records) {
        for (var i = 0; i < records.length; i++) {
          var added = records[i].addedNodes;
          for (var j = 0; j < added.length; j++) enhanceIn(added[j]);
        }
      }).observe(document.documentElement, { childList: true, subtree: true });
    }

    // Fallback for hosts where the async clipboard API is missing or refuses
    // (it needs a focused document and a user gesture).
    function legacyCopy(text) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        ta.remove();
        return !!ok;
      } catch (err) {
        return false;
      }
    }

    function copyText(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).then(
          function() { return true; },
          function() { return legacyCopy(text); }
        );
      }
      return Promise.resolve(legacyCopy(text));
    }

    // One visually-hidden polite live region announces the copy result;
    // swapping the chip's own text is not reliably read by screen readers.
    // Created lazily on the first copy and reused; it lives on <body>, so
    // content swaps inside #dita-content-root never remove it.
    var liveRegion = null;
    function announce(msg) {
      if (!liveRegion) {
        liveRegion = document.createElement('div');
        liveRegion.setAttribute('aria-live', 'polite');
        liveRegion.style.position = 'fixed';
        liveRegion.style.width = '1px';
        liveRegion.style.height = '1px';
        liveRegion.style.overflow = 'hidden';
        liveRegion.style.clipPath = 'inset(50%)';
        document.body.appendChild(liveRegion);
      }
      liveRegion.textContent = msg;
    }

    function flash(chip, ok) {
      // The first click remembers the language; a click during feedback must
      // not capture the feedback text as the "original".
      var orig = chip.getAttribute('data-orig-label');
      if (orig === null) {
        orig = chip.textContent;
        chip.setAttribute('data-orig-label', orig);
      }
      var label = ok ? DONE_LABEL : FAILED_LABEL;
      chip.textContent = label;
      announce(label);
      if (chip.__dvCopyTimer) clearTimeout(chip.__dvCopyTimer);
      chip.__dvCopyTimer = setTimeout(function() {
        chip.textContent = orig;
        chip.removeAttribute('data-orig-label');
        chip.__dvCopyTimer = 0;
      }, FEEDBACK_MS);
    }

    function copyChip(chip) {
      var wrap = chip.closest('.codeblock-wrap');
      var pre = wrap && wrap.querySelector('pre');
      if (!pre) return;
      copyText(pre.textContent || '').then(function(ok) { flash(chip, ok); });
    }

    document.addEventListener('click', function(e) {
      var chip = chipOf(e.target);
      if (chip) copyChip(chip);
    });

    // Enter/Space activate the focused chip like a native button.
    document.addEventListener('keydown', function(e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var chip = chipOf(e.target);
      if (!chip) return;
      e.preventDefault();
      copyChip(chip);
    });
  })();
`;
}
