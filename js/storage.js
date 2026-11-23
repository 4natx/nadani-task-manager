import { limits, normalizeOrder, parseTask } from './task.js';

export const key = 'nadani-task-manager:v1';
export const version = 1;
export const eventTypes = ['created', 'edited', 'moved', 'reordered', 'completed', 'deleted', 'restored', 'imported', 'demo'];
const themes = ['system', 'light', 'dark'];
const views = ['dashboard', 'board', 'list'];
const fresh = () => ({ version, tasks: [], activity: [], preferences: { theme: 'system', view: 'dashboard' } });

function isEvent(event) {
  return event && eventTypes.includes(event.type) && typeof event.label === 'string' &&
    event.label.length <= limits.title && typeof event.when === 'string' &&
    event.when.length <= 32 && !Number.isNaN(Date.parse(event.when));
}

export function readSnapshot(raw) {
  if (raw === null) return { raw, data: fresh(), issue: '' };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { raw, data: fresh(), issue: 'O armazenamento contém JSON inválido.' };
  }
  if (parsed?.version !== version || !Array.isArray(parsed.tasks)) {
    return { raw, data: fresh(), issue: 'O formato ou a versão do armazenamento não é compatível.' };
  }
  const ids = new Set();
  const tasks = [];
  for (const record of parsed.tasks) {
    const task = parseTask(record);
    if (!task || ids.has(task.id) || tasks.length >= limits.tasks) continue;
    ids.add(task.id);
    tasks.push(task);
  }

  const activity = Array.isArray(parsed.activity) ? parsed.activity.filter(isEvent).slice(0, limits.activity).map(({ type, label, when }) => ({ type, label, when })) : [];
  const input = parsed.preferences;
  const preferences = {
    theme: themes.includes(input?.theme) ? input.theme : 'system',
    view: views.includes(input?.view) ? input.view : 'dashboard',
  };
  const damaged = tasks.length !== parsed.tasks.length || !Array.isArray(parsed.activity) || parsed.activity.length !== activity.length ||
    input?.theme !== preferences.theme || input?.view !== preferences.view;
  return {
    raw,
    data: { version, tasks: normalizeOrder(tasks), activity, preferences },
    issue: damaged ? 'Parte dos dados locais está inconsistente. Os registros válidos foram recuperados.' : '',
  };
}

export function createStorage(getArea = () => localStorage) {
  let snapshot;
  function load() {
    try {
      snapshot = readSnapshot(getArea().getItem(key));
    } catch {
      snapshot = { raw: null, data: fresh(), issue: 'O navegador bloqueou a leitura do armazenamento local.', unavailable: true };
    }
    return snapshot;
  }

  function save(data, { replace = false } = {}) {
    if (!snapshot || snapshot.unavailable) throw new Error('O armazenamento está indisponível. Reabra a página para tentar novamente.');
    if (snapshot.issue && !replace) throw new Error('Recupere ou substitua os dados locais antes de gravar.');
    try {
      const area = getArea();
      if (area.getItem(key) !== snapshot.raw) throw new Error('changed');
      const raw = JSON.stringify(data);
      area.setItem(key, raw);
      snapshot = { raw, data, issue: '' };
      return snapshot;
    } catch (error) {
      if (error.message === 'changed') throw new Error('Outra aba alterou os dados. Recarregue a página antes de gravar.');
      throw new Error('Falha ao salvar. Verifique as permissões ou o espaço do navegador. Os dados anteriores foram preservados.');
    }
  }

  return { load, save };
}

export function withActivity(data, type, label, now = new Date()) {
  return { ...data, activity: [{ type, label, when: now.toISOString() }, ...data.activity].slice(0, limits.activity) };
}
