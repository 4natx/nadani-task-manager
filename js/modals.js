import { $, action, element } from './dom.js';
import { dateLabel, ordered, statusKeys, statuses, validateFields } from './task.js';
import { priorityBadge, tagsList } from './views.js';

const openers = new WeakMap();
function restoreFocus(opener) {
  if (document.querySelector('dialog[open]')) return;
  if (opener?.isConnected && !opener.closest('[hidden]') && !opener.disabled) {
    opener.focus();
    return;
  }
  const replacement = opener?.dataset.id && [...document.querySelectorAll('#task-results [data-id]')].find(button =>
    button.dataset.id === opener.dataset.id && button.dataset.action === opener.dataset.action);
  const undo = opener?.dataset.id && !$('#undo-toast').hidden ? $('#undo-delete') : null;
  (replacement || undo || $('#create-task')).focus({ preventScroll: true });
}

for (const dialog of document.querySelectorAll('dialog')) {
  dialog.addEventListener('click', event => {
    if (event.target.closest('[data-close]')) dialog.close();
  });
  dialog.addEventListener('close', () => restoreFocus(openers.get(dialog)));
}

export function showDialog(dialog, opener = document.activeElement, focus) {
  openers.set(dialog, opener);
  dialog.showModal();
  focus?.focus();
}

export function replaceDialog(current, next, focus) {
  const opener = openers.get(current);
  current.close();
  showDialog(next, opener, focus);
}

const confirmation = $('#confirm');
let confirmCallback;
export function confirmAction(title, message, label, callback, from) {
  $('#confirm-title').textContent = title;
  $('#confirm-message').textContent = message;
  $('#confirm-action').textContent = label;
  confirmCallback = callback;
  if (from) replaceDialog(from, confirmation);
  else showDialog(confirmation);
}
$('#confirm-action').addEventListener('click', () => {
  if (!confirmation.open) return;
  if (confirmCallback?.() !== false) confirmation.close();
});

export function createTaskDialogs({ getTasks, getCategories, save, notify, move, remove }) {
  const editor = $('#editor');
  const details = $('#details');
  const form = $('#task-form');
  let editingId;
  let detailId;

  function showError(key, error = '') {
    const input = form.elements.namedItem(key);
    const message = $('#error-' + key);
    message.textContent = error;
    message.hidden = !error;
    if (error) {
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', message.id);
    } else {
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
    }
  }

  function showEditor(task, status = 'todo', from) {
    editingId = task?.id;
    form.reset();
    const values = task ?? { status, priority: 'medium' };
    for (const key of ['title', 'description', 'status', 'priority', 'dueDate', 'category', 'tags']) {
      const value = values[key];
      if (value !== undefined) form.elements.namedItem(key).value = Array.isArray(value) ? value.join(', ') : value;
      showError(key);
    }
    $('#editor-title').textContent = task ? 'Editar tarefa' : 'Nova tarefa';
    $('#category-suggestions').replaceChildren(...getCategories().map(value => {
      const option = element('option');
      option.value = value;
      return option;
    }));
    if (from) replaceDialog(from, editor, $('#task-title'));
    else showDialog(editor, document.activeElement, $('#task-title'));
  }

  form.addEventListener('input', event => {
    if (event.target.hasAttribute('aria-invalid')) showError(event.target.name);
  });

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!editor.open) return;
    const raw = Object.fromEntries(new FormData(form));
    const { values, errors } = validateFields(raw);
    if (form.elements.dueDate.validity.badInput) errors.dueDate = 'Informe uma data válida.';
    for (const key of Object.keys(values)) showError(key, errors[key]);
    const firstError = Object.keys(errors)[0];
    if (firstError) {
      notify('Revise os campos indicados.', true);
      form.elements.namedItem(firstError).focus();
      return;
    }
    if (save(editingId, values)) editor.close();
  });

  function fillDetails(task) {
    detailId = task.id;
    $('#details-title').textContent = task.title;
    const body = $('#details-body');
    const metadata = element('dl', 'task-meta');
    for (const [label, value] of [['Prioridade', priorityBadge(task.priority)], ['Vencimento', dateLabel(task.dueDate)], ['Categoria', task.category || 'Sem categoria']]) {
      const row = element('div');
      row.append(element('dt', '', label));
      const description = element('dd');
      description.append(value);
      row.append(description);
      metadata.append(row);
    }
    const position = element('div', 'detail-move');
    const status = element('label', '', 'Status');
    const select = element('select');
    select.id = 'detail-status';
    for (const key of statusKeys) {
      const option = element('option', '', key === 'done' ? 'Concluída' : statuses[key].label);
      option.value = key;
      select.append(option);
    }
    select.value = task.status;
    status.append(select);
    const column = ordered(getTasks(), task.status);
    const index = column.findIndex(item => item.id === task.id);
    const controls = element('div', 'detail-order');
    controls.append(element('p', '', `Posição na coluna: ${index + 1} de ${column.length}`));
    const buttons = element('div', 'actions');
    for (const [direction, label, enabled] of [['up', 'Subir', index > 0], ['down', 'Descer', index < column.length - 1]]) {
      const button = action(label, 'reorder');
      button.dataset.direction = direction;
      button.disabled = !enabled;
      buttons.append(button);
    }
    controls.append(buttons);
    position.append(status, controls);
    body.replaceChildren(element('p', 'task-description', task.description || 'Sem descrição.'), metadata);
    if (task.tags.length) body.append(tagsList(task.tags));
    body.append(position);
  }

  function showDetails(task) {
    fillDetails(task);
    showDialog(details, document.activeElement, $('#details-title'));
  }

  details.addEventListener('change', event => {
    if (event.target.id !== 'detail-status') return;
    const task = getTasks().find(item => item.id === detailId);
    if (!task) return;
    move(task.id, event.target.value);
    fillDetails(getTasks().find(item => item.id === task.id));
    $('#detail-status').focus();
  });

  details.addEventListener('click', event => {
    const button = event.target.closest('[data-action="reorder"]');
    if (!button) return;
    const task = getTasks().find(item => item.id === detailId);
    if (!task) return;
    const column = ordered(getTasks(), task.status);
    const index = column.findIndex(item => item.id === task.id);
    const up = button.dataset.direction === 'up';
    if ((up && index < 1) || (!up && index >= column.length - 1)) return;
    move(task.id, task.status, column[index + (up ? -1 : 2)]?.id ?? null);
    fillDetails(getTasks().find(item => item.id === task.id));
    const next = details.querySelector(`[data-direction="${button.dataset.direction}"]:enabled`);
    (next ?? details.querySelector('[data-action="reorder"]:enabled') ?? $('#detail-status')).focus();
  });

  $('#details-edit').addEventListener('click', () => {
    const task = getTasks().find(item => item.id === detailId);
    if (task) showEditor(task, undefined, details);
  });
  $('#details-delete').addEventListener('click', () => {
    const task = getTasks().find(item => item.id === detailId);
    if (task) remove(task, details);
  });

  return { showEditor, showDetails };
}
