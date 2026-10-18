// Inject only into a disposable build whose identifier contains ".parity-smoke".
// Color schemes (growth/phases/color-schemes.md): Claude makes a light and a dark
// scheme from a description, each approved from its preview; the Settings gallery
// switches between them; selection is shown in each, then under Courier with a
// shader background. At each `stage` the report is written and the harness waits
// for `ack-<stage>.txt` in the Notes folder, so a screenshot can be taken from
// outside (WebKit paints ::selection; the page cannot capture it). Sends two small
// Claude Haiku requests on the writer's subscription.
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
  const reportPath = `${notes.root}/native-macos-scheme-smoke-result.json`;
  const report = async result => {
    try { await ipc('create_file', { path: reportPath }); } catch { /* Existing report. */ }
    await ipc('write_file', { path: reportPath, content: JSON.stringify(result, null, 2) });
  };
  const editor = () => document.querySelector('.tab-content.is-active .block-prose');
  const footer = text => [...document.querySelectorAll('.footer-nav button')].find(button => button.textContent === text).click();
  const key = (target, name, code, modifiers = {}) => {
    for (const type of ['keydown', 'keyup']) target.dispatchEvent(new KeyboardEvent(type, { key: name, code, ...modifiers, bubbles: true, cancelable: true }));
  };
  const sidebar = () => document.querySelector('.assistant-sidebar');
  const input = () => document.querySelector('[data-assistant-input]');
  const pick = (label, value) => {
    const select = document.querySelector(`.assistant-sidebar select[aria-label="${label}"]`);
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const running = () => !!document.querySelector('.assistant-sidebar .as-stop');
  const tools = name => [...document.querySelectorAll('.as-tool')].filter(t => t.querySelector('.as-tool-name')?.textContent === name);
  async function send(text) {
    await wait(() => input() && !input().disabled && !running(), 'composer ready', 30);
    input().value = text;
    input().dispatchEvent(new Event('input', { bubbles: true }));
    await wait(() => !document.querySelector('.as-send')?.disabled, 'send enabled');
    document.querySelector('.as-send').click();
    await wait(running, 'response started');
  }
  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  /** Pause for an outside screenshot of this moment. */
  async function hold(stage) {
    metrics.stages = [...(metrics.stages ?? []), stage];
    await report({ ok: null, stage, checks, metrics });
    const ack = `${notes.root}/ack-${stage}.txt`;
    await wait(async () => { try { await ipc('read_file', { path: ack }); return true; } catch { return false; } }, `screenshot of ${stage}`, 120);
  }
  function selectPhrase(note, phrase) {
    note.focus();
    const walker = document.createTreeWalker(note, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent.indexOf(phrase);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at); range.setEnd(node, at + phrase.length);
      getSelection().removeAllRanges(); getSelection().addRange(range);
      return range;
    }
    // Courier's drop cap splits a paragraph's first letter into its own node, so phrases avoid it.
    throw Error(`No "${phrase}" in the note`);
  }
  /** Ask Claude for a scheme, check the preview, approve it, and confirm it is on screen. */
  async function makeScheme(label, name, description) {
    document.querySelector('[aria-label="New chat"]').click();
    await wait(() => input() && !input().disabled && !document.querySelector('.as-tool, .as-approval'), `new chat for ${label}`);
    pick('Provider', 'claude');
    pick('Model', 'claude-haiku-5-5');
    pick('Effort', 'low');
    await wait(() => document.querySelector('.as-status-good'), 'Claude connected', 30);
    const started = Date.now();
    await send(`Use the color_scheme_create tool to make a color scheme named "${name}": ${description}. If the tool rejects the colors, fix them and call it again.`);
    const approval = await wait(() => document.querySelector('.as-approval .scheme-preview')?.closest('.as-approval'), `${label} scheme approval`, 240);
    const rejected = tools('color scheme create').filter(t => t.classList.contains('as-tool-failed'));
    const preview = approval.querySelector('.scheme-preview');
    metrics[label] = { approvalMs: Date.now() - started, rejectedFirst: rejected.length,
      rejections: rejected.map(t => t.querySelector('pre:last-of-type')?.textContent?.slice(0, 400)),
      previewBackground: getComputedStyle(preview).backgroundColor };
    assert(approval.textContent.includes(`Create and use the color scheme ${name}?`), `${label}: the approval card names the scheme`);
    assert(preview.querySelectorAll('.scheme-preview-swatch').length === 8, `${label}: the preview shows all eight colors`);
    await hold(`${label}-approval`);
    [...approval.querySelectorAll('button')].find(b => b.textContent === 'Allow').click();
    const saved = await wait(async () => (await ipc('color_schemes_load')).items.find(item => item.name === name), `${label} scheme saved`, 60);
    await wait(() => css('--bg-base') === saved.colors.background, `${label} scheme on screen`, 10);
    await wait(() => !running(), `${label} reply`, 120);
    metrics[label].colors = saved.colors;
    assert(css('--selection') === saved.colors.selection, `${label}: Allow saves the scheme and shows it, selection included`);
    return saved;
  }

  try {
    await wait(() => document.querySelector('.footer-nav'), 'workspace initialization');
    footer('New Note');
    const note = await wait(editor, 'new note');
    note.focus();
    for (const [i, line] of [
      'The harbor lantern swung over the quiet water while the town slept below the hill.',
      'A line worth keeping sat in the middle of the page, waiting for the morning light to find it.',
    ].entries()) {
      if (i) document.execCommand('insertParagraph');
      document.execCommand('insertText', false, line);
    }
    await delay(400);
    const noteTabId = [...document.querySelectorAll('.tab-bar [role="tab"]')].find(tab => tab.getAttribute('aria-selected') === 'true').id;
    const noteTab = () => document.getElementById(noteTabId).click();
    assert(note.querySelectorAll(':scope > p').length === 2, 'A note with two paragraphs is open');

    for (let attempt = 0; attempt < 5 && !sidebar(); attempt++) {
      document.querySelector('.assistant-bumper').click();
      for (let i = 0; i < 20 && !sidebar(); i++) await delay(100);
    }
    await wait(() => sidebar() && input() && !input().disabled, 'Language Model sidebar');

    const light = await makeScheme('light', 'Smoke Paper', 'a light, warm paper look for daytime writing');
    selectPhrase(note, 'line worth keeping');
    metrics.light.selectionPseudo = getComputedStyle(note.querySelector(':scope > p:last-of-type'), '::selection').backgroundColor;
    await hold('light-selection');

    const dark = await makeScheme('dark', 'Smoke Night', 'a dark, deep-blue night look for writing late');
    noteTab();
    selectPhrase(editor(), 'line worth keeping');
    await hold('dark-selection');

    footer('Settings');
    const cards = await wait(() => { const found = [...document.querySelectorAll('.tab-content.is-active .scheme-gallery .bg-card')]; return found.length === 2 ? found : null; }, 'two saved schemes in Settings');
    assert(cards.map(c => c.querySelector('.bg-card-name').textContent).sort().join(',') === 'Smoke Night,Smoke Paper', 'Settings lists both saved schemes');
    const card = name => cards.find(c => c.querySelector('.bg-card-name').textContent === name).querySelector('[role="radio"]');
    card('Smoke Paper').click();
    await wait(() => css('--bg-base') === light.colors.background, 'gallery shows the light scheme');
    assert(card('Smoke Paper').getAttribute('aria-checked') === 'true', 'Clicking a card shows that scheme and marks it');
    await hold('settings-gallery');
    card('Smoke Night').click();
    await wait(() => css('--bg-base') === dark.colors.background, 'gallery shows the dark scheme');

    [...document.querySelectorAll('.tab-content.is-active button')].find(b => b.textContent === 'Courier').click();
    const waves = await wait(() => [...document.querySelectorAll('.tab-content.is-active .bg-gallery [role="radio"]')].find(b => b.textContent.includes('Smoke waves')), 'seeded shader background');
    waves.click();
    await wait(() => waves.getAttribute('aria-checked') === 'true', 'shader background selected');
    noteTab();
    await wait(() => document.querySelector('.block-editor[data-writing-style="courier"]') && document.querySelector('.has-shader-background'), 'Courier with a shader background');
    await delay(1500);
    selectPhrase(editor(), 'line worth keeping');
    assert(true, 'Courier and a shader background apply under the dark scheme');
    await hold('dark-courier-shader');

    await report({ ok: true, checks, metrics, pageErrors });
    key(window, 'q', 'KeyQ', { metaKey: true });
  } catch (error) {
    await report({ ok: false, checks, metrics, error: String(error), pageErrors,
      transcript: sidebar()?.querySelector('.as-transcript')?.innerText?.slice(-3000), connection: document.querySelector('.as-status')?.title });
  }
})();
