export const statuses = {
  todo: { label: 'A fazer', color: 'var(--todo)' },
  in_progress: { label: 'Em andamento', color: 'var(--progress)' },
  done: { label: 'Concluídas', color: 'var(--done)' },
};
export const priorities = {
  low: { label: 'Baixa', rank: 0 },
  medium: { label: 'Média', rank: 1 },
  high: { label: 'Alta', rank: 2 },
  urgent: { label: 'Urgente', rank: 3 },
};
export const limits = { title: 100, description: 700, category: 40, tag: 24, tags: 8, tasks: 2000, activity: 35 };
export const statusKeys = Object.keys(statuses);
export const priorityKeys = Object.keys(priorities);

export function calendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(+date) && date.toISOString().slice(0, 10) === value;
}

export function localDay(date = new Date()) {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function dateLabel(date) {
  return date ? date.split('-').reverse().join('/') : 'Sem vencimento';
}

export function isOverdue(task, day = localDay()) {
  return Boolean(task.dueDate && task.dueDate < day && task.status !== 'done');
}

const clean = value => typeof value === 'string' ? value.trim() : '';
export function validateFields(raw) {
  const title = clean(raw.title);
  const description = clean(raw.description);
  const category = clean(raw.category);
  const dueDate = clean(raw.dueDate);
  const tags = Array.isArray(raw.tags) ? raw.tags.map(clean).filter(Boolean) : clean(raw.tags).split(',').map(clean).filter(Boolean);
  const uniqueTags = [...new Set(tags)];
  const { status, priority } = raw;
  const errors = {};
  if (!title || title.length > limits.title) errors.title = `Informe um título com até ${limits.title} caracteres.`;
  if (description.length > limits.description) errors.description = `Use até ${limits.description} caracteres na descrição.`;
  if (category.length > limits.category) errors.category = `Use até ${limits.category} caracteres na categoria.`;
  if (!statusKeys.includes(status)) errors.status = 'Escolha um status válido.';
  if (!priorityKeys.includes(priority)) errors.priority = 'Escolha uma prioridade válida.';
  if (dueDate && !calendarDate(dueDate)) errors.dueDate = 'Informe uma data válida.';
  if (uniqueTags.length > limits.tags || uniqueTags.some(tag => tag.length > limits.tag || tag.includes(','))) {
    errors.tags = `Use até ${limits.tags} etiquetas de ${limits.tag} caracteres cada.`;
  }
  return { values: { title, description, status, priority, dueDate, category, tags: uniqueTags }, errors };
}

function isTimestamp(value) {
  if (typeof value !== 'string') return false;
  const time = new Date(value);
  return !Number.isNaN(+time) && time.toISOString() === value;
}

export function parseTask(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const strings = ['id', 'title', 'description', 'dueDate', 'category'];
  if (strings.some(key => typeof raw[key] !== 'string') || !/^[\w-]{1,100}$/.test(raw.id) ||
      !Array.isArray(raw.tags) || raw.tags.some(tag => typeof tag !== 'string') ||
      !Number.isSafeInteger(raw.order) || raw.order < 0 || raw.order > 1_000_000 ||
      !isTimestamp(raw.createdAt) || !isTimestamp(raw.updatedAt) || raw.updatedAt < raw.createdAt ||
      (raw.status === 'done' ? !isTimestamp(raw.completedAt) || raw.completedAt < raw.createdAt || raw.completedAt > raw.updatedAt : raw.completedAt !== null)) return null;
  const { values, errors } = validateFields(raw);
  if (Object.keys(errors).length) return null;
  const { id, order, createdAt, updatedAt, completedAt } = raw;
  return { id, ...values, order, createdAt, updatedAt, completedAt };
}

export function ordered(tasks, status) {
  return tasks.filter(task => task.status === status).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

function withOrder(tasks) {
  return tasks.map((task, order) => task.order === order ? task : { ...task, order });
}

export function normalizeOrder(tasks) {
  return statusKeys.flatMap(status => withOrder(ordered(tasks, status)));
}

function clock(previous = '', now = new Date()) {
  return [now.toISOString(), previous].sort().at(-1);
}

function valuesOrThrow(input) {
  const { values, errors } = validateFields(input);
  if (Object.keys(errors).length) throw new Error(Object.values(errors)[0]);
  return values;
}

export function createTask(tasks, input, id = crypto.randomUUID(), now = new Date()) {
  if (tasks.length >= limits.tasks) throw new Error(`Limite de ${limits.tasks} tarefas atingido.`);
  if (tasks.some(task => task.id === id)) throw new Error('Já existe uma tarefa com este identificador.');
  const values = valuesOrThrow(input);
  const time = clock('', now);
  const order = ordered(tasks, values.status).at(-1)?.order ?? -1;
  return { id, ...values, order: order + 1, createdAt: time, updatedAt: time, completedAt: values.status === 'done' ? time : null };
}

export function moveTask(tasks, id, status, beforeId = null, now = new Date()) {
  const task = tasks.find(item => item.id === id);
  if (!task || !statusKeys.includes(status) || beforeId === id) return tasks;
  const destination = ordered(tasks, status).filter(item => item.id !== id);
  const index = beforeId === null ? destination.length : destination.findIndex(item => item.id === beforeId);
  if (index < 0) return tasks;
  const sameColumn = task.status === status;
  if (sameColumn && ordered(tasks, status).findIndex(item => item.id === id) === index) return tasks;
  const time = clock(task.updatedAt, now);
  const completedAt = status === 'done' ? task.completedAt ?? time : null;
  destination.splice(index, 0, { ...task, status, updatedAt: time, completedAt });
  const otherTasks = tasks.filter(item => item.status !== status && item.id !== id);
  return [...otherTasks, ...withOrder(destination)];
}

export function editTask(tasks, id, input, now = new Date()) {
  const task = tasks.find(item => item.id === id);
  if (!task) return tasks;
  const values = valuesOrThrow(input);
  const changed = Object.entries(values).some(([key, value]) => key === 'tags' ?
    value.length !== task.tags.length || value.some((tag, index) => tag !== task.tags[index]) : task[key] !== value);
  if (!changed) return tasks;
  const moved = task.status === values.status ? tasks : moveTask(tasks, id, values.status, null, now);
  return moved.map(item => item.id === id ? { ...item, ...values, updatedAt: clock(item.updatedAt, now) } : item);
}

export function deleteTask(tasks, id) {
  return tasks.some(task => task.id === id) ? tasks.filter(task => task.id !== id) : tasks;
}

export function restoreTask(tasks, task, beforeId) {
  if (tasks.some(item => item.id === task.id) || tasks.length >= limits.tasks) {
    throw new Error('Não foi possível restaurar a tarefa.');
  }
  const column = ordered(tasks, task.status);
  const index = column.findIndex(item => item.id === beforeId);
  column.splice(index < 0 ? column.length : index, 0, task);
  return [...tasks.filter(item => item.status !== task.status), ...withOrder(column)];
}

const fold = value => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR');
export function filterTasks(tasks, filters, day = localDay()) {
  const terms = fold(filters.query ?? '').trim().split(/\s+/).filter(Boolean);
  return tasks.filter(task => {
    if (filters.status && task.status !== filters.status) return false;
    if (filters.priority && task.priority !== filters.priority) return false;
    if (filters.category && task.category !== filters.category) return false;
    if (filters.overdue && !isOverdue(task, day)) return false;
    if (filters.done && task.status !== 'done') return false;
    if (!terms.length) return true;
    const searchable = fold([task.title, task.description, task.category, ...task.tags].join(' '));
    return terms.every(term => searchable.includes(term));
  });
}

const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });
const comparators = {
  created: (a, b) => b.createdAt.localeCompare(a.createdAt),
  due: (a, b) => (a.dueDate || '9999-99-99').localeCompare(b.dueDate || '9999-99-99'),
  priority: (a, b) => priorities[b.priority].rank - priorities[a.priority].rank,
  status: (a, b) => statusKeys.indexOf(a.status) - statusKeys.indexOf(b.status),
  title: (a, b) => collator.compare(a.title, b.title),
};
export function sortTasks(tasks, sort) {
  const compare = comparators[sort] ?? comparators.created;
  return [...tasks].sort((a, b) => compare(a, b) || a.id.localeCompare(b.id));
}

export function summarize(tasks, day = localDay()) {
  const status = Object.fromEntries(statusKeys.map(key => [key, 0]));
  const priority = Object.fromEntries(priorityKeys.map(key => [key, 0]));
  let overdue = 0;
  for (const task of tasks) {
    status[task.status]++;
    priority[task.priority]++;
    if (isOverdue(task, day)) overdue++;
  }
  return { total: tasks.length, status, priority, overdue, percent: tasks.length ? Math.round(status.done / tasks.length * 100) : 0 };
}
