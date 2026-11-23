import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTask, deleteTask, editTask, filterTasks, moveTask, ordered, restoreTask, sortTasks, summarize, validateFields } from '../js/task.js';
import { createStorage, key, readSnapshot, withActivity } from '../js/storage.js';
import { backupJSON, exportCSV, mergeTasks, parseBackup } from '../js/transfer.js';
import { makeDemo } from '../js/demo.js';

const now = new Date('2026-11-23T14:32:00.000Z');
const later = new Date('2026-11-24T14:32:00.000Z');
const base = { title: ' Revisar formulário ', description: 'Testar responsividade', status: 'todo', priority: 'medium', dueDate: '2026-11-22', category: 'Qualidade', tags: 'QA, acessível, QA' };
const make = (input = {}, id = 'task-1', list = []) => createTask(list, { ...base, ...input }, id, now);
const newState = readSnapshot(null).data;

test('creates a canonical task and rejects a duplicate identifier', () => {
  const task = make();
  assert.equal(task.title, 'Revisar formulário');
  assert.deepEqual(task.tags, ['QA', 'acessível']);
  assert.equal(task.order, 0);
  assert.equal(task.completedAt, null);
  assert.equal(task.createdAt, now.toISOString());
  assert.throws(() => make({}, task.id, [task]), /identificador/);
  assert.equal(make({ status: 'done' }).completedAt, now.toISOString());
});

test('rejects invalid titles, dates, priorities, status and labels', () => {
  const { errors } = validateFields({ ...base, title: '   ', dueDate: '2026-02-30', priority: 'highish', status: 'other', tags: 'x'.repeat(25) });
  assert.deepEqual(Object.keys(errors), ['title', 'status', 'priority', 'dueDate', 'tags']);
  assert.deepEqual(validateFields({ ...base, dueDate: '2028-02-29' }).errors, {});
  assert.ok(validateFields({ ...base, dueDate: '0000-01-01' }).errors.dueDate);
});

test('edits all fields while preserving creation and completion metadata', () => {
  const task = make();
  const fields = { title: 'Atualizada', description: '', category: 'Novo', priority: 'urgent', tags: ['alfa'], dueDate: '', status: 'done' };
  const [edited] = editTask([task], task.id, fields, later);
  for (const [key, value] of Object.entries(fields)) assert.deepEqual(edited[key], value);
  assert.equal(edited.completedAt, later.toISOString());
  assert.equal(edited.createdAt, now.toISOString());
  assert.equal(edited.updatedAt, later.toISOString());
  const [reopened] = moveTask([edited], task.id, 'todo', null, now);
  assert.equal(reopened.completedAt, null);
  assert.equal(reopened.updatedAt, later.toISOString());
});

test('deletes and restores a task at its original position', () => {
  const first = make({}, 'first');
  const second = make({}, 'second', [first]);
  const deleted = deleteTask([first, second], 'first');
  assert.deepEqual(deleted.map(task => task.id), ['second']);
  assert.deepEqual(ordered(restoreTask(deleted, first, 'second'), 'todo').map(task => task.id), ['first', 'second']);
  assert.throws(() => restoreTask(deleted, second, null), /restaurar/);
});

test('reorders within a column and moves to another with stable order', () => {
  const first = make({}, 'first');
  const second = make({}, 'second', [first]);
  const third = make({ status: 'in_progress' }, 'third');
  const initial = [first, second, third];
  assert.equal(moveTask(initial, 'first', 'todo', 'second'), initial);
  assert.equal(moveTask(initial, 'first', 'todo', 'invalid'), initial);
  const reordered = moveTask(initial, 'second', 'todo', 'first');
  assert.deepEqual(ordered(reordered, 'todo').map(task => task.id), ['second', 'first']);
  const moved = moveTask(reordered, 'first', 'in_progress', 'third');
  assert.deepEqual(ordered(moved, 'in_progress').map(task => [task.id, task.order]), [['first', 0], ['third', 1]]);
  assert.deepEqual(ordered(parseBackup(backupJSON(moved)), 'in_progress').map(task => task.id), ['first', 'third']);
});

test('combines accent-insensitive search and structured filters', () => {
  const pending = make();
  const completed = make({ status: 'done' }, 'task-2');
  const tasks = [pending, completed];
  assert.deepEqual(filterTasks(tasks, { query: 'FORMULARIO ACESSIVEL', priority: 'medium', category: 'Qualidade', overdue: true }, '2026-11-23'), [pending]);
  assert.deepEqual(filterTasks(tasks, { query: 'responsividade qualidade', done: true }), [completed]);
  assert.deepEqual(filterTasks(tasks, { status: 'in_progress', done: true }), []);
});

test('calculates all metrics and sorts by list options', () => {
  const pending = make({ title: 'A tarefa' });
  const completed = make({ title: 'Z tarefa', priority: 'urgent', status: 'done', dueDate: '' }, 'task-2');
  const tasks = [completed, pending];
  assert.deepEqual(summarize(tasks, '2026-11-23'), {
    total: 2, status: { todo: 1, in_progress: 0, done: 1 }, priority: { low: 0, medium: 1, high: 0, urgent: 1 }, overdue: 1, percent: 50,
  });
  for (const criterion of ['title', 'due', 'status', 'created']) assert.equal(sortTasks(tasks, criterion)[0], pending);
  assert.equal(sortTasks(tasks, 'priority')[0], completed);
});

test('persists tasks and enforces a bounded activity log', () => {
  const area = new Map();
  const storage = createStorage(() => ({ getItem: item => area.get(item) ?? null, setItem: (item, value) => area.set(item, value) }));
  let data = { ...storage.load().data, tasks: [make()] };
  for (let i = 0; i < 46; i++) data = withActivity(data, 'created', String(i), now);
  storage.save(data);
  const recovered = storage.load();
  assert.equal(recovered.issue, '');
  assert.equal(recovered.data.activity.length, 35);
  assert.equal(recovered.data.activity[0].label, '45');
  assert.deepEqual(recovered.data.tasks, data.tasks);
});

test('preserves malformed snapshots, salvages valid tasks, and requires repair', () => {
  const original = JSON.stringify({ ...newState, tasks: [make(), {}, make()] });
  let raw = original;
  const storage = createStorage(() => ({ getItem: () => raw, setItem: (_, value) => { raw = value; } }));
  const snapshot = storage.load();
  assert.ok(snapshot.issue);
  assert.equal(snapshot.raw, original);
  assert.equal(snapshot.data.tasks.length, 1);
  assert.throws(() => storage.save(snapshot.data), /Recupere/);
  assert.equal(raw, original);
  storage.save(snapshot.data, { replace: true });
  assert.equal(storage.load().issue, '');
  assert.ok(readSnapshot('{invalid').issue);
  assert.ok(readSnapshot('{"version":2,"tasks":[]}').issue);
});

test('fails safely when storage is blocked, full or changed by another tab', () => {
  assert.ok(createStorage(() => { throw new Error('blocked'); }).load().unavailable);
  let raw = null;
  const storage = createStorage(() => ({
    getItem: item => { assert.equal(item, key); return raw; },
    setItem: () => { throw new Error('quota'); },
  }));
  storage.load();
  assert.throws(() => storage.save(newState), /Falha ao salvar/);
  assert.equal(raw, null);
  raw = '{}';
  assert.throws(() => storage.save(newState), /Outra aba/);
});

test('round-trips JSON, rejects malformed backups and resolves merge collisions', () => {
  const task = make({}, 'same');
  assert.deepEqual(parseBackup(backupJSON([task])), [task]);
  for (const [content, reason] of [['NaN', /JSON/], ['{"version":3,"tasks":[]}', /versão/], ['{"version":1,"tasks":[42]}', /Registro/], [backupJSON([task, task]), /duplicados/]]) {
    assert.throws(() => parseBackup(content), reason);
  }
  const reserved = make({}, 'reserved');
  const ids = ['reserved', 'new'];
  const joined = mergeTasks([task], [task, reserved], () => ids.shift());
  assert.equal(new Set(joined.map(item => item.id)).size, 3);
  assert.ok(joined.some(item => item.id === 'new'));
});

test('escapes CSV fields, embedded line breaks and spreadsheet formulas', () => {
  const task = make({ title: '=SUM(1,2)', description: '"texto"\ncom linha', category: '\t@fórmula', tags: '+fórmula' });
  const csv = exportCSV([task]);
  assert.ok(csv.startsWith('\uFEFF"id"'));
  assert.ok(csv.includes('"\'=SUM(1,2)"'));
  assert.ok(csv.includes('"""texto""\ncom linha"'));
  assert.ok(csv.includes('"\'@fórmula"'));
  assert.ok(csv.includes('"\'+fórmula"'));
});

test('builds demo tasks on demand relative to the current day', () => {
  const demo = makeDemo(now);
  assert.equal(demo.length, 8);
  assert.equal(new Set(demo.map(task => task.id)).size, 8);
  assert.equal(summarize(demo, '2026-11-23').overdue, 1);
});
