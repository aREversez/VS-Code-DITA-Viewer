// Webview script: the profiling (@props) filter panel and its toolbar button.
// Moved verbatim from ditaRenderUtils.ts (P5 pure refactor); a dependency-free
// leaf -- every host value it embeds comes from opts (raw strings quoted here).

export function getProfilingFilterScript(opts: {
  buttonLabel: string;
  buttonTitle: string;
  closeLabel: string;
  emptyLabel: string;
  // The DITAVAL row at the top of the panel. The three message types are raw
  // (unquoted) strings, like the other helpers' msgType options: the webview
  // asks the host to choose or clear a file, and the host answers with
  // setMsgType carrying the parsed rules (or null).
  ditavalNone: string;
  ditavalChoose: string;
  ditavalChange: string;
  ditavalClear: string;
  ditavalByFile: string;
  chooseMsgType: string;
  clearMsgType: string;
  setMsgType: string;
}): string {
  const btnLabel = JSON.stringify(opts.buttonLabel);
  const btnTitle = JSON.stringify(opts.buttonTitle);
  const closeLabel = JSON.stringify(opts.closeLabel);
  const emptyLabel = JSON.stringify(opts.emptyLabel);
  const ditavalNone = JSON.stringify(opts.ditavalNone);
  const ditavalChoose = JSON.stringify(opts.ditavalChoose);
  const ditavalChange = JSON.stringify(opts.ditavalChange);
  const ditavalClear = JSON.stringify(opts.ditavalClear);
  const ditavalByFile = JSON.stringify(opts.ditavalByFile);
  const chooseMsgType = JSON.stringify(opts.chooseMsgType);
  const clearMsgType = JSON.stringify(opts.clearMsgType);
  const setMsgType = JSON.stringify(opts.setMsgType);
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

  // The .ditaval in force, { name, rules, error? }, or null. The host seeds it
  // (window.__ditaval) so a full re-render keeps it, and replaces it with a
  // setDitaval message when the person chooses or clears a file. It is a layer
  // of its own on top of pfExcluded: a value the file leaves out shows
  // unticked and disabled, because ticking it could not bring the content back
  // (the same rule as the Obsidian plugin's panel), and clearing the file
  // restores exactly what was ticked by hand.
  var pfDitaval = window.__ditaval || null;
  // Never acted on by a .ditaval (DITA-OT filters audience, platform, product,
  // otherprops, props and their specialisations only); kept in step with
  // NOT_DITAVAL_FILTERABLE in packages/core/src/profiling.ts.
  var pfNotDitavalFilterable = { base: true, importance: true, rev: true, status: true };

  // What the file says to do with one value of one attribute; 'include' when it
  // is silent. Same lookup as the core's ditavalAction: an explicit val rule
  // wins, else the attribute-wide default (a rule with no val), else include.
  function pfDitavalAction(att, val) {
    if (!pfDitaval || !pfDitaval.rules || pfNotDitavalFilterable[att] === true) return 'include';
    var fallback = 'include';
    for (var i = 0; i < pfDitaval.rules.length; i++) {
      var rule = pfDitaval.rules[i];
      if (rule.att !== att) continue;
      if (rule.val === val) return rule.action;
      if (rule.val === undefined || rule.val === null) fallback = rule.action;
    }
    return fallback;
  }

  function pfDitavalActive() {
    if (!pfDitaval || !pfDitaval.rules) return false;
    for (var i = 0; i < pfDitaval.rules.length; i++) {
      if (pfDitaval.rules[i].action === 'exclude') return true;
    }
    return false;
  }

  // An element's profiling values, attribute -> [value], read back from its
  // data-profile-keys the way the core's profileValuesOfKeys does. The renderer
  // splits every attribute on whitespace, which cuts props="platform(a b)" in
  // two; joining an attribute's tokens again restores the text, and props is
  // then expanded into the attributes it generalises.
  function pfValuesOfKeys(keysAttr) {
    var raw = {};
    var pairs = (keysAttr || '').split(',');
    for (var i = 0; i < pairs.length; i++) {
      var colon = pairs[i].indexOf(':');
      if (colon <= 0) continue;
      var att, value;
      try {
        att = decodeURIComponent(pairs[i].slice(0, colon));
        value = decodeURIComponent(pairs[i].slice(colon + 1));
      } catch (err) { continue; }
      (raw[att] = raw[att] || []).push(value);
    }
    var out = {};
    function add(name, tokens) {
      if (tokens.length === 0) return;
      (out[name] = out[name] || []).push.apply(out[name], tokens);
    }
    function split(text) { return text.split(/\\s+/).filter(Boolean); }
    for (var name in raw) {
      if (!Object.prototype.hasOwnProperty.call(raw, name)) continue;
      var text = raw[name].join(' ');
      if (name === 'props') {
        var bare = text.replace(/([^\\s()]+)\\(([^)]*)\\)/g, function(_m, group, values) {
          add(group, split(values));
          return ' ';
        });
        add('props', split(bare));
      } else {
        add(name, split(text));
      }
    }
    return out;
  }

  // The core's isExcluded, for the file's layer: an element goes when, for any
  // one attribute, EVERY one of its values is excluded -- audience="internal
  // admin" stays when only internal is.
  function pfDitavalHides(keysAttr) {
    if (!pfDitavalActive()) return false;
    var values = pfValuesOfKeys(keysAttr);
    for (var att in values) {
      if (!Object.prototype.hasOwnProperty.call(values, att)) continue;
      var list = values[att];
      var all = list.length > 0;
      for (var i = 0; i < list.length && all; i++) {
        if (pfDitavalAction(att, list[i]) !== 'exclude') all = false;
      }
      if (all) return true;
    }
    return false;
  }

  // Whether the Filter button itself reflects "something is actually being
  // hidden right now" -- mirrors the Flags button's own highlight-on-active
  // treatment (applyProfilingToggle above) so the two controls read the
  // same way. Computed from pfExcluded rather than from panel-open state:
  // the person should still see the button lit up after closing the panel
  // if a filter is still in effect.
  function pfUpdateButtonState() {
    var active = pfDitavalActive();
    for (var k in pfExcluded) { if (pfExcluded.hasOwnProperty(k)) { active = true; break; } }
    pfFilterBtn.style.background = active ? 'var(--color-profiling-label-bg)' : '';
    pfFilterBtn.style.color = active ? 'var(--color-profiling-label-text)' : '';
  }

  function pfApplyFilter() {
    var els = document.querySelectorAll('[data-profile-keys]');
    for (var i = 0; i < els.length; i++) {
      var keysAttr = els[i].getAttribute('data-profile-keys');
      var keys = keysAttr.split(',');
      var hide = false;
      for (var j = 0; j < keys.length; j++) {
        if (pfExcluded[keys[j]]) { hide = true; break; }
      }
      if (!hide) hide = pfDitavalHides(keysAttr);
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

    // ── the .ditaval ──
    var fileRow = document.createElement('div');
    fileRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin:0 0 6px;padding-bottom:6px;border-bottom:1px solid var(--vscode-widget-border,rgba(255,255,255,0.12));';
    var fileLabel = document.createElement('span');
    fileLabel.textContent = 'DITAVAL';
    fileLabel.style.cssText = 'font-weight:600;';
    fileRow.appendChild(fileLabel);
    var fileName = document.createElement('span');
    fileName.textContent = pfDitaval ? pfDitaval.name : ${ditavalNone};
    fileName.style.cssText = 'flex:1;min-width:60px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--vscode-descriptionForeground,#999);';
    if (pfDitaval) fileName.title = pfDitaval.name;
    fileRow.appendChild(fileName);
    function pfFileButton(text, onClick) {
      var b = document.createElement('button');
      b.textContent = text;
      b.style.cssText = 'font:inherit;padding:1px 7px;border-radius:3px;cursor:pointer;border:1px solid var(--vscode-button-border,var(--vscode-widget-border,rgba(255,255,255,0.12)));background:var(--vscode-button-secondaryBackground,transparent);color:var(--vscode-button-secondaryForeground,inherit);';
      b.addEventListener('click', onClick);
      return b;
    }
    // The message types are written out at each post, not passed around: the
    // message parity check (scripts/check-map-message-parity.cjs) can only
    // pair a post with the provider's route when the type is a literal here.
    fileRow.appendChild(pfFileButton(pfDitaval ? ${ditavalChange} : ${ditavalChoose}, function() { vscode.postMessage({ type: ${chooseMsgType} }); }));
    if (pfDitaval) fileRow.appendChild(pfFileButton(${ditavalClear}, function() { vscode.postMessage({ type: ${clearMsgType} }); }));
    panel.appendChild(fileRow);
    if (pfDitaval && pfDitaval.error) {
      var fileError = document.createElement('div');
      fileError.textContent = pfDitaval.error;
      fileError.setAttribute('role', 'alert');
      fileError.style.cssText = 'margin:0 0 6px;max-width:260px;white-space:normal;color:var(--vscode-errorForeground,#f48771);';
      panel.appendChild(fileError);
    }

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
        var byFile = pfDitavalAction(attrName, val) === 'exclude';
        cb.checked = !byFile && !pfExcluded[rawKey];
        if (byFile) {
          // The file decides; a tick here could not bring the content back.
          cb.disabled = true;
          row.title = ${ditavalByFile};
          row.style.opacity = '0.6';
          row.style.cursor = 'default';
        } else {
          (function(key) {
            cb.addEventListener('change', function(e) {
              if (e.target.checked) { delete pfExcluded[key]; } else { pfExcluded[key] = true; }
              pfApplyFilter();
              // Hidden text is not searchable, so the match set just changed.
              if (typeof refreshSearchAfterDomChange === 'function') refreshSearchAfterDomChange();
            });
          })(rawKey);
        }
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

  // The host's answer to a choose / clear request: apply the new file's rules
  // (null = no file), and bring an open panel's ticks and DITAVAL row up to date.
  window.addEventListener('message', function(event) {
    var msg = event.data;
    if (!msg || msg.type !== ${setMsgType}) return;
    pfDitaval = msg.ditaval || null;
    pfApplyFilter();
    if (pfPanel) {
      pfPanel.remove();
      pfPanel = pfBuildPanel();
      document.body.appendChild(pfPanel);
    }
    // Hidden text is not searchable, so the match set just changed.
    if (typeof refreshSearchAfterDomChange === 'function') refreshSearchAfterDomChange();
  });

  var pfFilterBtn = document.createElement('button');
  pfFilterBtn.textContent = ${btnLabel};
  pfFilterBtn.title = ${btnTitle};
  pfFilterBtn.setAttribute('aria-label', ${btnTitle});
  pfFilterBtn.style.cssText = btnStyle;
  pfFilterBtn.addEventListener('click', pfTogglePanel);
  // A .ditaval the host seeded applies from the first paint, not only once the
  // panel has been opened.
  pfApplyFilter();
  toolbar.appendChild(pfFilterBtn);
`;
}
