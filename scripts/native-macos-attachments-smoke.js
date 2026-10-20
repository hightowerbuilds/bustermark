// Inject only into a disposable build whose identifier contains ".parity-smoke".
// Live acceptance for chat attachments (growth/phases/chat-attachments.md, section 3):
// the limits and refusals, then a paste and a drop to Claude Code, the Attach picker
// to Codex, and a drop to OpenCode on a vision model chosen from its Model menu,
// each answered on the writer's real subscription,
// plus Stop with attachments and temporary-file cleanup. The OS drag and the macOS
// file picker cannot be driven from the page: a drop arrives as Tauri's own drag-drop
// event with real paths, and only the picker call is answered with real paths.
// At each `stage` the report is written and the harness waits for `ack-<stage>.txt`
// in the Notes folder, so the attachment cache can be inspected from outside.
let nextPick = null;
const pickerCalls = [];
// Set before the app's modules run; the prepared bundle routes invoke through this hook.
window.__ATTACH_SMOKE_INVOKE__ = (cmd, args, options) => {
  if (cmd === 'plugin:dialog|open') { pickerCalls.push(args); return Promise.resolve(nextPick); }
  return window.__TAURI_INTERNALS__.invoke(cmd, args, options);
};

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
  const fixtures = `${notes.root}/attach-fixtures`;
  const file = name => `${fixtures}/${name}`;
  const reportPath = `${notes.root}/native-macos-attachments-smoke-result.json`;
  async function report(result) {
    try { await ipc('create_file', { path: reportPath }); } catch { /* Existing report. */ }
    await ipc('write_file', { path: reportPath, content: JSON.stringify(result, null, 2) });
  }
  async function hold(stage) {
    metrics.stages = [...(metrics.stages ?? []), stage];
    await report({ ok: null, stage, checks, metrics });
    const ack = `${notes.root}/ack-${stage}.txt`;
    await wait(async () => { try { await ipc('read_file', { path: ack }); return true; } catch { return false; } }, `outside check of ${stage}`, 120);
  }
  const key = (target, name, code, modifiers = {}) => {
    for (const type of ['keydown', 'keyup']) target.dispatchEvent(new KeyboardEvent(type, { key: name, code, ...modifiers, bubbles: true, cancelable: true }));
  };
  const sidebar = () => document.querySelector('.assistant-sidebar');
  const input = () => document.querySelector('[data-assistant-input]');
  const chips = () => [...document.querySelectorAll('.as-attachment-name')].map(n => n.textContent);
  const attachError = () => document.querySelector('.as-attach-error')?.textContent ?? '';
  const running = () => !!document.querySelector('.assistant-sidebar .as-stop');
  const replies = () => [...document.querySelectorAll('.as-reply .as-text')].map(p => p.textContent);
  const notices = () => [...document.querySelectorAll('.as-notice')].map(n => n.textContent);
  const pick = (label, value) => {
    const select = document.querySelector(`.assistant-sidebar select[aria-label="${label}"]`);
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };
  async function clearChips() {
    for (const button of [...document.querySelectorAll('.as-attachment-remove')]) button.click();
    await wait(() => !chips().length, 'chips removed');
  }
  /** Tauri's drag-drop events, as the OS delivers them, over the sidebar's center (physical pixels). */
  async function drop(paths) {
    const r = sidebar().getBoundingClientRect(), s = devicePixelRatio || 1;
    const position = { x: (r.left + r.width / 2) * s, y: (r.top + r.height / 2) * s };
    await ipc('plugin:event|emit', { event: 'tauri://drag-enter', payload: { paths, position } });
    await ipc('plugin:event|emit', { event: 'tauri://drag-drop', payload: { paths, position } });
  }
  /** A pasted screenshot: a large canvas image on the clipboard, pasted into the message box. */
  async function pasteImage(name, color, width, height) {
    const canvas = Object.assign(document.createElement('canvas'), { width, height });
    const context = canvas.getContext('2d');
    context.fillStyle = color; context.fillRect(0, 0, width, height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const data = new DataTransfer();
    data.items.add(new File([blob], name, { type: 'image/png' }));
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: data });
    input().dispatchEvent(event);
  }
  async function send(text) {
    await wait(() => input() && !input().disabled && !running(), 'composer ready', 30);
    input().value = text;
    input().dispatchEvent(new Event('input', { bubbles: true }));
    await wait(() => !document.querySelector('.as-send')?.disabled, 'send enabled');
    document.querySelector('.as-send').click();
    await wait(running, 'response started', 30);
  }
  const finished = (label, seconds = 180) => wait(() => !running(), label, seconds);
  const lastReply = () => replies().at(-1) ?? '';
  async function newChat(provider) {
    document.querySelector('[aria-label="New chat"]').click();
    await wait(() => input() && !input().disabled && !replies().length, `new chat for ${provider}`, 30);
    pick('Provider', provider);
    if (provider === 'claude') pick('Model', 'claude-haiku-5-5');
    if (provider !== 'opencode') pick('Effort', 'low');
    await wait(() => document.querySelector('.as-status-good'), `${provider} connected`, 30);
  }
  const QUESTION = 'Reply with only two words: the main color of the attached image, then the secret word from the attached text file.';

  try {
    await wait(() => document.querySelector('.footer-nav'), 'workspace initialization');
    for (let attempt = 0; attempt < 5 && !sidebar(); attempt++) {
      document.querySelector('.assistant-bumper').click();
      for (let i = 0; i < 20 && !sidebar(); i++) await delay(100);
    }
    await wait(() => sidebar() && input() && !input().disabled, 'Language Model sidebar');
    await newChat('claude');

    // Limits and refusals: no model requests.
    await drop(Array.from({ length: 9 }, (_, i) => file(`t${i + 1}.txt`)));
    await wait(() => chips().length === 8, 'eight chips');
    assert(attachError().includes('A message can carry 8 attachments; t9.txt was left out.'), `A ninth file is refused by name (${attachError()})`);
    await clearChips();
    await drop([file('huge.txt'), file('report.pdf')]);
    await wait(() => attachError().includes('report.pdf'), 'refusals');
    assert(!chips().length && attachError().includes('huge.txt is larger than 256 KB'), 'An oversized text file is refused');
    assert(attachError().includes("report.pdf can't be attached"), `A PDF is refused by name (${attachError()})`);

    // Claude Code: a pasted screenshot (larger than the shrink size) and a dropped text file.
    await pasteImage('pasted-green.png', '#1aa64b', 2400, 1600);
    await drop([file('marigold.txt')]);
    await wait(() => chips().length === 2, 'pasted image and dropped text');
    assert(chips().includes('pasted-green.png') && chips().includes('marigold.txt'), 'A paste and a drop each add a chip');
    await send(QUESTION);
    assert(!chips().length, 'Sending takes the attachments out of the composer');
    await finished('Claude reply');
    metrics.claude = lastReply();
    assert(/green/i.test(lastReply()) && /marigold/i.test(lastReply()), `Claude Code sees the pasted image and reads the text file (${lastReply().trim()})`);
    const sent = [...document.querySelectorAll('.as-user-files')].at(-1)?.textContent ?? '';
    assert(sent.includes('pasted-green.png') && sent.includes('marigold.txt'), 'The sent message lists its attachments');

    // Stop with an attachment in flight.
    await drop([file('big-blue.png')]);
    await wait(() => chips().length === 1, 'blue image');
    await send('Describe the attached image in about 400 words.');
    await delay(800);
    document.querySelector('.as-stop').click();
    await finished('stop', 15);
    assert(notices().includes('Stopped.'), 'Stop ends a response that carried an attachment');

    // Codex: the Attach button's picker.
    await newChat('codex');
    nextPick = [file('red.png'), file('marigold.txt')];
    document.querySelector('.as-attach').click();
    await wait(() => chips().length === 2, 'picked files');
    assert(pickerCalls.length === 1 && chips().includes('red.png'), 'Attach opens the picker and adds what was chosen');
    await send(QUESTION);
    await finished('Codex reply', 240);
    metrics.codex = lastReply();
    assert(/red/i.test(lastReply()) && /marigold/i.test(lastReply()), `Codex sees the picked image and reads the text file (${lastReply().trim()})`);
    await hold('codex-sent');

    // OpenCode: a drop, then a model that sees images chosen from its own list.
    await newChat('opencode');
    await hold('codex-reset');
    const modelSelect = () => document.querySelector('.assistant-sidebar select[aria-label="Model"]');
    const group = label => [...modelSelect().querySelectorAll('optgroup')].find(g => g.label === label);
    await wait(() => group('Sees images'), "OpenCode's model list", 30);
    metrics.opencodeModels = { seesImages: group('Sees images').querySelectorAll('option').length, textOnly: group('Text only')?.querySelectorAll('option').length ?? 0 };
    assert(metrics.opencodeModels.seesImages > 0, `The Model menu lists OpenCode models that see images (${metrics.opencodeModels.seesImages})`);
    await drop([file('red.png'), file('marigold.txt')]);
    await wait(() => chips().length === 2, 'dropped for OpenCode');
    const hint = () => document.querySelector('.as-hint')?.textContent ?? '';
    metrics.opencodeHint = hint();
    assert(hint().includes('Choose one under Sees images'), `On its default model, OpenCode points to the models that see images (${hint()})`);
    pick('Model', 'opencode-go/claude-haiku-5-5');
    await wait(() => !hint(), 'hint gone for a vision model');
    assert(true, 'Choosing a model that sees images clears the note');
    await send(QUESTION);
    await finished('OpenCode reply', 240);
    metrics.opencode = lastReply();
    assert(/red/i.test(lastReply()) && /marigold/i.test(lastReply()), `OpenCode on a vision model sees the image and reads the text file (${lastReply().trim()})`);

    await report({ ok: true, checks, metrics, pageErrors });
    key(window, 'q', 'KeyQ', { metaKey: true });
  } catch (error) {
    await report({ ok: false, checks, metrics, error: String(error), pageErrors,
      dom: { sidebar: !!sidebar(), chips: chips(), attachError: attachError(), notices: notices(), lastReply: lastReply(),
        setup: document.querySelector('.as-setup')?.textContent, connection: document.querySelector('.as-status')?.title } });
  }
})();
