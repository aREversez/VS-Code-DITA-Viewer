
// Webview script: the Flags (profiling highlight) toolbar toggle, shared by the
// topic preview and the map preview. It used to be written out line for line
// in both providers; a fix to one had to be remembered in the other.
//
// A dependency-free leaf -- every host value it embeds comes from opts, as raw
// strings that are quoted here (the same shape getProfilingFilterScript takes;
// see the two value groups in webviewL10n.ts). The script expects `toolbar`
// and `btnStyle` to be in scope where it is inlined.

export function getProfilingToggleScript(opts: {
  label: string;
  onTitle: string;
  offTitle: string;
}): string {
  const label = JSON.stringify(opts.label);
  const onTitle = JSON.stringify(opts.onTitle);
  const offTitle = JSON.stringify(opts.offTitle);
  return `
  // Profiling / conditional-attribute highlight toggle. Purely a CSS class
  // flip (body.hide-profiling, see styles.css) -- the highlight markup is
  // always present in the rendered HTML, so toggling is instant and needs
  // no message round-trip to the extension or re-render. Defaults on: the
  // point of this feature is surfacing profiled content, so it should be
  // visible without the user having to discover the toggle first.
  var profilingOn = true;
  var profilingBtn = document.createElement('button');
  profilingBtn.textContent = ${label};
  profilingBtn.style.cssText = btnStyle;
  function applyProfilingToggle() {
    document.body.classList.toggle('hide-profiling', !profilingOn);
    profilingBtn.style.background = profilingOn ? 'var(--color-profiling-label-bg)' : '';
    profilingBtn.style.color = profilingOn ? 'var(--color-profiling-label-text)' : '';
    profilingBtn.title = profilingOn ? ${onTitle} : ${offTitle};
    profilingBtn.setAttribute('aria-label', profilingOn ? ${onTitle} : ${offTitle});
  }
  profilingBtn.addEventListener('click', function() {
    profilingOn = !profilingOn;
    applyProfilingToggle();
  });
  applyProfilingToggle();
  toolbar.appendChild(profilingBtn);
`;
}
