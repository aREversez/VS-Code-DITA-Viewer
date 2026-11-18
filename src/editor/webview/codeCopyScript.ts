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
export function getCodeCopyScript(opts: {
  copyTitle: string;
  doneLabel: string;
  failedLabel: string;
}): string {
  const copyTitle = JSON.stringify(opts.copyTitle);
  const doneLabel = JSON.stringify(opts.doneLabel);
  const failedLabel = JSON.stringify(opts.failedLabel);
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

    function flash(chip, ok) {
      // The first click remembers the language; a click during feedback must
      // not capture the feedback text as the "original".
      var orig = chip.getAttribute('data-orig-label');
      if (orig === null) {
        orig = chip.textContent;
        chip.setAttribute('data-orig-label', orig);
      }
      chip.textContent = ok ? DONE_LABEL : FAILED_LABEL;
      if (chip.__dvCopyTimer) clearTimeout(chip.__dvCopyTimer);
      chip.__dvCopyTimer = setTimeout(function() {
        chip.textContent = orig;
        chip.removeAttribute('data-orig-label');
        chip.__dvCopyTimer = 0;
      }, FEEDBACK_MS);
    }

    document.addEventListener('click', function(e) {
      var chip = chipOf(e.target);
      if (!chip) return;
      var wrap = chip.closest('.codeblock-wrap');
      var pre = wrap && wrap.querySelector('pre');
      if (!pre) return;
      copyText(pre.textContent || '').then(function(ok) { flash(chip, ok); });
    });
  })();
`;
}
