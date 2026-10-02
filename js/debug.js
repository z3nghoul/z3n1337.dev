// dev panel, only shown with ?debug in the url
export const DEBUG = new URLSearchParams(location.search).has('debug');

let list = null;

function panel() {
  if (list) return list;
  const box = document.createElement('div');
  box.id = 'debug-panel';
  box.style.cssText = [
    'position:fixed', 'left:8px', 'bottom:40px', 'z-index:99',
    'min-width:160px', 'padding:8px 10px', 'border-radius:8px',
    'background:rgb(17 17 27 / .88)', 'color:#cdd6f4',
    'font:12px "JetBrains Mono", monospace', 'user-select:none',
  ].join(';');
  const title = document.createElement('div');
  title.textContent = 'debug';
  title.style.cssText = 'color:#cba6f7;margin-bottom:6px';
  list = document.createElement('div');
  const empty = document.createElement('div');
  empty.textContent = '(no toggles yet)';
  empty.style.opacity = '.5';
  empty.dataset.empty = '';
  list.append(empty);
  box.append(title, list);
  document.body.append(box);
  return list;
}

// a read-only line in the panel. Returns a function that updates its text
export function debugLine(label) {
  if (!DEBUG) return () => {};
  const l = panel();
  l.querySelector(':scope > [data-empty]')?.remove();
  const row = document.createElement('div');
  row.style.cssText = 'margin:4px 0 2px;padding-top:4px;border-top:1px solid #45475a;color:#a6adc8;white-space:pre-wrap;max-width:230px';
  row.textContent = label;
  l.append(row);
  return text => { row.textContent = `${label}
${text}`; };
}

// toggles that share a group behave like radio buttons
const groups = new Map();

// a checkbox in the panel. Without ?debug it only returns the initial state
export function debugToggle(key, label, initial = false, onChange, group) {
  const state = { on: initial };
  if (!DEBUG) return state;
  const l = panel();
  l.querySelector(':scope > [data-empty]')?.remove();
  const row = document.createElement('label');
  row.style.cssText = 'display:flex;gap:6px;align-items:center;cursor:pointer;margin:2px 0';
  const cb = Object.assign(document.createElement('input'), { type: 'checkbox', checked: initial });
  cb.dataset.key = key;
  const set = on => { cb.checked = on; state.on = on; onChange?.(on); };
  state.set = set;
  cb.addEventListener('change', () => {
    if (cb.checked && group) {
      for (const other of groups.get(group)) if (other.set !== set && other.cb.checked) other.set(false);
    }
    set(cb.checked);
  });
  if (group) {
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push({ cb, set });
  }
  row.append(cb, document.createTextNode(label));
  l.append(row);
  return state;
}

if (DEBUG) panel();
