import { limits, normalizeOrder, ordered, parseTask, statusKeys } from './task.js';
import { version } from './storage.js';

export const maxImportBytes = 8 * 1024 * 1024;

export function backupJSON(tasks) {
  return JSON.stringify({ version, tasks }, null, 2);
}

export function parseBackup(raw) {
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    throw new Error('O arquivo não contém JSON válido.');
  }
  if (input?.version !== version) throw new Error('A versão do backup não é compatível.');
  if (!Array.isArray(input.tasks) || input.tasks.length > limits.tasks) {
    throw new Error(`O backup deve conter uma lista de até ${limits.tasks} tarefas.`);
  }
  const ids = new Set();
  const tasks = input.tasks.map((rawTask, index) => {
    const task = parseTask(rawTask);
    if (!task) throw new Error(`Registro de tarefa inválido na posição ${index + 1}.`);
    if (ids.has(task.id)) throw new Error('O backup contém identificadores duplicados.');
    ids.add(task.id);
    return task;
  });
  return normalizeOrder(tasks);
}

export function mergeTasks(current, incoming, makeId = () => crypto.randomUUID()) {
  if (current.length + incoming.length > limits.tasks) throw new Error(`A mesclagem ultrapassa o limite de ${limits.tasks} tarefas.`);
  const used = new Set(current.map(task => task.id));
  const reserved = new Set([...used, ...incoming.map(task => task.id)]);
  const added = incoming.map(task => {
    if (!used.has(task.id)) {
      used.add(task.id);
      return task;
    }
    let id;
    do { id = makeId(); } while (reserved.has(id));
    reserved.add(id);
    used.add(id);
    return { ...task, id };
  });
  return statusKeys.flatMap(status => [...ordered(current, status), ...ordered(added, status)].map((task, order) => ({ ...task, order })));
}

function csvCell(value) {
  const text = String(value ?? '');
  const potentiallyExecutable = /^[\s\u0000-\u001f\u007f\u200b\u200e\u200f]*[=+@\-＝＋＠－]|^[\t\r\n]/u.test(text);
  const safe = potentiallyExecutable ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}

export function exportCSV(tasks) {
  const columns = ['id', 'title', 'description', 'status', 'priority', 'dueDate', 'category', 'tags', 'order', 'createdAt', 'updatedAt', 'completedAt'];
  const rows = tasks.map(task => columns.map(key => Array.isArray(task[key]) ? task[key].join(', ') : task[key]));
  return '\uFEFF' + [columns, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
}

export function downloadFile(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
