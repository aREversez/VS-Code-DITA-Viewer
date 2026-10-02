// Webview script: the profiling (@props) filter panel and its toolbar button.
// Moved verbatim from ditaRenderUtils.ts (P5 pure refactor); a dependency-free
// leaf -- every host value it embeds comes from opts (raw strings quoted here).

export function getProfilingFilterScript(opts: {
  buttonLabel: string;
  buttonTitle: string;
  closeLabel: string;
  emptyLabel: string;
}): string {
  const btnLabel = JSON.stringify(opts.buttonLabel);
  const btnTitle = JSON.stringify(opts.buttonTitle);
  const closeLabel = JSON.stringify(opts.closeLabel);
  const emptyLabel = JSON.stringify(opts.emptyLabel);
  return `
  // ── Profiling filter panel ──
  // Phase 2 of profiling support: the highlight toggle (built earlier in
  // this script) only ever shows/hides the *decoration* -- the content
  // stays visible either way. This panel actually hides content, scoped to
  // whichever attribute/value combinations the person unchecks, using the
  // data-profile-keys the renderer stamped on every .profiled element.
  // Deliberately a separate control from the highlight toggle: "show me
  // what's flagged" and "show me what this would look like built for X"
  // are different questions, and conflating them into one button would
  // make neither easy to reach.
  var pfPanel = null;
  var pfExcluded = {};

  // Whether the Filter button itself reflects "something is actually being
  // hidden right now" -- mirrors the Flags button's own highlight-on-active
  // treatment (applyProfilingToggle above) so the two controls read the
  // same way. Computed from pfExcluded rather than from panel-open state:
  // the person should still see the button lit up after closing the panel
  // if a filter is still in effect.
  function pfUpdateButtonState() {
    var active = false;
    for (var k in pfExcluded) { if (pfExcluded.hasOwnProperty(k)) { active = true; break; } }
    pfFilterBtn.style.background = active ? 'var(--color-profiling-label-bg)' : '';
    pfFilterBtn.style.color = active ? 'var(--color-profiling-label-text)' : '';
  }

  function pfApplyFilter() {
    var els = document.querySelectorAll('[data-profile-keys]');
    for (var i = 0; i < els.length; i++) {
      var keys = els[i].getAttribute('data-profile-keys').split(',');
      var hide = false;
      for (var j = 0; j < keys.length; j++) {
        if (pfExcluded[keys[j]]) { hide = true; break; }
      }
      els[i].classList.toggle('profile-filtered-out', hide);
    }
    pfUpdateButtonState();
  }

  function pfBuildPanel() {
    var groups = {};
    var groupOrder = [];
    var els = document.querySelectorAll('[data-profile-keys]');
    for (var i = 0; i < els.length; i++) {
      var keys = els[i].getAttribute('data-profile-keys').split(',');
      for (var j = 0; j < keys.length; j++) {
        var parts = keys[j].split(':');
        var attr = decodeURIComponent(parts[0]);
        var val = decodeURIComponent(parts[1]);
        if (!groups[attr]) { groups[attr] = {}; groupOrder.push(attr); }
        groups[attr][val] = keys[j];
      }
    }
    groupOrder.sort();

    // Anchored to the toolbar's own bottom-right corner (computed from its
    // live rect, not a hardcoded offset, so it stays correct if the
    // toolbar's height/width ever changes) rather than the fixed
    // top:40px;left:8px it used to use. Popping up right under the button
    // that opened it, on the same side as the toolbar, means the person
    // never has to move their eyes across the window to find it.
    var toolbarRect = toolbar.getBoundingClientRect();
    var panel = document.createElement('div');
    panel.id = '__profiling_filter_panel';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', ${btnLabel});
    panel.style.cssText = 'position:fixed;top:' + (toolbarRect.bottom + 6) + 'px;right:8px;z-index:10000;max-height:70vh;overflow:auto;padding:8px 10px;border-radius:5px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:12px;background:var(--vscode-editor-background,rgba(30,30,30,0.95));border:1px solid var(--vscode-widget-border,rgba(255,255,255,0.12));backdrop-filter:blur(4px);box-shadow:0 2px 8px rgba(0,0,0,0.2);color:var(--vscode-foreground,#ccc);min-width:160px;';

    if (groupOrder.length === 0) {
      var empty = document.createElement('div');
      empty.textContent = ${emptyLabel};
      empty.style.cssText = 'color:var(--vscode-descriptionForeground,#999);';
      panel.appendChild(empty);
    }

    for (var g = 0; g < groupOrder.length; g++) {
      var attrName = groupOrder[g];
      var heading = document.createElement('div');
      heading.textContent = attrName.charAt(0).toUpperCase() + attrName.slice(1);
      heading.style.cssText = 'font-weight:600;margin:6px 0 2px;';
      if (g === 0) heading.style.marginTop = '0';
      panel.appendChild(heading);

      var values = Object.keys(groups[attrName]).sort();
      for (var v = 0; v < values.length; v++) {
        var val = values[v];
        var rawKey = groups[attrName][val];
        var row = document.createElement('label');
        row.style.cssText = 'display:flex;align-items:center;gap:5px;padding:1px 0;cursor:pointer;white-space:nowrap;';
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !pfExcluded[rawKey];
        (function(key) {
          cb.addEventListener('change', function(e) {
            if (e.target.checked) { delete pfExcluded[key]; } else { pfExcluded[key] = true; }
            pfApplyFilter();
            // Hidden text is not searchable, so the match set just changed.
            if (typeof refreshSearchAfterDomChange === 'function') refreshSearchAfterDomChange();
          });
        })(rawKey);
        row.appendChild(cb);
        var txt = document.createElement('span');
        txt.textContent = val;
        row.appendChild(txt);
        panel.appendChild(row);
      }
    }

    var closeLink = document.createElement('a');
    closeLink.href = '#';
    closeLink.setAttribute('role', 'button');
    closeLink.textContent = ${closeLabel};
    closeLink.style.cssText = 'display:block;margin-top:8px;color:var(--vscode-textLink-foreground,#3794ff);cursor:pointer;';
    closeLink.addEventListener('click', function(e) { e.preventDefault(); pfTogglePanel(); });
    panel.appendChild(closeLink);

    return panel;
  }

  function pfTogglePanel() {
    if (pfPanel) {
      pfPanel.remove();
      pfPanel = null;
      return;
    }
    pfPanel = pfBuildPanel();
    document.body.appendChild(pfPanel);
  }

  var pfFilterBtn = document.createElement('button');
  pfFilterBtn.textContent = ${btnLabel};
  pfFilterBtn.title = ${btnTitle};
  pfFilterBtn.setAttribute('aria-label', ${btnTitle});
  pfFilterBtn.style.cssText = btnStyle;
  pfFilterBtn.addEventListener('click', pfTogglePanel);
  pfUpdateButtonState();
  toolbar.appendChild(pfFilterBtn);
`;
}
