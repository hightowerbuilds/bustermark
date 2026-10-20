// Inject only into a disposable build whose identifier contains ".parity-smoke".
// Phase 3 acceptance (growth/phases/phase-3.md section 5). Launch with BUSTERMARK_CLI_DIR set to
// the prepared `current` link, which starts at the real Claude Code.
// Part A, on Claude Haiku: a layout change through the Assistant (plain-language approval card,
// Allow, Undo in the chat), a preset reset from Settings › Note layout, and the command bar's
// `/note open` and `/selection ai`.
// Part B, no model requests: at each `cli-<variant>` stage the report is written and the harness
// waits for `ack-cli-<variant>.txt`, after the driver repoints `current` at that variant of
// scripts/fake-cli/: not installed, signed out, a crash mid-turn, an expired sign-in mid-turn,
// and back to the real CLI, where Check again recovers.
void (async () => {
  const checks = [];
  const metrics = { approvals: [] };
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
  const reportPath = `${notes.root}/native-macos-phase3-smoke-result.json`;
  async function report(result) {
    try { await ipc('create_file', { path: reportPath }); } catch { /* Existing report. */ }
    await ipc('write_file', { path: reportPath, content: JSON.stringify(result, null, 2) });
  }
  async function hold(stage) {
    metrics.stages = [...(metrics.stages ?? []), stage];
    await report({ ok: null, stage, checks, metrics });
    const ack = `${notes.root}/ack-${stage}.txt`;
    await wait(async () => { try { await ipc('read_file', { path: ack }); return true; } catch { return false; } }, `driver switch for ${stage}`, 120);
  }
  const key = (target, name, code, modifiers = {}) => {
    for (const type of ['keydown', 'keyup']) target.dispatchEvent(new KeyboardEvent(type, { key: name, code, ...modifiers, bubbles: true, cancelable: true }));
  };
  const editor = () => document.querySelector('.tab-content.is-active .block-prose');
  // A Markdown note's layout: the block editor's column width, centering, and line spacing.
  const layoutHost = () => document.querySelector('.tab-content.is-active [style*="--block-width"]');
  const columnBox = () => { const h = layoutHost(); return h ? ['--block-width', '--block-margin', '--blog-line-height'].map(v => h.style.getPropertyValue(v)).join('|') : ''; };
  const activeTabName = () => document.getElementById(`tab-${document.querySelector('.tab-content.is-active [data-tab-panel-id]')?.dataset.tabPanelId}`)?.textContent ?? '';
  const footer = text => [...document.querySelectorAll('.footer-nav button')].find(button => button.textContent === text).click();
  const sidebar = () => document.querySelector('.assistant-sidebar');
  const input = () => document.querySelector('[data-assistant-input]');
  const running = () => !!document.querySelector('.assistant-sidebar .as-stop');
  const replies = () => [...document.querySelectorAll('.as-reply .as-text')].map(p => p.textContent);
  const notices = () => [...document.querySelectorAll('.as-notice')].map(n => n.textContent);
  // The connection's setup view (not the chat-history Retry notice, which shares the class).
  const setup = () => [...document.querySelectorAll('.assistant-sidebar .as-setup')].find(s => [...s.querySelectorAll('button')].some(b => b.textContent === 'Check again'));
  const setupText = () => setup()?.textContent ?? '';
  const connected = () => !!document.querySelector('.as-status-good');
  const pick = (label, value) => {
    const select = document.querySelector(`.assistant-sidebar select[aria-label="${label}"]`);
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const tools = () => [...document.querySelectorAll('.assistant-sidebar details.as-tool')].map(row => ({
    row, command: row.querySelector('.as-tool-name')?.textContent ?? '',
    status: [...row.classList].find(c => c.startsWith('as-tool-'))?.slice('as-tool-'.length) ?? '',
  }));
  async function send(text) {
    await wait(() => input() && !input().disabled && !running(), 'composer ready', 30);
    input().value = text;
    input().dispatchEvent(new Event('input', { bubbles: true }));
    await wait(() => !document.querySelector('.as-send')?.disabled, 'send enabled');
    document.querySelector('.as-send').click();
  }
  /** Send, approve each request (recording its card's wording), and wait for the reply. */
  async function ask(label, text, seconds = 240) {
    const before = tools().length;
    await send(text);
    await wait(running, `${label} started`, 30);
    for (let i = 0; i < seconds * 10 && running(); i++) {
      const card = document.querySelector('.as-approval');
      if (card) {
        metrics.approvals.push({ label, title: card.querySelector('.as-approval-title')?.textContent ?? '' });
        card.querySelector('.as-button-primary').click();
      }
      await delay(100);
    }
    if (running()) throw Error(`Timed out: ${label}`);
    return { reply: replies().at(-1) ?? '', tools: tools().slice(before) };
  }
  const bar = () => document.querySelector('[role="dialog"][aria-label="Command bar"]');
  async function runInBar(line) {
    [...document.querySelectorAll('.editor-toolbar button')].find(b => b.getAttribute('aria-label') === 'Command bar').click();
    const field = await wait(() => bar()?.querySelector('input'), 'command bar');
    field.value = line;
    field.dispatchEvent(new InputEvent('input', { bubbles: true }));
    bar().querySelector('form').requestSubmit();
  }
  async function newChat() {
    document.querySelector('[aria-label="New chat"]').click();
    await wait(() => input() && !input().disabled && !replies().length && !tools().length, 'new chat', 30);
  }

  try {
    await wait(() => document.querySelector('.footer-nav'), 'workspace initialization');
    footer('New Note');
    const note = await wait(editor, 'new note');
    note.focus();
    document.execCommand('insertText', false, 'The harbor lantern swung over the quiet water. It rained all evening, and the boats knocked at their moorings.');
    // A new note gets its element name once its file exists.
    const noteName = await wait(() => /\.md$/.test(activeTabName()) && activeTabName(), 'note named', 15);

    for (let attempt = 0; attempt < 5 && !sidebar(); attempt++) {
      document.querySelector('.assistant-bumper').click();
      for (let i = 0; i < 20 && !sidebar(); i++) await delay(100);
    }
    await wait(() => sidebar() && input() && !input().disabled, 'Language Model sidebar');
    pick('Model', 'claude-haiku-5-5');
    pick('Effort', 'low');
    await wait(connected, 'Claude Code connected', 30);

    // Part A — layout through the Assistant, then Undo in the chat.
    const original = await wait(columnBox, 'note column');
    let turn = await ask('layout', 'Make the current note\'s text column narrower, about 560 pixels, centered, with looser line spacing. Change only this note.');
    const apply = turn.tools.find(t => t.command === 'appearance apply' && t.status === 'done');
    assert(!!apply, `The Assistant applies a layout change after approval (${turn.tools.map(t => `${t.command}:${t.status}`).join(', ')})`);
    const card = metrics.approvals.find(a => a.label === 'layout')?.title ?? '';
    assert(/layout/i.test(card) && card.includes(noteName.replace(/\.md$/, '')), `The approval card asks in plain words (${card})`);
    await wait(() => columnBox() !== original, 'layout changed');
    metrics.layout = { before: original, after: columnBox() };
    assert(true, `The note's column changes (${original} → ${columnBox()})`);
    const undo = apply.row.parentElement.querySelector('.as-layout-undo button');
    assert(!!undo && !undo.disabled, 'The change has an Undo button in the chat');
    undo.click();
    await wait(() => columnBox() === original, 'layout restored');
    assert(!!document.querySelector('.as-layout-undone'), 'Undo restores the note\'s layout and says so');

    // A preset, reset from Settings › Note layout.
    turn = await ask('preset', 'Apply the Reading room layout preset to the current note only.');
    assert(turn.tools.some(t => t.command === 'appearance presets apply' && t.status === 'done'), 'The Assistant applies the Reading room preset after approval');
    await wait(() => columnBox() !== original, 'preset applied');
    footer('Settings');
    const reset = await wait(() => document.querySelector(`[aria-label="Reset the layout of ${noteName}"]`), 'Note layout lists the note', 15);
    reset.click();
    await wait(() => !document.querySelector(`[aria-label="Reset the layout of ${noteName}"]`), 'override reset');
    [...document.querySelectorAll('[role="tab"]')].find(t => t.textContent.includes(noteName)).click();
    await wait(() => activeTabName().includes(noteName) && columnBox() === original, 'note back to its default layout');
    assert(true, 'Settings › Note layout resets the preset and the note returns to its default layout');

    // Command bar: /note open and /selection ai.
    await runInBar('/note open Garden.md');
    await wait(() => !bar() && activeTabName() === 'Garden.md', '/note open', 15);
    assert(true, '/note open opens the note in front and closes the bar');
    const garden = await wait(editor, 'Garden editor');
    const text = [...garden.querySelectorAll('p')].map(p => p.firstChild).find(n => n?.textContent?.includes('marigolds'));
    const start = text.textContent.indexOf('marigolds');
    garden.focus();
    const range = document.createRange();
    range.setStart(text, start); range.setEnd(text, start + 'marigolds'.length);
    getSelection().removeAllRanges(); getSelection().addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    await delay(500);
    await runInBar('/selection ai');
    const review = await wait(() => !bar() && document.querySelector('.tab-content.is-active .writing-review'), '/selection ai', 15);
    assert(/marigolds/.test(review.textContent) && activeTabName() === 'AI review', `/selection ai opens an AI review of the selected word (${review.textContent.slice(0, 120)})`);

    // Part B — failure paths on fake CLIs. The next message starts a new process, which finds the fake.
    await hold('cli-not-installed');
    document.querySelector('.as-status').click();
    await wait(() => /not installed/i.test(setupText()), 'not installed', 30);
    assert(true, `Not installed: the setup view says so (${setupText().slice(0, 120)})`);

    await hold('cli-signed-out');
    [...setup().querySelectorAll('button')].find(b => b.textContent === 'Check again').click();
    await wait(() => /not signed in/i.test(setupText()) && /run claude/i.test(setupText()), 'signed out', 30);
    assert(true, `Signed out: the setup view gives the sign-in command (${setupText().slice(0, 160)})`);

    await hold('cli-crash');
    [...setup().querySelectorAll('button')].find(b => b.textContent === 'Check again').click();
    await wait(() => connected() && !setup(), 'crash variant connected', 30);
    await newChat();
    await send('hello');
    await wait(() => notices().some(n => n.includes('connection reset while streaming')), 'crash notice', 30);
    await wait(() => !running(), 'crash ended the turn');
    metrics.crashNotice = notices().find(n => n.includes('connection reset'));
    assert(/stopped: fake claude: connection reset while streaming/.test(metrics.crashNotice), `A crash mid-turn ends the turn with the CLI's own error (${metrics.crashNotice})`);
    await wait(() => connected() && !setup(), 'still signed in after a crash', 30);
    assert(true, 'After a crash the connection is checked again and still signed in (non-JSON output was skipped)');

    await hold('cli-expired');
    await newChat();
    await send('hello');
    await wait(() => notices().includes('Not logged in · Please run /login'), 'expired notice', 30);
    await wait(() => /not signed in/i.test(setupText()), 'expired sign-in shows setup', 30);
    assert(true, `An expired sign-in mid-turn shows the notice and then the setup view (${setupText().slice(0, 120)})`);

    await hold('cli-real');
    [...setup().querySelectorAll('button')].find(b => b.textContent === 'Check again').click();
    await wait(() => connected() && !setup(), 'recovered', 30);
    assert(true, 'Check again recovers once the real CLI is back');

    await report({ ok: true, checks, metrics, pageErrors });
    key(window, 'q', 'KeyQ', { metaKey: true });
  } catch (error) {
    await report({ ok: false, checks, metrics, error: String(error), pageErrors,
      dom: { tab: activeTabName(), column: columnBox(), bar: !!bar(), setup: setupText(), notices: notices(), lastReply: replies().at(-1),
        tools: tools().slice(-5).map(t => `${t.command}:${t.status}`), connection: document.querySelector('.as-status')?.title } });
  }
})();
