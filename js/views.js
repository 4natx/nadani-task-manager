import { action, element, icon } from './dom.js';
import { dateLabel, isOverdue, ordered, priorities, statusKeys, statuses } from './task.js';

export function statusBadge(status) {
  const badge = element('span', 'status-badge');
  badge.append(element('span', `dot dot-${status}`), status === 'done' ? 'Concluída' : statuses[status].label);
  return badge;
}

export function priorityBadge(priority) {
  return element('span', `priority-badge priority-${priority}`, priorities[priority].label);
}

export function tagsList(tags) {
  const list = element('ul', 'tags');
  list.setAttribute('aria-label', 'Etiquetas');
  list.append(...tags.map(tag => element('li', '', tag)));
  return list;
}

function dueLabel(task) {
  if (!task.dueDate) return element('span', 'no-date', 'Sem data');
  const time = element('time', isOverdue(task) ? 'due late-text' : 'due');
  time.dateTime = task.dueDate;
  time.append(icon('calendar'), dateLabel(task.dueDate));
  if (isOverdue(task)) time.append(element('span', 'sr-only', ' (atrasada)'));
  return time;
}

function card(task) {
  const node = element('article', 'task-card');
  node.dataset.card = task.id;
  const top = element('div', 'card-top');
  top.append(priorityBadge(task.priority), action('', 'details', {
    className: 'icon-button drag-handle', symbol: 'grip', id: task.id,
    label: `Mover ou reordenar: ${task.title}`,
  }));
  const heading = element('h3');
  heading.append(action(task.title, 'details', { className: 'task-link', id: task.id }));
  node.append(top, heading);
  if (task.description) node.append(element('p', 'card-description', task.description));
  if (task.tags.length) node.append(tagsList(task.tags));
  const foot = element('div', 'card-foot');
  const date = dueLabel(task);
  if (isOverdue(task)) {
    const due = element('div', 'late-stack');
    due.append(date, element('span', 'late-chip', 'Atrasada'));
    foot.append(due);
  } else {
    foot.append(date);
  }
  foot.append(action('', 'toggle-done', {
    className: `icon-button complete-button ${task.status === 'done' ? 'is-done' : ''}`,
    symbol: task.status === 'done' ? 'check' : 'circle', id: task.id,
    label: (task.status === 'done' ? 'Reabrir: ' : 'Concluir: ') + task.title,
  }));
  node.append(foot);
  return node;
}

export function kanban(tasks) {
  const board = element('div', 'kanban');
  for (const status of statusKeys) {
    const column = element('section', 'column');
    const headingId = 'column-' + status;
    column.dataset.column = status;
    column.setAttribute('aria-labelledby', headingId);
    const header = element('header', 'column-header');
    const title = element('h2', '', statuses[status].label);
    title.id = headingId;
    const items = ordered(tasks, status);
    header.append(element('span', `dot dot-${status}`), title, element('span', 'column-count', items.length),
      action('', 'add', { className: 'icon-button', symbol: 'plus', status, label: `Adicionar tarefa em ${statuses[status].label}` }));
    const itemsRegion = element('div', 'column-items');
    itemsRegion.append(...items.map(card));
    if (!items.length) itemsRegion.append(element('p', 'column-empty', 'Nenhuma tarefa nesta coluna.'));
    column.append(header, itemsRegion);
    board.append(column);
  }
  return board;
}

export function taskList(tasks) {
  const container = element('div', 'panel table-panel');
  const table = element('table', 'task-table');
  table.setAttribute('role', 'table');
  table.setAttribute('aria-label', 'Lista de tarefas');
  const headings = ['Tarefa', 'Status', 'Prioridade', 'Categoria', 'Vencimento', 'Ações'];
  const top = element('thead');
  top.setAttribute('role', 'rowgroup');
  const headRow = element('tr');
  headRow.setAttribute('role', 'row');
  headRow.append(...headings.map(label => {
    const header = element('th', '', label);
    header.scope = 'col';
    header.setAttribute('role', 'columnheader');
    return header;
  }));
  top.append(headRow);
  const body = element('tbody');
  body.setAttribute('role', 'rowgroup');
  for (const task of tasks) {
    const row = element('tr');
    const rowHeading = element('th');
    row.setAttribute('role', 'row');
    rowHeading.scope = 'row';
    rowHeading.setAttribute('role', 'rowheader');
    rowHeading.append(action(task.title, 'details', { className: 'task-link', id: task.id }));
    const controls = element('div', 'list-actions');
    controls.append(
      action('', 'edit', { className: 'icon-button', symbol: 'edit', id: task.id, label: `Editar: ${task.title}` }),
      action('', 'delete', { className: 'icon-button danger-icon', symbol: 'trash', id: task.id, label: `Excluir: ${task.title}` }),
    );
    const values = [statusBadge(task.status), priorityBadge(task.priority), task.category || '—', dueLabel(task), controls];
    row.append(rowHeading, ...values.map((value, index) => {
      const cell = element('td');
      cell.setAttribute('role', 'cell');
      const label = element('span', 'mobile-cell-label', headings[index + 1]);
      label.setAttribute('aria-hidden', 'true');
      cell.append(label, value);
      return cell;
    }));
    body.append(row);
  }
  table.append(top, body);
  container.append(table);
  return container;
}
