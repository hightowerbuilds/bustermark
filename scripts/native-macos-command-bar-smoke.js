// Inject only into a disposable build whose identifier contains ".parity-smoke".
// Native acceptance for the command bar (growth/phases/phase-4.md): the toolbar
// button and Ctrl+` open it over the note, `/` completes and runs commands inline
// without opening the Language Model, Escape returns focus to the note, and a plain
// line goes to the sidebar's current chat. One small Claude Haiku request.
// At each `stage` the report is written and the harness waits for
// `ack-<stage>.txt` in the Notes folder, so a screenshot can be taken from outside.
void (async () => {
  const checks = [];
  const metrics = {};
  const pageErrors = [];
  addEventListener('error', e => pageErrors.push(`${e.message} @ ${e.filename}:${e.lineno}`.slice(0, 600)));
  addEventListener('unhandledrejection', e => pageErrors.push(`rejection: ${e.reason?.stack ?? e.reason}`.slice(0, 600)));
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async (fn, label, seconds = 10) => {
    for (let i = 0; i < seconds * 10; i++) { const value = await fn(); if (value) return value; await delay(100); }
    throw Error(`Timed out: ${label}`);
  };
  const assert = (ok, label) => { if (!ok) throw Error(label); checks.push(label); };
  const ipc = (cmd, args = {}) => window.__TAURI_INTERNALS__.invoke(cmd, args);
  const notes = await ipc('initialize_notes_workspace');
  if (!notes.root.includes('/com.lukehightower.buster.parity-smoke')) throw Error('Requires isolated test storage');
  const reportPath = `${notes.root}/native-macos-command-bar-smoke-result.json`;
  async function report(result) {
    try { await ipc('create_file', { path: reportPath }); } catch { /* Existing report. */ }
    await ipc('write_file', { path: reportPath, content: JSON.stringify(result, null, 2) });
  }
  async function hold(stage) {
    metrics.stages = [...(metrics.stages ?? []), stage];
    await report({ ok: null, stage, checks, metrics });
    const ack = `${notes.root}/ack-${stage}.txt`;
    await wait(async () => { try { await ipc('read_file', { path: ack }); return true; } catch { return false; } }, `screenshot of ${stage}`, 120);
  }
  const key = (target, name, code, modifiers = {}) => {
    for (const type of ['keydown', 'keyup']) target.dispatchEvent(new KeyboardEvent(type, { key: name, code, ...modifiers, bubbles: true, cancelable: true }));
  };
  const editor = () => document.querySelector('.tab-content.is-active .block-prose');
  const footer = text => [...document.querySelectorAll('.footer-nav button')].find(button => button.textContent === text).click();
  const bar = () => document.querySelector('[role="dialog"][aria-label="Command bar"]');
  const barInput = () => bar()?.querySelector('input');
  const barText = () => bar()?.querySelector('.command-bar-result-title')?.textContent ?? '';
  const sidebar = () => document.querySelector('.assistant-sidebar');
  const tabCount = () => document.querySelectorAll('.tab-content').length;
  function type(text) {
    const input = barInput();
    input.value = text;
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }
  async function run(text) {
    type(text);
    bar().querySelector('form').requestSubmit();
    await wait(() => bar()?.querySelector('button[type=submit]')?.textContent !== 'Working…', `bar finished ${text}`);
    await delay(150);
  }
  const openWithButton = async () => {
    [...document.querySelectorAll('.editor-toolbar button')].find(b => b.getAttribute('aria-label') === 'Command bar').click();
    return wait(() => barInput() && document.activeElement === barInput(), 'bar open and focused');
  };

  try {
    await wait(() => document.querySelector('.footer-nav'), 'workspace initialization');
    footer('New Note');
    const note = await wait(editor, 'new note');
    note.focus();
    document.execCommand('insertText', false, 'the tide tables turned at dusk');
    await delay(600);
    const noteTab = document.querySelector('.tab-content.is-active [data-tab-panel-id]')?.dataset.tabPanelId;
    assert(!!noteTab, 'A note to work on is open');

    // Pick a small model before any request; the sidebar's choices belong to the chat.
    for (let attempt = 0; attempt < 5 && !sidebar(); attempt++) {
      document.querySelector('.assistant-bumper').click();
      for (let i = 0; i < 20 && !sidebar(); i++) await delay(100);
    }
    await wait(() => sidebar(), 'Language Model sidebar');
    const pick = (label, value) => {
      const select = document.querySelector(`.assistant-sidebar select[aria-label="${label}"]`);
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    };
    pick('Model', 'claude-haiku-5-5');
    pick('Effort', 'low');
    await wait(() => document.querySelector('.as-status-good'), 'Claude Code connected', 30);
    document.querySelector('.assistant-bumper').click();
    await wait(() => !sidebar(), 'sidebar closed');
    note.focus();

    await openWithButton();
    assert(true, 'The toolbar button opens the bar with the input focused');
    assert(/runs a command .* anything else goes to Claude Code/.test(bar().textContent), 'The hint says where each kind of line goes');

    type('/notes s');
    await wait(() => bar().querySelector('[role=option]'), 'suggestions');
    const options = [...bar().querySelectorAll('.command-bar-usage')].map(o => o.textContent);
    assert(options.includes('/notes search <query>'), `Typing /notes s suggests /notes search (${options.join(', ')})`);
    await hold('suggestions');
    key(barInput(), 'Tab', 'Tab');
    assert(barInput().value === '/notes search ', `Tab completes the name (${barInput().value})`);

    await run('/notes search tide');
    assert(/^1 note contains "tide"\./.test(barText()), `/notes search reports matches inline (${barText()})`);
    assert(!sidebar(), 'A command does not open the Language Model');
    await hold('result');

    await run('/frobnicate');
    assert(barText().startsWith('There is no /frobnicate command.'), 'An unknown command explains itself');
    assert(!sidebar() && bar(), 'An unknown command opens nothing and leaves the bar open');

    key(barInput(), 'Escape', 'Escape');
    await wait(() => !bar(), 'bar closed by Escape');
    await wait(() => note.contains(document.activeElement) || document.activeElement === note, 'focus back in the note');
    assert(true, 'Escape closes the bar and returns focus to the note');

    // Real keystrokes start at the focused element and bubble to the workspace's hotkey listener.
    key(document.activeElement, '`', 'Backquote', { ctrlKey: true });
    await wait(() => barInput() && document.activeElement === barInput(), 'bar opened with Ctrl+`');
    await run('/document read');
    const raw = bar().querySelector('.command-line-result').textContent;
    assert(raw.includes(`"tabId": "${noteTab}"`) && raw.includes('the tide tables turned'), '/document read targets the note the bar was opened over');

    const before = tabCount();
    await run('/document create');
    await wait(() => !bar() && tabCount() === before + 1, 'new note from the bar');
    assert(!sidebar(), '/document create opens a note, closes the bar, and leaves the sidebar closed');

    await openWithButton();
    await run('Reply with exactly one word: ready. Do not use any tools.');
    await wait(() => sidebar() && !bar(), 'request handed to the sidebar');
    const userEntries = () => [...document.querySelectorAll('.assistant-sidebar .as-user')].map(e => e.textContent);
    await wait(() => userEntries().some(text => text.includes('Reply with exactly one word: ready.')), 'request in the chat');
    const reply = await wait(() => [...document.querySelectorAll('.as-reply .as-text')].map(p => p.textContent).find(t => /ready/i.test(t)), 'reply streamed', 120);
    assert(true, `A plain line is sent to the sidebar's chat and answered (${reply.trim().slice(0, 40)})`);

    await report({ ok: true, checks, metrics, pageErrors });
    key(window, 'q', 'KeyQ', { metaKey: true });
  } catch (error) {
    await report({ ok: false, checks, metrics, error: String(error), pageErrors,
      dom: { bar: !!bar(), barText: barText(), value: barInput()?.value, sidebar: !!sidebar(), active: document.activeElement?.className } });
  }
})();
