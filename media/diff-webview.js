(function() {
  const vscode = acquireVsCodeApi();
  const body = document.body;
  const btnPrev = document.getElementById('btn-prev');
  const btnNext = document.getElementById('btn-next');
  const btnSwap = document.getElementById('btn-swap');
  const btnInline = document.getElementById('btn-inline');
  const counter = document.getElementById('nav-counter');

  function getChangeRows() {
    return Array.from(document.querySelectorAll('.diff-row:not(.diff-row--unchanged):not(.diff-row--section)'));
  }

  let currentIdx = -1;

  function updateCounter() {
    const rows = getChangeRows();
    if (rows.length === 0) {
      counter.textContent = '0 / 0';
      return;
    }
    counter.textContent = (currentIdx + 1) + ' / ' + rows.length;
  }

  function navigateTo(idx) {
    const rows = getChangeRows();
    if (rows.length === 0) return;
    rows.forEach(function(r) { r.classList.remove('__diff_current'); });
    currentIdx = ((idx % rows.length) + rows.length) % rows.length;
    rows[currentIdx].classList.add('__diff_current');
    rows[currentIdx].scrollIntoView({ block: 'center', behavior: 'smooth' });
    updateCounter();
  }

  btnPrev.addEventListener('click', function() { navigateTo(currentIdx - 1); });
  btnNext.addEventListener('click', function() { navigateTo(currentIdx === -1 ? 0 : currentIdx + 1); });

  btnSwap.addEventListener('click', function() {
    vscode.postMessage({ type: 'swapSides' });
  });

  btnInline.addEventListener('click', function() {
    body.classList.toggle('show-inline');
    btnInline.setAttribute('aria-pressed', body.classList.contains('show-inline'));
  });

  document.addEventListener('keydown', function(e) {
    if (e.key === 'F7' && !e.shiftKey) {
      e.preventDefault();
      navigateTo(currentIdx === -1 ? 0 : currentIdx + 1);
    } else if (e.key === 'F7' && e.shiftKey) {
      e.preventDefault();
      navigateTo(currentIdx - 1);
    }
  });

  updateCounter();
})();
