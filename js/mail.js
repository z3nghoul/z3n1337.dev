// builds the e-mail row at load time, so the address is not written in the html
// and scrapers that only read the page source do not find it
import { MAIL } from './config.js';

const row = document.getElementById('mail-row');
if (row) {
  const address = MAIL.join('@');
  row.dataset.copy = address;
  row.dataset.mailto = `mailto:${address}`;
  row.querySelector('.link-handle').textContent = address;
}
