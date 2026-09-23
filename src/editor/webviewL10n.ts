import * as vscode from 'vscode';

// The strings both webview toolbars need, in one table.
//
// getWebviewScript() and getMapWebviewScript() each carried their own copy,
// and the two copies agreed byte-for-byte on all 28 entries: the toolbar
// label, the font and page-width controls, the Flags toggle, and the option
// sets for the search and profiling-filter overlays. Two tables that are
// meant to say the same thing drift. A control added to one toolbar and not
// the other, or a rewording applied to one copy, leaves the single-topic
// preview and the map's book mode disagreeing about the same button in the
// same release -- and nothing in the build notices, because each table is
// perfectly self-consistent on its own. Both providers spread this and then
// add only what is genuinely theirs.
//
// The two value shapes below are not interchangeable, and the grouping is
// load-bearing rather than cosmetic:
//   - JSON.stringify(...) for strings interpolated straight into the script
//     template, where quotes and escaping have to arrive as a JS literal;
//   - bare vscode.l10n.t(...) for values handed to a helper function that
//     quotes them itself: getSearchOverlayScript(), getProfilingFilterScript(),
//     getToolbarScaffoldScript(), getToolbarFontWidthTagTooltipsButtonsScript()
//     and getRefreshButtonScript().
// Moving an entry between the groups double-quotes one and leaves the other
// unquoted, and both failures show up as mangled text in the toolbar rather
// than as an error.
//
// Every call is spelled out in full, including the repetitive ones.
// scripts/check-l10n.cjs finds catalog entries by scanning source text for a
// literal vscode.l10n.t( call with a quoted argument, so a helper taking the
// string as a parameter would remove all 28 from the catalog check at once --
// the check would still pass, having silently stopped covering this file.
//
// A provider that re-declares one of these keys after the spread overrides it
// without a word of complaint. Keep the local additions to strings that exist
// in one toolbar only.
export function sharedWebviewStrings() {
  return {
    // ── toolbar, passed to getToolbarScaffoldScript/
    // getToolbarFontWidthTagTooltipsButtonsScript/getRefreshButtonScript as
    // values, quoted by those functions themselves (same convention as the
    // overlay options below) ──
    previewToolbar: vscode.l10n.t('Preview toolbar'),
    decreaseFontSize: vscode.l10n.t('Decrease font size'),
    increaseFontSize: vscode.l10n.t('Increase font size'),
    fontSans: vscode.l10n.t('Sans'),
    fontSerif: vscode.l10n.t('Serif'),
    fontCurrentSans: vscode.l10n.t('Current: Sans-serif. Click to switch to Serif'),
    fontCurrentSerif: vscode.l10n.t('Current: Serif. Click to switch to Sans-serif'),
    tagTooltipsLabel: vscode.l10n.t('Tags'),
    tagTooltipsOnTitle: vscode.l10n.t('Element tag names are shown as hover tooltips. Click to hide them.'),
    tagTooltipsOffTitle: vscode.l10n.t('Element tag names are hidden. Click to show each element\'s tag name on hover.'),
    pageWidth: vscode.l10n.t('Page width'),
    widthAuto: vscode.l10n.t('Auto'),
    widthFull: vscode.l10n.t('Full'),
    widthWide: vscode.l10n.t('Wide'),
    widthDesktop: vscode.l10n.t('Desktop'),
    widthNarrow: vscode.l10n.t('Narrow'),
    reloadContent: vscode.l10n.t('Reload DITA content'),
    // ── toolbar, still interpolated straight into each provider's own
    // inline script (profiling toggle) ──
    profilingLabel: JSON.stringify(vscode.l10n.t('Flags')),
    profilingOnTitle: JSON.stringify(vscode.l10n.t('Profiling attributes (props/otherprops/audience/...) are highlighted. Click to hide the highlighting.')),
    profilingOffTitle: JSON.stringify(vscode.l10n.t('Profiling attribute highlighting is hidden. Click to show which content is flagged and with what.')),
    // ── search overlay, passed to getSearchOverlayScript as values ──
    searchPlaceholder: vscode.l10n.t('Search'),
    searchNext: vscode.l10n.t('Next match'),
    searchPrev: vscode.l10n.t('Previous match'),
    searchClose: vscode.l10n.t('Close search'),
    searchMatchCase: vscode.l10n.t('Match case'),
    searchUseRegex: vscode.l10n.t('Use regex'),
    searchInvalidRegex: vscode.l10n.t('Invalid regex'),
    // ── profiling filter overlay, passed to getProfilingFilterScript as values ──
    filterLabel: vscode.l10n.t('Filter'),
    filterTitle: vscode.l10n.t('Show/hide content by profiling attribute value (actually hides matching content, unlike the Flags toggle which only shows/hides the highlight)'),
    filterClose: vscode.l10n.t('Close'),
    filterEmpty: vscode.l10n.t('No profiling attributes in this document'),
    // ── image lightbox + copy menu, passed to getImageLightboxScript as
    // values ──
    // Both previews keep styles.css's cursor:zoom-in promise on every
    // rendered image, so the click-to-enlarge lightbox and its copy
    // affordances are a both-providers surface too -- the strings live here
    // rather than in each provider's local additions, or the two previews
    // would drift apart on the same right-click menu they both show.
    imgCopyMenuItem: vscode.l10n.t('Copy Image'),
    imgCopyDoneLabel: vscode.l10n.t('Copied!'),
    imgCopyFailedLabel: vscode.l10n.t('Copy failed'),
    imgCopyUnsupportedLabel: vscode.l10n.t('Copying images is not supported here'),
    imgCopyToastDone: vscode.l10n.t('Image copied to clipboard'),
    imgCopyToastFailed: vscode.l10n.t('Copy failed'),
  };
}
