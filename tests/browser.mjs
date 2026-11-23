import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { basePath, serve } from '../tools/serve.mjs';

const candidates = [
  process.env.BROWSER_PATH,
  join(process.env.ProgramFiles ?? '', 'Google/Chrome/Application/chrome.exe'),
  join(process.env['ProgramFiles(x86)'] ?? '', 'Microsoft/Edge/Application/msedge.exe'),
  '/usr/bin/chromium', '/usr/bin/google-chrome',
];
const executable = candidates.find(path => path && existsSync(path));
if (!executable) throw new Error('Defina BROWSER_PATH para o executável do Chrome, Chromium ou Edge.');

const profileRoot = resolve(tmpdir());
const profile = await mkdtemp(join(profileRoot, 'nadani-browser-'));
const browser = spawn(executable, ['--headless', '--disable-gpu', '--disable-background-networking', '--no-first-run',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
browser.on('error', error => console.error(error.message));
const problems = [];
let server;
let socket;
let cdp;

async function until(callback, description) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const result = await callback();
    if (result) return result;
    await delay(45);
  }
  throw new Error(`Tempo excedido: ${description}`);
}

async function connect(port) {
  const [page] = await fetch(`http://127.0.0.1:${port}/json/list`).then(res => res.json());
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolveConnection, reject) => {
    socket.addEventListener('open', resolveConnection, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', ({ data }) => {
    const { id: messageId, method, params, result, error } = JSON.parse(data);
    if (pending.has(messageId)) {
      const { resolveCall, reject } = pending.get(messageId);
      pending.delete(messageId);
      if (error) reject(new Error(error.message));
      else resolveCall(result);
    }
    if (method === 'Runtime.exceptionThrown') {
      problems.push(params.exceptionDetails.exception?.description ?? params.exceptionDetails.text);
    }
    if (method === 'Log.entryAdded' && params.entry.level === 'error') problems.push(params.entry.text);
    if (method === 'Network.requestWillBeSent' && ['XHR', 'Fetch', 'Ping'].includes(params.type)) problems.push(params.request.url);
    if (method === 'Network.responseReceived' && params.response.status >= 400) {
      problems.push(`${params.response.status} ${params.response.url}`);
    }
  });
  return (method, params = {}) => new Promise((resolveCall, reject) => {
    pending.set(++id, { resolveCall, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const response = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? expression);
  return response.result.value;
}

async function key(name, code) {
  const args = { key: name, code: name, windowsVirtualKeyCode: code };
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', ...args, text: name === 'Enter' ? '\r' : undefined });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...args });
}

async function capture(name) {
  if (!process.argv.includes('--screenshots')) return;
  await until(() => evaluate('document.querySelector("#toast").textContent === ""'), 'aguardar o aviso temporário antes da captura');
  await mkdir(new URL('../docs/screenshots/', import.meta.url), { recursive: true });
  const { data } = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(new URL(`../docs/screenshots/${name}.png`, import.meta.url), Buffer.from(data, 'base64'));
}

async function visit(view) {
  await evaluate(`location.hash = ${JSON.stringify(view)}`);
  await until(() => evaluate(`document.querySelector('[data-view="${view}"]').hasAttribute('aria-current')`), 'navegar para ' + view);
}

const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const choose = (selector, value) => evaluate(`(() => {
  const input = document.querySelector(${JSON.stringify(selector)});
  input.value = ${JSON.stringify(value)};
  input.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
const focus = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
const storageExpression = "JSON.parse(localStorage.getItem('nadani-task-manager:v1'))";
const getData = () => evaluate(storageExpression);
const card = id => `[data-card="${id}"]`;
const titleOf = text => evaluate(`(${storageExpression}).tasks.find(task => task.title === ${JSON.stringify(text)})`);
const has = expression => until(() => evaluate(expression), expression);

async function viewport(width, height = 960) {
  await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 430 });
  await evaluate('window.scrollTo(0, 0)');
}

async function bounds(selector, yRatio = .5) {
  return evaluate(`(() => {
    const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height * ${yRatio}) };
  })()`);
}

async function drag(from, to, { cancel = false, touch = false } = {}) {
  if (touch) {
    await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
    await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [to] });
    assert.equal(await evaluate('document.body.classList.contains("dragging")'), true);
    assert.equal(await evaluate('document.querySelectorAll(".drop-active").length'), 1);
    await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...from });
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1, ...from });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1, ...to });
    assert.equal(await evaluate('document.body.classList.contains("dragging")'), true);
    assert.equal(await evaluate('document.querySelectorAll(".drop-active").length'), 1);
    if (cancel) await key('Escape', 27);
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1, ...to });
  }
  await has('!document.body.classList.contains("dragging")');
}

async function openBackup(filePath, mode = 'merge') {
  await click('#open-import');
  const { root } = await cdp('DOM.getDocument');
  const { nodeId } = await cdp('DOM.querySelector', { nodeId: root.nodeId, selector: '#import-file' });
  await cdp('DOM.setFileInputFiles', { files: [filePath], nodeId });
  if (mode === 'replace') await click('[name="mode"][value="replace"]');
  await click('#import-submit');
}

try {
  server = await serve(0);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const url = origin + basePath;
  const portFile = join(profile, 'DevToolsActivePort');
  const port = await until(async () => Number((await readFile(portFile, 'utf8').catch(() => '')).split('\n')[0]), 'inicializar Chromium');
  cdp = await connect(port);
  for (const domain of ['Page', 'Runtime', 'Log', 'Network']) await cdp(`${domain}.enable`);
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  await viewport(1440, 960);
  await cdp('Page.navigate', { url });
  await has('document.readyState === "complete" && document.querySelectorAll(".metric").length === 6');
  assert.equal(await getData(), null);
  assert.equal(await evaluate('document.documentElement.dataset.theme'), 'light');
  assert.equal(await evaluate('document.querySelector("#welcome").hidden'), false);
  await capture('boas-vindas');
  await click('#load-demo');
  assert.equal((await getData()).tasks.length, 8);
  assert.equal(await evaluate('document.querySelector(".metric strong").textContent'), '8');
  assert.equal(await evaluate('document.querySelectorAll("#status-chart svg circle").length'), 4);
  assert.equal(await evaluate('document.querySelectorAll(".priority-bar").length'), 4);
  await capture('dashboard');
  console.log('Boas-vindas, exemplos opcionais, métricas, gráficos e atividade.');

  await focus('#create-task');
  await key('Enter', 13);
  assert.equal(await evaluate('document.activeElement.id'), 'task-title');
  await click('#save-task');
  assert.equal(await evaluate('document.querySelector("#task-title").getAttribute("aria-invalid")'), 'true');
  await evaluate(`(() => {
    const values = { title: 'Auditar acessibilidade', description: 'Rever o cabeçalho, o contraste e a navegação pelo teclado.', status: 'todo', priority: 'urgent', dueDate: '2000-01-01', category: 'Qualidade', tags: 'a11y, revisão' };
    const form = document.querySelector('#task-form');
    for (const [key, value] of Object.entries(values)) form.elements.namedItem(key).value = value;
    form.requestSubmit();
    form.requestSubmit();
  })()`);
  const created = await titleOf('Auditar acessibilidade');
  assert.equal((await getData()).tasks.length, 9);
  assert.equal(await evaluate('document.querySelector(".metric strong").textContent'), '9');
  await has('document.activeElement.id === "create-task"');
  await click('#create-task');
  await key('Tab', 9);
  assert.equal(await evaluate('document.activeElement.id'), 'task-description');
  await key('Escape', 27);
  await has('!document.querySelector("#editor").open && document.activeElement.id === "create-task"');

  await viewport(1440, 1500);
  await visit('board');
  const source = await bounds(card(created.id) + ' .drag-handle');
  const destination = await bounds('[data-column="in_progress"] .column-header');
  await drag(source, destination, { cancel: true });
  assert.equal((await titleOf(created.title)).status, 'todo');
  await drag(source, destination);
  assert.equal((await titleOf(created.title)).status, 'in_progress');
  const afterMove = await evaluate('[...document.querySelectorAll(\'[data-column="in_progress"] [data-card]\')].map(card => card.dataset.card)');
  assert.equal(afterMove[0], created.id);

  const reordered = await evaluate('[...document.querySelectorAll(\'[data-column="todo"] [data-card]\')].slice(0, 2).map(card => card.dataset.card)');
  await drag(await bounds(card(reordered[1]) + ' .drag-handle'), await bounds(card(reordered[0]), .12));
  assert.equal(await evaluate('document.querySelector(\'[data-column="todo"] [data-card]\').dataset.card'), reordered[1]);
  await click('#theme-toggle');
  assert.equal(await evaluate('document.documentElement.dataset.theme'), 'dark');
  await viewport(1440);
  await capture('kanban');
  await cdp('Page.reload');
  await has(`document.querySelector('[data-column="todo"] [data-card]')?.dataset.card === '${reordered[1]}'`);
  assert.equal(await evaluate('document.documentElement.dataset.theme'), 'dark');
  console.log('Criação, validação, modal por teclado, arraste com mouse, cancelamento, ordem e tema após recarga.');

  await viewport(430, 1040);
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  const touchFrom = await bounds(card(reordered[0]) + ' .drag-handle');
  const touchTo = await bounds(card(reordered[1]), .14);
  await drag(touchFrom, touchTo, { touch: true });
  assert.equal(await evaluate('document.querySelector(\'[data-column="todo"] [data-card]\').dataset.card'), reordered[0]);
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
  await viewport(1440);

  await focus(card(created.id) + ' .drag-handle');
  await key('Enter', 13);
  assert.equal(await evaluate('document.activeElement.id'), 'details-title');
  await choose('#detail-status', 'done');
  assert.equal((await titleOf(created.title)).status, 'done');
  assert.ok((await titleOf(created.title)).completedAt);
  await key('Escape', 27);
  await has('!document.querySelector("#details").open');
  await click(card(created.id) + ' [data-action="toggle-done"]');
  assert.equal((await titleOf(created.title)).status, 'todo');
  assert.equal((await titleOf(created.title)).completedAt, null);
  await click(card(created.id) + ' .task-link');
  await click('[data-direction="up"]');
  assert.ok((await titleOf(created.title)).order < 4);
  await key('Escape', 27);

  await click('#toggle-filters');
  await choose('#filters select[name="priority"]', 'urgent');
  await choose('#filters select[name="category"]', 'Qualidade');
  await click('#filters [name="overdue"]');
  await evaluate(`(() => {
    const input = document.querySelector('#filters [name="query"]');
    input.value = 'cabecalho revisao';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  })()`);
  await has('document.querySelector("#results-count").textContent.startsWith("1 de")');
  await visit('list');
  assert.equal(await evaluate('document.querySelectorAll(".task-table tbody tr").length'), 1);
  await click('.task-table [data-action="edit"]');
  assert.equal(await evaluate('document.querySelector("#task-title").value'), created.title);
  await evaluate('document.querySelector("#task-title").value = "Revisar acessibilidade"');
  await click('#save-task');
  assert.equal((await titleOf('Revisar acessibilidade')).id, created.id);
  await click('#filters [name="done"]');
  assert.equal(await evaluate('document.querySelector(".results-empty h2").textContent'), 'Nenhuma tarefa encontrada');
  await click('.results-empty [data-action="clear"]');
  assert.equal(await evaluate('document.querySelectorAll(".task-table tbody tr").length'), 9);
  await choose('#sort-options select', 'title');
  assert.equal(await evaluate('document.querySelector(".task-table tbody .task-link").textContent'), 'Desenvolver página inicial');
  await focus(`.task-table [data-action="delete"][data-id="${created.id}"]`);
  await key('Enter', 13);
  await key('Escape', 27);
  assert.equal((await getData()).tasks.length, 9);
  await focus(`.task-table [data-action="delete"][data-id="${created.id}"]`);
  await key('Enter', 13);
  await click('#confirm-action');
  assert.equal((await getData()).tasks.length, 8);
  await has('document.activeElement.id === "undo-delete"');
  await key('Enter', 13);
  assert.equal((await getData()).tasks.length, 9);
  await click('#toggle-filters');
  console.log('Arraste por toque, alternativa com teclado, conclusão, reabertura, filtros, lista, edição e desfazer exclusão.');

  for (const width of [320, 375, 430, 768, 1024, 1440]) {
    await viewport(width);
    for (const view of ['dashboard', 'board', 'list', 'settings']) {
      await visit(view);
      const layout = await evaluate('({ viewport: innerWidth, width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth })');
      assert.equal(layout.viewport, width);
      assert.equal(layout.scroll, layout.width, `Overflow em ${view} @ ${width}`);
      if (width === 375 && view === 'board') {
        await evaluate('document.activeElement.blur()');
        await capture('mobile');
      }
    }
    await click('#create-task');
    assert.equal(await evaluate('document.querySelector("#editor").scrollWidth <= document.querySelector("#editor").clientWidth + 1'), true);
    await key('Escape', 27);
  }
  console.log('Quatro telas e formulário em 320, 375, 430, 768, 1024 e 1440 px.');

  await visit('settings');
  await choose('#pref-view', 'list');
  await choose('#pref-theme', 'system');
  assert.equal(await evaluate('document.documentElement.dataset.theme'), 'light');
  const downloads = join(profile, 'downloads');
  await mkdir(downloads);
  await cdp('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  await click('#export-json');
  await click('#export-csv');
  const today = await evaluate('new Date().toLocaleDateString("sv-SE")');
  const jsonPath = join(downloads, `nadani-tarefas-${today}.json`);
  const csvPath = join(downloads, `nadani-tarefas-${today}.csv`);
  const exported = await until(() => readFile(jsonPath, 'utf8').catch(() => ''), 'baixar JSON');
  const spreadsheet = await until(() => readFile(csvPath, 'utf8').catch(() => ''), 'baixar CSV');
  assert.equal(JSON.parse(exported).tasks.length, 9);
  assert.ok(spreadsheet.includes('Revisar acessibilidade'));
  const invalid = join(downloads, 'invalid.json');
  await writeFile(invalid, '{invalid');
  await openBackup(invalid);
  await has('document.querySelector("#import-feedback").textContent.includes("JSON válido")');
  await key('Escape', 27);
  await openBackup(jsonPath);
  await has(`(${storageExpression}).tasks.length === 18`);
  assert.equal(new Set((await getData()).tasks.map(task => task.id)).size, 18);
  await openBackup(jsonPath, 'replace');
  await has('document.querySelector("#confirm").open');
  assert.equal((await getData()).tasks.length, 18);
  await click('#confirm-action');
  assert.equal((await getData()).tasks.length, 9);

  await cdp('Page.navigate', { url });
  await has('document.querySelector(\'[data-view="list"]\')?.hasAttribute("aria-current")');
  assert.equal((await getData()).tasks.length, 9);
  const corrupted = await evaluate(`(() => {
    const snapshot = ${storageExpression};
    snapshot.tasks.push({ id: 'invalid' });
    const raw = JSON.stringify(snapshot);
    localStorage.setItem('nadani-task-manager:v1', raw);
    return raw;
  })()`);
  await cdp('Page.reload');
  await has('!document.querySelector("#storage-warning")?.hidden && document.querySelector("#storage-message")?.textContent.includes("recuperados")');
  assert.equal(await evaluate('localStorage.getItem("nadani-task-manager:v1")'), corrupted);
  assert.equal(await evaluate('document.querySelectorAll(".task-table tbody tr").length'), 9);
  await click('#repair-storage');
  await click('#confirm-action');
  assert.equal(await evaluate('document.querySelector("#storage-warning").hidden'), true);
  assert.equal((await getData()).tasks.length, 9);

  const large = join(downloads, 'large.json');
  const original = JSON.parse(exported).tasks[0];
  const literal = '<strong>Conteúdo importado</strong>';
  await writeFile(large, JSON.stringify({ version: 1, tasks: Array.from({ length: 500 }, (_, index) => ({
    ...original, id: 'perf-' + index, title: 'Tarefa de teste ' + index, description: index === 499 ? literal : original.description, order: index,
  })) }));
  await visit('settings');
  await openBackup(large, 'replace');
  await has('document.querySelector("#confirm").open');
  await click('#confirm-action');
  assert.equal((await getData()).tasks.length, 500);
  await visit('board');
  assert.equal(await evaluate('document.querySelectorAll("[data-card]").length'), 500);
  await choose('#filters [name="query"]', 'teste 499');
  assert.equal(await evaluate('document.querySelectorAll("[data-card]").length'), 1);
  assert.equal(await evaluate('document.querySelector(".card-description").textContent'), literal);
  assert.equal(await evaluate('document.querySelector(".card-description strong")'), null);
  await visit('settings');
  await click('#clear-storage');
  await has('document.querySelector("#confirm").open');
  assert.equal((await getData()).tasks.length, 500);
  await click('#confirm-action');
  assert.deepEqual((await getData()).tasks, []);
  assert.deepEqual(problems, []);
  console.log('Downloads reais JSON/CSV, importação, recuperação de armazenamento, volume de 500 tarefas, limpeza e console.');
} finally {
  if (cdp && socket.readyState === WebSocket.OPEN) {
    await Promise.race([cdp('Browser.close').catch(() => {}), delay(700)]);
    socket.close();
  }
  if (browser.exitCode === null) {
    await Promise.race([new Promise(resolveExit => browser.once('exit', resolveExit)), delay(2000)]);
  }
  if (browser.exitCode === null) browser.kill();
  if (server) await new Promise(resolveClose => server.close(resolveClose));
  if (dirname(profile) === profileRoot) {
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
