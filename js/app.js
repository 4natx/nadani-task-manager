import { $, action, element, icon } from './dom.js';
import { makeDemo } from './demo.js';
import { renderDashboard } from './dashboard.js';
import { setupDrag } from './drag.js';
import { confirmAction, createTaskDialogs, showDialog } from './modals.js';
import { createStorage, withActivity } from './storage.js';
import { createTask, deleteTask, editTask, filterTasks, localDay, moveTask, ordered, restoreTask, sortTasks } from './task.js';
import { backupJSON, downloadFile, exportCSV, maxImportBytes, mergeTasks, parseBackup } from './transfer.js';
import { kanban, taskList } from './views.js';

const storage = createStorage();
let snapshot = storage.load();
const state = () => snapshot.data;
const tasks = () => state().tasks;
const filtersForm = $('#filters');
const results = $('#task-results');
const themes = matchMedia('(prefers-color-scheme: dark)');
const screens = { dashboard: 'Visão geral', board: 'Kanban', list: 'Lista de tarefas', settings: 'Configurações' };
const categories = () => [...new Set(tasks().map(task => task.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
let view;
let undo;
let undoTimer;
let toastTimer;
let searchTimer;
let currentDay = localDay();

function notify(message, error = false) {
  const toast = $('#toast');
  clearTimeout(toastTimer);
  toast.classList.toggle('toast-error', error);
  toast.textContent = message;
  toastTimer = setTimeout(() => { toast.textContent = ''; }, error ? 5600 : 3200);
}

function readFilters() {
  const filters = Object.fromEntries(new FormData(filtersForm));
  filters.overdue = Boolean(filters.overdue);
  filters.done = Boolean(filters.done);
  return filters;
}

function clearFilters() {
  const order = filtersForm.elements.sort.value;
  filtersForm.reset();
  filtersForm.elements.sort.value = order;
  renderResults();
  filtersForm.elements.query.focus();
}

const cancelDrag = setupDrag(results, (id, status, before) => changeStatus(id, status, before), notify);

function renderResults() {
  clearTimeout(searchTimer);
  cancelDrag();
  const active = document.activeElement;
  const focusInResults = results.contains(active);
  const category = filtersForm.elements.category;
  const selected = category.value;
  category.replaceChildren(new Option('Todas', ''), ...categories().map(value => new Option(value, value)));
  if (selected) {
    if (![...category.options].some(option => option.value === selected)) category.append(new Option(selected, selected));
    category.value = selected;
  }
  const filters = readFilters();
  const filtered = filterTasks(tasks(), filters);
  const filterCount = [filters.status, filters.priority, filters.category, filters.overdue, filters.done].filter(Boolean).length;
  const filterCountLabel = $('#filter-count');
  filterCountLabel.textContent = filterCount;
  filterCountLabel.hidden = filterCount === 0;
  $('#results-count').textContent = `${filtered.length} de ${tasks().length} ${tasks().length === 1 ? 'tarefa' : 'tarefas'}`;
  const searchActive = filterCount > 0 || filters.query.trim() !== '';
  if (!filtered.length && (view === 'list' || searchActive)) {
    const empty = element('section', 'panel results-empty');
    empty.append(icon(searchActive ? 'search' : 'list'), element('h2', '', searchActive ? 'Nenhuma tarefa encontrada' : 'Sua lista está vazia'),
      element('p', '', searchActive ? 'Ajuste a pesquisa ou limpe os filtros para ver suas tarefas.' : 'Crie uma tarefa para começar a organizar o trabalho.'),
      action(searchActive ? 'Limpar filtros' : 'Nova tarefa', searchActive ? 'clear' : 'add', { symbol: searchActive ? 'close' : 'plus' }));
    results.replaceChildren(empty);
  } else {
    results.replaceChildren(view === 'board' ? kanban(filtered) : taskList(sortTasks(filtered, filters.sort)));
  }

  if (focusInResults) {
    const replacement = [...results.querySelectorAll('[data-action]')].find(button =>
      button.dataset.action === active.dataset.action && button.dataset.id === active.dataset.id && button.dataset.status === active.dataset.status);
    (replacement ?? filtersForm.elements.query).focus({ preventScroll: true });
  }
}

function applyPreferences() {
  const { theme, view: start } = state().preferences;
  document.documentElement.dataset.theme = theme === 'system' ? themes.matches ? 'dark' : 'light' : theme;
  $('#pref-theme').value = theme;
  $('#pref-view').value = start;
  const dark = document.documentElement.dataset.theme === 'dark';
  const button = $('#theme-toggle');
  button.replaceChildren(icon(dark ? 'sun' : 'moon'));
  button.setAttribute('aria-label', dark ? 'Ativar tema claro' : 'Ativar tema escuro');
}

function showWarnings() {
  $('#storage-warning').hidden = !snapshot.issue;
  $('#storage-message').textContent = snapshot.issue + (snapshot.raw !== null && snapshot.issue ? ' Baixe uma cópia antes de gravar os registros recuperados.' : '');
  $('#raw-backup').hidden = snapshot.raw === null;
  $('#repair-storage').hidden = snapshot.raw === null;
}

function refresh() {
  showWarnings();
  applyPreferences();
  if (view === 'dashboard') renderDashboard(state());
  if (view === 'board' || view === 'list') renderResults();
}

function route(focus = false) {
  const hash = location.hash.slice(1);
  if (hash === 'main' && focus) return;
  clearTimeout(searchTimer);
  cancelDrag();
  view = Object.hasOwn(screens, hash) ? hash : state().preferences.view;
  $('#dashboard').hidden = view !== 'dashboard';
  $('#settings').hidden = view !== 'settings';
  const taskView = view === 'board' || view === 'list';
  $('#tasks-view').hidden = !taskView;
  $('#sort-options').hidden = view !== 'list';
  $('#breadcrumb').textContent = screens[view];
  $('#tasks-title').textContent = screens[view];
  $('#tasks-description').textContent = view === 'board'
    ? 'Organize as tarefas por etapa. Arraste pela alça ou abra uma tarefa para movê-la.'
    : 'Consulte, filtre e organize todas as suas tarefas.';
  for (const link of document.querySelectorAll('[data-view], [data-switch]')) {
    if ((link.dataset.view ?? link.dataset.switch) === view) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  refresh();
  if (focus) {
    $(taskView ? '#tasks-title' : `#${view}-title`).focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
}

function commit(next, message, options) {
  try {
    snapshot = storage.save(next, options);
  } catch (error) {
    notify(error.message, true);
    return false;
  }
  refresh();
  if (message) notify(message);
  return true;
}

function changeTasks(next, event, label, message) {
  const data = withActivity({ ...state(), tasks: next }, event, label);
  return commit(data, message);
}

function saveTask(id, values) {
  try {
    if (!id) {
      const task = createTask(tasks(), values);
      return changeTasks([...tasks(), task], 'created', task.title, 'Tarefa criada.');
    }
    const previous = tasks().find(item => item.id === id);
    if (!previous) return false;
    const next = editTask(tasks(), id, values);
    if (next === tasks()) return true;
    const completed = previous.status !== 'done' && values.status === 'done';
    return changeTasks(next, completed ? 'completed' : previous.status === values.status ? 'edited' : 'moved',
      values.title, completed ? 'Tarefa concluída.' : 'Tarefa atualizada.');
  } catch (error) {
    notify(error.message, true);
    return false;
  }
}

function changeStatus(id, status, beforeId = null) {
  const task = tasks().find(item => item.id === id);
  if (!task) return false;
  const next = moveTask(tasks(), id, status, beforeId);
  if (next === tasks()) return true;
  if (task.status === status) return changeTasks(next, 'reordered', task.title, 'Ordem atualizada.');
  if (status === 'done') return changeTasks(next, 'completed', task.title, 'Tarefa concluída.');
  return changeTasks(next, 'moved', task.title, task.status === 'done' ? 'Tarefa reaberta.' : 'Status atualizado.');
}

function clearUndo() {
  const hadFocus = document.activeElement === $('#undo-delete');
  clearTimeout(undoTimer);
  undo = null;
  $('#undo-toast').hidden = true;
  if (hadFocus) $('#create-task').focus({ preventScroll: true });
}

function removeTask(task, from) {
  confirmAction('Excluir tarefa?', `“${task.title}” será removida deste navegador. Você poderá desfazer por alguns segundos.`, 'Excluir tarefa', () => {
    const column = ordered(tasks(), task.status);
    const beforeId = column[column.findIndex(item => item.id === task.id) + 1]?.id;
    if (!changeTasks(deleteTask(tasks(), task.id), 'deleted', task.title, 'Tarefa excluída.')) return false;
    clearUndo();
    undo = { task, beforeId };
    $('#undo-text').textContent = 'Exclusão disponível para desfazer.';
    $('#undo-toast').hidden = false;
    undoTimer = setTimeout(clearUndo, 10_000);
    return true;
  }, from);
}

const taskDialogs = createTaskDialogs({ getTasks: tasks, getCategories: categories, save: saveTask, notify, move: changeStatus, remove: removeTask });

results.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { action: command, id, status } = button.dataset;
  if (command === 'add') taskDialogs.showEditor(undefined, status);
  if (command === 'clear') clearFilters();
  const task = tasks().find(item => item.id === id);
  if (!task) return;
  if (command === 'details') taskDialogs.showDetails(task);
  if (command === 'edit') taskDialogs.showEditor(task);
  if (command === 'delete') removeTask(task);
  if (command === 'toggle-done') changeStatus(id, task.status === 'done' ? 'todo' : 'done');
});

for (const selector of ['#create-task', '#welcome-create']) $(selector).addEventListener('click', () => taskDialogs.showEditor());
$('#undo-delete').addEventListener('click', () => {
  if (!undo) return;
  const { task, beforeId } = undo;
  try {
    if (changeTasks(restoreTask(tasks(), task, beforeId), 'restored', task.title, 'Tarefa restaurada.')) clearUndo();
  } catch (error) {
    notify(error.message, true);
  }
});

$('#toggle-filters').addEventListener('click', event => {
  const options = $('#filter-options');
  options.hidden = !options.hidden;
  event.currentTarget.setAttribute('aria-expanded', String(!options.hidden));
});
$('#clear-filters').addEventListener('click', clearFilters);
filtersForm.addEventListener('submit', event => { event.preventDefault(); renderResults(); });
filtersForm.addEventListener('change', renderResults);
filtersForm.elements.query.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(renderResults, 130);
});

function updatePreference(key, value) {
  commit({ ...state(), preferences: { ...state().preferences, [key]: value } });
  applyPreferences();
}
$('#pref-theme').addEventListener('change', event => updatePreference('theme', event.target.value));
$('#pref-view').addEventListener('change', event => updatePreference('view', event.target.value));
$('#theme-toggle').addEventListener('click', () => updatePreference('theme', document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
themes.addEventListener('change', applyPreferences);

function loadDemo() {
  const load = () => {
    try {
      const examples = makeDemo();
      return changeTasks(mergeTasks(tasks(), examples), 'demo', 'Projeto de exemplo', 'Tarefas de exemplo adicionadas.');
    } catch (error) {
      notify(error.message, true);
      return false;
    }
  };
  if (tasks().length || snapshot.issue) confirmAction('Adicionar tarefas de exemplo?', 'As tarefas fictícias serão adicionadas às suas tarefas locais.', 'Adicionar exemplos', load);
  else load();
}
$('#load-demo').addEventListener('click', loadDemo);
$('#settings-demo').addEventListener('click', loadDemo);
$('#clear-storage').addEventListener('click', () => confirmAction('Limpar os dados locais?', 'Todas as tarefas, o histórico e as preferências deste aplicativo serão removidos. Exporte um backup antes de continuar se quiser guardar as tarefas.', 'Limpar dados', () => {
  const data = { ...state(), tasks: [], activity: [], preferences: { theme: 'system', view: 'dashboard' } };
  const saved = commit(data, 'Dados locais limpos.', { replace: true });
  if (saved) clearUndo();
  return saved;
}));

$('#repair-storage').addEventListener('click', () => confirmAction('Gravar os dados recuperados?', 'Ao gravar, os registros inválidos serão removidos do armazenamento ativo. A cópia original pode ser baixada antes desta ação.', 'Gravar recuperação',
  () => commit(state(), 'Dados recuperados gravados.', { replace: true })));
$('#raw-backup').addEventListener('click', () => {
  if (snapshot.raw !== null) downloadFile('nadani-dados-originais.txt', snapshot.raw, 'text/plain;charset=utf-8');
});

function exportTasks(format) {
  try {
    const isJSON = format === 'json';
    const content = isJSON ? backupJSON(tasks()) : exportCSV(tasks());
    downloadFile(`nadani-tarefas-${localDay()}.${format}`, content, isJSON ? 'application/json' : 'text/csv;charset=utf-8');
    notify(`Exportação ${format.toUpperCase()} preparada.`);
  } catch {
    notify('Falha ao preparar a exportação.', true);
  }
}
$('#export-json').addEventListener('click', () => exportTasks('json'));
$('#export-csv').addEventListener('click', () => exportTasks('csv'));

const importDialog = $('#import-dialog');
const importForm = $('#import-form');
const importFile = $('#import-file');
const importSubmit = $('#import-submit');
const importFeedback = $('#import-feedback');
let importRevision = 0;
$('#open-import').addEventListener('click', () => {
  importRevision++;
  importForm.reset();
  importSubmit.disabled = false;
  importFeedback.textContent = '';
  showDialog(importDialog, document.activeElement, importFile);
});
importDialog.addEventListener('cancel', () => { importRevision++; });
importForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!importDialog.open || importSubmit.disabled || !importFile.files[0]) return;
  const file = importFile.files[0];
  const replace = importForm.elements.mode.value === 'replace';
  const revision = ++importRevision;
  importFeedback.textContent = 'Validando arquivo…';
  importSubmit.disabled = true;
  try {
    if (file.size > maxImportBytes) throw new Error('O arquivo excede o limite de 8 MiB.');
    const incoming = parseBackup(await file.text());
    if (revision !== importRevision || !importDialog.open) return;
    if (replace) {
      confirmAction('Substituir as tarefas locais?', `A importação substituirá as tarefas atuais por ${incoming.length} registro(s) do arquivo. O histórico anterior será apagado.`, 'Substituir tarefas', () => {
        const next = withActivity({ ...state(), tasks: incoming, activity: [] }, 'imported', `${incoming.length} tarefa(s)`);
        const saved = commit(next, 'Backup importado.', { replace: true });
        if (saved) clearUndo();
        return saved;
      }, importDialog);
    } else {
      const items = mergeTasks(tasks(), incoming);
      if (changeTasks(items, 'imported', `${incoming.length} tarefa(s)`, 'Backup mesclado.')) importDialog.close();
      else importFeedback.textContent = 'A importação não foi gravada. Verifique o aviso do armazenamento.';
    }
  } catch (error) {
    if (revision === importRevision && importDialog.open) {
      importFeedback.textContent = error.message;
      notify('Falha na importação.', true);
    }
  } finally {
    if (revision === importRevision) importSubmit.disabled = false;
  }
});

window.addEventListener('hashchange', () => route(true));
function refreshDay() {
  const day = localDay();
  if (day === currentDay) return;
  currentDay = day;
  refresh();
}
document.addEventListener('visibilitychange', refreshDay);
setInterval(refreshDay, 60_000);
route();
