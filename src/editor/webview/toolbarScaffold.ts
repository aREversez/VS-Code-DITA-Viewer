// Shared toolbar scaffolding, font-preference state, font/width/tag-tooltip
// buttons, and the refresh button for both previews. Moved verbatim from
// ditaRenderUtils.ts (P5 pure refactor); self-contained leaf (no imports).

/**
 * The preview toolbar's refresh button, shared by both previews. This used
 * to be two byte-for-byte copies (one inline in each provider); it lives
 * here now so the shared-11px tripwire test in ditaRenderUtils.test.ts can
 * see it -- that test cannot import the providers (they need the `vscode`
 * module; mapToolbarOrder.test.ts has the same constraint and reads source
 * text instead). Built here, appended by the caller right after, same
 * build-always/caller-appends convention as getSitePrevNextButtonsScript.
 * `btnStyle` comes from getToolbarScaffoldScript below already being in
 * scope -- same closure requirement as every other button script here -- and
 * stays plain: the scaffold's shared 11px IS the compact toolbar, so the ↻
 * renders at the same size as every control around it.
 *
 * `title` is a raw string, quoted here internally -- same convention as
 * getToolbarScaffoldScript below, and required by it: sharedWebviewStrings()
 * hands reloadContent out as a value both providers pass into this function
 * call rather than interpolating directly, so it belongs in that function's
 * raw-string group, not the pre-JSON.stringify'd group (see the comment on
 * sharedWebviewStrings() itself for why the two groups aren't
 * interchangeable).
 */
export function getRefreshButtonScript(opts: { title: string }): string {
  const title = JSON.stringify(opts.title);
  return `
  // Refresh button
  var refreshBtn = document.createElement('button');
  refreshBtn.innerHTML = '&#x21bb;';
  refreshBtn.title = ${title};
  refreshBtn.setAttribute('aria-label', ${title});
  refreshBtn.style.cssText = btnStyle;
  refreshBtn.addEventListener('click', function() { vscode.postMessage({ type: 'refresh' }); });
`;
}

// ── Shared toolbar scaffolding (style constants + the toolbar container
// itself) ──
//
// DitaViewerProvider.ts and MapViewerProvider.ts built this same handful of
// lines independently: same style strings, same element, same hover
// behavior. Each provider still owns appendChild ordering for its own
// buttons -- this only emits the shared setup, declaring `tbStyle`,
// `ddStyle`, `btnStyle` and `toolbar` for the rest of each provider's own
// toolbar-building code (including getProfilingFilterScript above, which
// already assumes both) to use.
//
// `previewToolbar` is a raw string, quoted here internally -- same
// convention as getSearchOverlayScript/getProfilingFilterScript above, and
// required by it: sharedWebviewStrings() hands this out as a value both
// providers pass into a function call rather than interpolating directly,
// so it belongs in that function's raw-string group, not the
// pre-JSON.stringify'd group (see the comment on sharedWebviewStrings()
// itself for why the two groups aren't interchangeable).
export function getToolbarScaffoldScript(opts: { previewToolbar: string }): string {
  const previewToolbar = JSON.stringify(opts.previewToolbar);
  return `
  // Toolbar
  // Compact and uniform: every button and dropdown inherits the scaffold's
  // single 11px font-size (the base btnStyle/ddStyle value) instead of each
  // carrying its own override, and the bar's own gap/padding are a notch
  // tighter -- the map preview's toolbar holds over a dozen controls, so
  // per-button sizes (11/12/13/14px as it once was) made the row read as
  // several different toolbars stitched together.
  var tbStyle = 'position:fixed;top:4px;right:8px;z-index:9999;display:flex;align-items:center;gap:3px;padding:2px 5px;border-radius:5px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:11px;background:var(--vscode-editor-background,rgba(30,30,30,0.88));border:1px solid var(--vscode-widget-border,rgba(255,255,255,0.12));backdrop-filter:blur(4px);opacity:0.75;transition:opacity 0.15s;';
  var ddStyle = 'box-sizing:border-box;height:18px;appearance:none;-webkit-appearance:none;padding:1px 4px;border-radius:3px;border:1px solid var(--vscode-dropdown-border,var(--vscode-widget-border,#555));background:var(--vscode-dropdown-background,#333);color:var(--vscode-dropdown-foreground,#eee);font-size:11px;outline:none;cursor:pointer;';
  var btnStyle = 'box-sizing:border-box;height:18px;padding:1px 4px;border-radius:3px;border:1px solid var(--vscode-dropdown-border,var(--vscode-widget-border,#555));background:var(--vscode-dropdown-background,#333);color:var(--vscode-dropdown-foreground,#eee);cursor:pointer;font-size:11px;line-height:1;outline:none;display:flex;align-items:center;';

  var toolbar = document.createElement('div');
  toolbar.id = '__toolbar';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', ${previewToolbar});
  toolbar.style.cssText = tbStyle;
  toolbar.addEventListener('mouseenter', function() { toolbar.style.opacity = '1'; });
  toolbar.addEventListener('mouseleave', function() { toolbar.style.opacity = '0.75'; });
`;
}

// ── Shared font-preference state (read-back, apply, persist) ──
//
// Declares fontSize/isSerif/SERIF_STACK and the apply/save functions the
// font buttons (getToolbarFontWidthTagTooltipsButtonsScript below) close
// over. Kept as its own script rather than folded into that one: the topic
// viewer applies these prefs immediately on load, before the toolbar itself
// is built, while the map viewer builds them together with the toolbar --
// each provider calls this wherever its own script needs fontSize/isSerif
// to already exist, same effective timing (applied once, immediately) even
// though the textual position differs between the two files.
//
// `setFontPrefsMsgType` is the raw (unquoted) postMessage type string, e.g.
// 'setFontPrefs' -- both providers currently use the exact same value, one
// as a literal and one via a same-valued constant.
export function getFontPrefsScript(opts: { setFontPrefsMsgType: string }): string {
  return `
  var fontPrefs = window.__fontPrefs || { size: 100, serif: false };
  var fontSize = typeof fontPrefs.size === 'number' ? fontPrefs.size : 100;
  var isSerif = fontPrefs.serif === true;
  var SERIF_STACK = "Georgia,'Times New Roman','Noto Serif SC','Songti SC',STSong,SimSun,serif";

  function applyFontPrefs() {
    document.body.style.fontSize = fontSize + '%';
    document.body.style.fontFamily = isSerif ? SERIF_STACK : '';
  }
  applyFontPrefs();

  function saveFontPrefs() {
    vscode.postMessage({ type: '${opts.setFontPrefsMsgType}', size: fontSize, serif: isSerif });
  }
`;
}

// ── Shared font-size/typeface, page-width and tag-tooltip toolbar buttons ──
//
// Builds fsDown/fsUp/fontBtn(/fontResetBtn)/wSel/tagTooltipsBtn and their
// listeners -- everything both providers' toolbars have always agreed on
// byte-for-byte except for two deliberate, still-preserved differences:
// the topic viewer alone has a font-reset button, and the map viewer's
// font-size buttons carry an extra 'font-weight:bold;' the topic viewer's
// don't. Both are opts here rather than silently unified, so this
// extraction doesn't change what either toolbar looks like.
//
// Deliberately does NOT call toolbar.appendChild for any of these: the two
// providers interleave them with their own buttons (theme CSS dropdown,
// mode toggle, refresh, Flags, Filter) in different orders, and forcing one
// shared order would be a visible behavior change this extraction isn't
// meant to make. Each provider appends fsDown/fsUp/fontBtn/(fontResetBtn)/
// wSel/tagTooltipsBtn itself, in whatever order it already used.
//
// All *Label/*Title opts are raw strings, quoted internally -- same
// convention as getSearchOverlayScript/getProfilingFilterScript above (see
// the comment on getToolbarScaffoldScript for why: sharedWebviewStrings()
// hands these out as values passed into a function call, which belongs in
// that function's raw-string group).
export function getToolbarFontWidthTagTooltipsButtonsScript(opts: {
  decreaseFontSize: string;
  increaseFontSize: string;
  fontSans: string;
  fontSerif: string;
  fontCurrentSans: string;
  fontCurrentSerif: string;
  fontSizeButtonExtraStyle: string; // raw CSS text appended after btnStyle, e.g. '' or 'font-weight:bold;'
  includeFontReset: boolean;
  resetFont?: string; // required (raw string) when includeFontReset is true
  widthAuto: string;
  widthFull: string;
  widthWide: string;
  widthDesktop: string;
  widthNarrow: string;
  pageWidth: string;
  /** Toast shown when the chosen width can't visibly differ from Auto/Full
   *  at the current window size. Contains a literal `{0}` placeholder for
   *  the selected option's label, substituted in the webview at runtime. */
  widthTooNarrow: string;
  setWidthSelectionMsgType: string; // raw, e.g. 'setWidthSelection'
  tagTooltipsLabel: string;
  tagTooltipsOnTitle: string;
  tagTooltipsOffTitle: string;
  setTagTooltipsMsgType: string; // raw, e.g. 'setTagTooltips'
}): string {
  const decreaseFontSize = JSON.stringify(opts.decreaseFontSize);
  const increaseFontSize = JSON.stringify(opts.increaseFontSize);
  const fontSans = JSON.stringify(opts.fontSans);
  const fontSerif = JSON.stringify(opts.fontSerif);
  const fontCurrentSans = JSON.stringify(opts.fontCurrentSans);
  const fontCurrentSerif = JSON.stringify(opts.fontCurrentSerif);
  const widthAuto = JSON.stringify(opts.widthAuto);
  const widthFull = JSON.stringify(opts.widthFull);
  const widthWide = JSON.stringify(opts.widthWide);
  const widthDesktop = JSON.stringify(opts.widthDesktop);
  const widthNarrow = JSON.stringify(opts.widthNarrow);
  const pageWidth = JSON.stringify(opts.pageWidth);
  const widthTooNarrow = JSON.stringify(opts.widthTooNarrow);
  const tagTooltipsLabel = JSON.stringify(opts.tagTooltipsLabel);
  const tagTooltipsOnTitle = JSON.stringify(opts.tagTooltipsOnTitle);
  const tagTooltipsOffTitle = JSON.stringify(opts.tagTooltipsOffTitle);
  const fsExtra = opts.fontSizeButtonExtraStyle;
  const fontResetBlock = opts.includeFontReset ? `
  // Reset font size + family to default in one click
  var fontResetBtn = document.createElement('button');
  fontResetBtn.innerHTML = '&#8635;';
  fontResetBtn.title = ${JSON.stringify(opts.resetFont)};
  fontResetBtn.setAttribute('aria-label', ${JSON.stringify(opts.resetFont)});
  fontResetBtn.style.cssText = btnStyle;
  fontResetBtn.addEventListener('click', function() {
    fontSize = 100;
    isSerif = false;
    applyFontPrefs();
    fontBtn.textContent = ${fontSans};
    fontBtn.title = ${fontCurrentSans};
    fontBtn.setAttribute('aria-label', ${fontCurrentSans});
    saveFontPrefs();
  });
` : '';
  return `
  // Font size controls
  var fsDown = document.createElement('button');
  fsDown.innerHTML = 'A\u2212';
  fsDown.title = ${decreaseFontSize};
  fsDown.setAttribute('aria-label', ${decreaseFontSize});
  fsDown.style.cssText = btnStyle + '${fsExtra}';
  fsDown.addEventListener('click', function() {
    fontSize = Math.max(60, fontSize - 10);
    document.body.style.fontSize = fontSize + '%';
    saveFontPrefs();
  });

  var fsUp = document.createElement('button');
  fsUp.innerHTML = 'A+';
  fsUp.title = ${increaseFontSize};
  fsUp.setAttribute('aria-label', ${increaseFontSize});
  fsUp.style.cssText = btnStyle + '${fsExtra}';
  fsUp.addEventListener('click', function() {
    fontSize = Math.min(200, fontSize + 10);
    document.body.style.fontSize = fontSize + '%';
    saveFontPrefs();
  });

  // Font toggle (serif / sans-serif) -- reflects the persisted state on open
  var fontBtn = document.createElement('button');
  fontBtn.textContent = isSerif ? ${fontSerif} : ${fontSans};
  fontBtn.title = isSerif ? ${fontCurrentSerif} : ${fontCurrentSans};
  fontBtn.setAttribute('aria-label', isSerif ? ${fontCurrentSerif} : ${fontCurrentSans});
  fontBtn.style.cssText = btnStyle;
  fontBtn.addEventListener('click', function() {
    isSerif = !isSerif;
    fontBtn.textContent = isSerif ? ${fontSerif} : ${fontSans};
    fontBtn.title = isSerif ? ${fontCurrentSerif} : ${fontCurrentSans};
    fontBtn.setAttribute('aria-label', isSerif ? ${fontCurrentSerif} : ${fontCurrentSans});
    document.body.style.fontFamily = isSerif ? SERIF_STACK : '';
    saveFontPrefs();
  });
${fontResetBlock}
  // Page width dropdown
  var widths = [
    { label: ${widthAuto}, value: '' },
    { label: ${widthFull}, value: '100%' },
    { label: ${widthWide}, value: '1400px' },
    { label: ${widthDesktop}, value: '1280px' },
    { label: ${widthNarrow}, value: '720px' },
  ];
  var wSel = document.createElement('select');
  wSel.title = ${pageWidth};
  wSel.setAttribute('aria-label', ${pageWidth});
  // text-align-last is what centers a <select>'s displayed value (text-align
  // alone leaves "Auto" flush left).
  wSel.style.cssText = 'max-width:72px;text-align:center;text-align-last:center;' + ddStyle;
  var restoredWidth = window.__widthSelection || '';
  for (var i = 0; i < widths.length; i++) {
    var opt = document.createElement('option');
    opt.value = widths[i].value;
    opt.textContent = widths[i].label;
    if (widths[i].value === restoredWidth) opt.selected = true;
    wSel.appendChild(opt);
  }
  function applyWidth(value) {
    // Only ever touch the --max-width custom property, never body's own
    // inline style directly. Every layout already routes that property to
    // the box that actually determines the reading column's width: body's
    // own rule reads max-width:var(--max-width) in plain topic view and
    // tree/book mode; #dita-content-root's children read it in the
    // top-bar layout (outline view, book without nav); .site-main reads it
    // in docsite/site-shell mode. Those same layouts also reset body's
    // *own* box on purpose -- max-width:none, margin:0, a fixed viewport
    // height -- so the top bar and the shell frame span the full window
    // instead of shrinking with the reading column. Setting
    // document.body.style.maxWidth/margin directly (as this used to)
    // overrode that reset, since an inline style always wins over the
    // class-based rule: every width change shrank and re-centered body
    // itself, visibly shifting the top bar and site shell sideways along
    // with the content on every selection. Routing through the custom
    // property alone reaches the right box in each layout without ever
    // touching the one box that must stay full width.
    if (value) {
      document.body.style.setProperty('--max-width', value);
    } else {
      document.body.style.removeProperty('--max-width');
    }
  }
  if (restoredWidth) applyWidth(restoredWidth);
  wSel.addEventListener('change', function() {
    applyWidth(wSel.value);
    vscode.postMessage({ type: '${opts.setWidthSelectionMsgType}', value: wSel.value });
    // The selection only has a visible effect when the chosen column width
    // is actually narrower than what's already on screen -- past that
    // point every option renders identically to Auto/Full, which reads as
    // "nothing happened" rather than as a no-op by design. Flag it instead
    // of leaving the user to guess why toggling Wide vs Desktop vs Narrow
    // looks the same at a cramped window size.
    var px = parseInt(wSel.value, 10);
    if (px && document.documentElement.clientWidth <= px) {
      var selectedLabel = wSel.options[wSel.selectedIndex].textContent;
      var narrowMsg = ${widthTooNarrow}.replace('{0}', selectedLabel);
      // Shown near the width dropdown itself (top of the page, not the
      // image-copy toast's default bottom placement) since that's where
      // the user's focus already is after clicking it -- a bottom toast
      // is easy to miss entirely, or costs a big eye/scroll jump down to
      // notice at all. Duration scales with message length: this sentence
      // is long enough that the default 1200ms (tuned for a short "Copied"
      // pill) disappears before it can be read.
      showCenteredToast(narrowMsg, { top: true, duration: Math.min(8000, Math.max(3500, narrowMsg.length * 60)) });
    }
  });

  // Tag-name tooltip toggle
  var tagTooltipsOn = window.__tagTooltips === true;
  var tagTooltipsBtn = document.createElement('button');
  tagTooltipsBtn.textContent = ${tagTooltipsLabel};
  tagTooltipsBtn.style.cssText = btnStyle;
  function applyTagTooltips() {
    var contentRoot = document.getElementById('dita-content-root');
    var els = contentRoot ? contentRoot.querySelectorAll('[data-dita-tagname]') : [];
    for (var i = 0; i < els.length; i++) {
      if (tagTooltipsOn) els[i].setAttribute('title', els[i].getAttribute('data-dita-tagname'));
      else els[i].removeAttribute('title');
    }
    tagTooltipsBtn.style.background = tagTooltipsOn ? 'var(--color-profiling-label-bg)' : '';
    tagTooltipsBtn.style.color = tagTooltipsOn ? 'var(--color-profiling-label-text)' : '';
    tagTooltipsBtn.title = tagTooltipsOn ? ${tagTooltipsOnTitle} : ${tagTooltipsOffTitle};
    tagTooltipsBtn.setAttribute('aria-label', tagTooltipsOn ? ${tagTooltipsOnTitle} : ${tagTooltipsOffTitle});
  }
  tagTooltipsBtn.addEventListener('click', function() {
    tagTooltipsOn = !tagTooltipsOn;
    applyTagTooltips();
    vscode.postMessage({ type: '${opts.setTagTooltipsMsgType}', value: tagTooltipsOn });
  });
  applyTagTooltips(); // reflects a persisted "on" against the initial content; a no-op walk when off, but only once per panel open
`;
}
