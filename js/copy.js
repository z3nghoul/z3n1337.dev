// rows with data-copy (e-mail, Discord): a click copies the text and shows a small toast
const rows = [...document.querySelectorAll('.link-item[data-copy]')];

let toast, hideTimer;

function show(row, text) {
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.append(toast);
  }
  toast.textContent = text;
  // put the toast right under the text of the row. Both elements can be inside css zoom
  const r = row.getBoundingClientRect();
  const zr = row.currentCSSZoom || 1;
  const zt = toast.currentCSSZoom || 1;
  toast.style.setProperty('--x', `${Math.round((r.left + (row.querySelector('.link-info')?.offsetLeft ?? 0) * zr) / zt)}px`);
  toast.style.setProperty('--y', `${Math.round((r.bottom + 8 * zr) / zt)}px`);
  const c = getComputedStyle(row).getPropertyValue('--c').trim();
  if (c) toast.style.setProperty('--tc', c.replaceAll(',', ' '));
  toast.classList.remove('show');
  void toast.offsetWidth;  // reading offsetWidth forces a reflow, so the animation can restart
  toast.classList.add('show');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => toast.classList.remove('show'), 1800);
}

async function copy(row) {
  try {
    await navigator.clipboard.writeText(row.dataset.copy);
    show(row, 'copied :3');
  // no clipboard access (http, old browser): open the mail client instead
  } catch {
    if (row.dataset.mailto) location.href = row.dataset.mailto;
  }
}

for (const row of rows) {
  row.addEventListener('click', e => {
    // a modified click goes to the mail client, a plain click copies
    if (row.dataset.mailto && (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey)) {
      location.href = row.dataset.mailto;
      return;
    }
    copy(row);
  });
  row.addEventListener('auxclick', e => {
    if (e.button === 1 && row.dataset.mailto) location.href = row.dataset.mailto;
  });
  row.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); copy(row); }
  });
}
