// Inject only into a disposable build whose identifier contains ".parity-smoke".
// Sends exactly ONE real print job: Printer-check.md, one Letter page, to the
// system default printer, through the app's own print dialog. Whether the job
// reached the printer is read from CUPS outside the app; the paper is checked by hand.
void (async () => {
  const checks = [], jobs = [];
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async (fn, label, seconds = 30) => {
    for (let i = 0; i < seconds * 20; i++) { const value = await fn(); if (value) return value; await delay(50); }
    throw Error(`Timed out: ${label}`);
  };
  const assert = (ok, label) => { if (!ok) throw Error(label); checks.push(label); };
  const original = window.__TAURI_INTERNALS__.invoke;
  const ipc = (command, args = {}) => original(command, args);
  const notes = await ipc('initialize_notes_workspace');
  if (!notes.root.includes('/com.lukehightower.buster.parity-smoke')) throw Error('Requires isolated test storage');
  // The disposable JS bundle routes invoke through this hook; production assets never contain it.
  window.__PRINT_SMOKE_INVOKE__ = (command, args, options) => {
    if (command === 'print_document') {
      if (jobs.length) return Promise.reject('The printer check sends only one job');
      jobs.push(args.request);
    }
    return original(command, args, options);
  };
  const reportPath = `${notes.root}/native-macos-printer-smoke-result.json`;
  async function report(result) {
    try { await ipc('create_file', { path: reportPath }); } catch { /* Existing report. */ }
    await ipc('write_file', { path: reportPath, content: JSON.stringify(result, null, 2) });
  }
  const dialog = () => document.querySelector('.print-dialog');
  const control = label => dialog()?.querySelector(`[aria-label="${label}"]`);
  const editor = () => document.querySelector('.tab-content.is-active .block-prose');
  const activeTabName = () => document.getElementById(`tab-${document.querySelector('.tab-content.is-active [data-tab-panel-id]')?.dataset.tabPanelId}`)?.textContent ?? '';
  const bar = () => document.querySelector('[role="dialog"][aria-label="Command bar"]');
  const key = (target, name, code, modifiers = {}) => {
    for (const type of ['keydown', 'keyup']) target.dispatchEvent(new KeyboardEvent(type, { key: name, code, ...modifiers, bubbles: true, cancelable: true }));
  };
  let destination = '';
  try {
    await wait(() => document.querySelector('.footer-nav'), 'workspace initialization');
    assert(navigator.platform.startsWith('Mac'), 'Running in native macOS WebKit');
    [...document.querySelectorAll('.footer-nav button')].find(b => b.textContent === 'New Note').click();
    await wait(editor, 'scratch note');
    [...document.querySelectorAll('.editor-toolbar button')].find(b => b.getAttribute('aria-label') === 'Command bar').click();
    const field = await wait(() => bar()?.querySelector('input'), 'command bar');
    field.value = '/note open Printer-check.md';
    field.dispatchEvent(new InputEvent('input', { bubbles: true }));
    bar().querySelector('form').requestSubmit();
    await wait(() => !bar() && activeTabName() === 'Printer-check.md' && editor()?.textContent.includes('PRINT END MARKER'), 'Printer-check.md open');
    assert(true, 'Printer-check.md is open');

    key(document.querySelector('.ide-container'), 'p', 'KeyP', { metaKey: true });
    await wait(() => dialog() && !dialog().querySelector('fieldset').disabled && !dialog().textContent.includes('Finding printers'), 'print options ready');
    const choices = [...control('Print destination').options].map(o => ({ value: o.value, text: o.textContent }));
    const preferred = choices.find(o => o.value.startsWith('printer:') && o.text.endsWith('(default)') && !/fax/i.test(o.text));
    assert(!!preferred, `The default printer is listed (${choices.map(o => o.text).join(', ')})`);
    destination = preferred.text;
    control('Print destination').value = preferred.value;
    control('Print destination').dispatchEvent(new Event('change', { bubbles: true }));
    await wait(() => control('Print sides'), 'printer options');
    assert(control('Copies').value === '1' && control('Pages').value === 'all' && control('Paper size').value === 'letter'
      && control('Orientation').value === 'portrait' && control('Print sides').value === 'one-sided', 'One copy, all pages, Letter portrait, one-sided');
    const submit = dialog().querySelector('button[type="submit"]');
    assert(submit.textContent === 'Print', 'The confirm button says Print');
    submit.click();
    await wait(() => !dialog() || dialog().querySelector('[role="alert"]'), 'job handed to macOS', 60);
    assert(!dialog(), `macOS accepted the job (${dialog()?.querySelector('[role="alert"]')?.textContent ?? ''})`);
    const job = jobs[0];
    assert(jobs.length === 1 && job.options.destination === 'printer', 'Exactly one printer job was sent');
    assert(job.html.includes('PRINT END MARKER') && job.html.includes('déjà vu'), 'The job holds the whole note');
    assert(!/New Note|Command bar|Print current document/.test(job.html), 'The job holds no app controls');
    await report({ ok: true, checks, destination, job: { title: job.title, options: job.options, htmlLength: job.html.length } });
    key(window, 'q', 'KeyQ', { metaKey: true });
  } catch (error) {
    await report({ ok: false, checks, destination, error: String(error), stack: error.stack, jobs: jobs.map(job => job.options), dialog: dialog()?.outerHTML?.slice(0, 2000) });
  }
})();
