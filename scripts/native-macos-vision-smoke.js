// Inject only into a disposable build whose identifier contains ".parity-smoke".
// Live acceptance for the Assistant's eyes and phrase search
// (growth/phases/image-viewing.md section 4, growth/phases/phase-3.md section 3):
// Claude Code views a Wikimedia Commons painting by URL, a swatch in the Notes folder
// whose color it can only know by looking, and a `web images` result; answers through
// `web search` without a key; and finds a phrase in the Notes folder, opening the
// right note with the phrase selected. Codex and OpenCode (on a model that sees
// images) then view the same swatch. About seven small live requests.
void (async () => {
  const checks = [];
  const metrics = { turns: {} };
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
  const color = (await ipc('read_file', { path: `${notes.root}/vision-fixtures/expected-color.txt` })).content.trim();
  const reportPath = `${notes.root}/native-macos-vision-smoke-result.json`;
  async function report(result) {
    try { await ipc('create_file', { path: reportPath }); } catch { /* Existing report. */ }
    await ipc('write_file', { path: reportPath, content: JSON.stringify(result, null, 2) });
  }
  const key = (target, name, code, modifiers = {}) => {
    for (const type of ['keydown', 'keyup']) target.dispatchEvent(new KeyboardEvent(type, { key: name, code, ...modifiers, bubbles: true, cancelable: true }));
  };
  const sidebar = () => document.querySelector('.assistant-sidebar');
  const input = () => document.querySelector('[data-assistant-input]');
  const running = () => !!document.querySelector('.assistant-sidebar .as-stop');
  const replies = () => [...document.querySelectorAll('.as-reply .as-text')].map(p => p.textContent);
  const pick = (label, value) => {
    const select = document.querySelector(`.assistant-sidebar select[aria-label="${label}"]`);
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };
  /** Every tool row in the chat: its command, status, result text, and how many images went to the model. */
  const tools = () => [...document.querySelectorAll('.assistant-sidebar details.as-tool')].map(row => ({
    command: row.querySelector('.as-tool-name')?.textContent ?? '',
    status: [...row.classList].find(c => c.startsWith('as-tool-'))?.slice('as-tool-'.length) ?? '',
    result: row.querySelectorAll('pre')[1]?.textContent ?? '',
    images: row.nextElementSibling?.classList.contains('as-tool-images') ? row.nextElementSibling.querySelectorAll('img').length : 0,
  }));
  async function newChat(provider, model) {
    document.querySelector('[aria-label="New chat"]').click();
    await wait(() => input() && !input().disabled && !replies().length && !tools().length, `new chat for ${provider}`, 30);
    pick('Provider', provider);
    if (provider !== 'opencode') pick('Effort', 'low');
    await wait(() => document.querySelector('.as-status-good'), `${provider} connected`, 30);
    if (model) {
      await wait(() => [...document.querySelectorAll('.assistant-sidebar select[aria-label="Model"] option')].some(o => o.value === model), `${model} listed`, 30);
      pick('Model', model);
    }
  }
  /** Send, approve whatever it asks to do, and return the reply plus the tool rows this turn added. */
  async function ask(label, text, seconds = 240) {
    const before = tools().length;
    await wait(() => input() && !input().disabled && !running(), 'composer ready', 30);
    input().value = text;
    input().dispatchEvent(new Event('input', { bubbles: true }));
    await wait(() => !document.querySelector('.as-send')?.disabled, 'send enabled');
    document.querySelector('.as-send').click();
    await wait(running, `${label} started`, 30);
    for (let i = 0; i < seconds * 10 && running(); i++) {
      document.querySelector('.as-approval .as-button-primary')?.click();
      await delay(100);
    }
    if (running()) throw Error(`Timed out: ${label}`);
    const turn = { reply: replies().at(-1) ?? '', tools: tools().slice(before) };
    metrics.turns[label] = { reply: turn.reply.slice(0, 400), tools: turn.tools.map(t => ({ command: t.command, status: t.status, images: t.images })) };
    return turn;
  }
  const used = (turn, command) => turn.tools.filter(t => t.command === command);
  const succeeded = (turn, command) => used(turn, command).find(t => t.status === 'done');
  const STARRY = 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/ea/Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg/1280px-Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg';
  const SWATCH = 'Use image_view to look at the image file swatch.png in my Notes folder. Reply with only the name of its color, in one word.';

  try {
    await wait(() => document.querySelector('.footer-nav'), 'workspace initialization');
    for (let attempt = 0; attempt < 5 && !sidebar(); attempt++) {
      document.querySelector('.assistant-bumper').click();
      for (let i = 0; i < 20 && !sidebar(); i++) await delay(100);
    }
    await wait(() => sidebar() && input() && !input().disabled, 'Language Model sidebar');
    await newChat('claude', 'claude-haiku-5-5');

    let turn = await ask('painting', `Use image_view to look at ${STARRY} and tell me, in one short sentence, its two main colors.`);
    assert(succeeded(turn, 'image view')?.images > 0, 'Claude Code views a Wikimedia Commons painting by URL and the image goes to the model');
    assert(/blue/i.test(turn.reply), `It describes the painting's colors (${turn.reply.trim()})`);

    turn = await ask('swatch', SWATCH);
    assert(succeeded(turn, 'image view')?.images > 0, 'Claude Code views an image file from the Notes folder');
    assert(new RegExp(color, 'i').test(turn.reply), `It names a color it could only know by looking: ${color} (${turn.reply.trim()})`);

    turn = await ask('web images', 'Use web_images to find a photo of a lighthouse, look at what comes back, and say in one sentence what the first picture shows.');
    assert(succeeded(turn, 'web images')?.images > 0, '`web images` returns pictures to the model');
    assert(/lighthouse|tower|coast|sea|rock/i.test(turn.reply), `It describes what it found (${turn.reply.trim()})`);

    turn = await ask('web search', 'Use web_search to find the year the Eiffel Tower opened to the public. Answer with the year and cite the source as a link.');
    assert(!!succeeded(turn, 'web search') && !used(turn, 'web search').some(t => t.status === 'failed'), '`web search` answers without a Brave key');
    assert(/1889/.test(turn.reply) && /https?:\/\//.test(document.querySelectorAll('.as-reply')[document.querySelectorAll('.as-reply').length - 1].innerHTML), `It answers with a cited source (${turn.reply.trim().slice(0, 120)})`);

    // Phrase search: notes search → note open → selection set (phase-3.md section 3).
    turn = await ask('phrase search', 'Find "seventeen gulls" in my notes and open that note with the phrase selected.');
    assert(!!succeeded(turn, 'notes search'), 'It searches the Notes folder');
    assert(!!succeeded(turn, 'note open'), 'It opens the note');
    const selected = succeeded(turn, 'selection set');
    assert(!!selected && /seventeen gulls/i.test(selected.result), `It selects the phrase (${selected?.result.slice(0, 160)})`);
    const activeTab = document.querySelector('.tab-content.is-active [data-tab-panel-id]')?.dataset.tabPanelId;
    const tabName = document.getElementById(`tab-${activeTab}`)?.textContent ?? '';
    metrics.phraseTab = tabName;
    assert(/Lighthouse/.test(tabName) || /Lighthouse\.md/.test(selected.result), `The right note is the one opened: Lighthouse.md (${tabName})`);

    // Codex and OpenCode, on the same swatch.
    await newChat('codex');
    turn = await ask('codex swatch', SWATCH);
    metrics.codexSawImage = new RegExp(color, 'i').test(turn.reply);
    assert(succeeded(turn, 'image view')?.images > 0 && metrics.codexSawImage, `Codex passes image_view's picture through and names the ${color} swatch (${turn.reply.trim()})`);

    await newChat('opencode', 'opencode-go/claude-haiku-5-5');
    turn = await ask('opencode swatch', SWATCH);
    metrics.opencodeSawImage = new RegExp(color, 'i').test(turn.reply);
    assert(succeeded(turn, 'image view')?.images > 0 && metrics.opencodeSawImage, `OpenCode on a model that sees images names the ${color} swatch (${turn.reply.trim()})`);

    await report({ ok: true, color, checks, metrics, pageErrors });
    key(window, 'q', 'KeyQ', { metaKey: true });
  } catch (error) {
    await report({ ok: false, color, checks, metrics, error: String(error), pageErrors,
      dom: { sidebar: !!sidebar(), tools: tools().slice(-6), lastReply: replies().at(-1),
        notices: [...document.querySelectorAll('.as-notice')].map(n => n.textContent), connection: document.querySelector('.as-status')?.title } });
  }
})();
