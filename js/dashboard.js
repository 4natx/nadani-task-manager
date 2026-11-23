import { $, element, icon, svgElement } from './dom.js';
import { priorities, priorityKeys, statusKeys, statuses, summarize } from './task.js';

const metricDefinitions = [
  ['Total de tarefas', 'list', 'all'],
  ['Pendentes', 'circle', 'todo'],
  ['Em andamento', 'progress', 'progress'],
  ['Concluídas', 'completed', 'done'],
  ['Atrasadas', 'clock', 'late'],
  ['Conclusão', 'chart', 'all'],
];

function renderMetrics(data) {
  const values = [data.total, data.status.todo, data.status.in_progress, data.status.done, data.overdue, `${data.percent}%`];
  $('#metrics').replaceChildren(...metricDefinitions.map(([label, symbol, tone], index) => {
    const card = element('div', 'panel metric');
    const heading = element('div', 'metric-heading');
    const tile = element('div', `metric-icon tone-${tone}`);
    tile.append(icon(symbol));
    heading.append(tile, element('span', '', label));
    card.append(heading, element('strong', '', values[index]));
    return card;
  }));
}

function renderStatus(data) {
  const ring = element('div', 'ring');
  const svg = svgElement('svg', { viewBox: '0 0 120 120', 'aria-hidden': 'true' });
  const circle = { cx: 60, cy: 60, r: 48, fill: 'none', 'stroke-width': 12, pathLength: 100 };
  svg.append(svgElement('circle', { ...circle, stroke: 'var(--track)' }));
  const legend = element('ul', 'chart-legend');
  let offset = 0;
  for (const status of statusKeys) {
    const count = data.status[status];
    const { label, color } = statuses[status];
    if (count) {
      const share = count / data.total * 100;
      const gap = Math.min(1.3, share * .3);
      const length = count === data.total ? 100 : share - gap;
      svg.append(svgElement('circle', { ...circle, stroke: color, transform: 'rotate(-90 60 60)', 'stroke-dasharray': `${length} ${100 - length}`, 'stroke-dashoffset': -offset }));
      offset += share;
    }
    const item = element('li');
    item.append(element('span', `dot dot-${status}`), element('span', '', label), element('strong', '', count));
    legend.append(item);
  }
  const center = element('div', 'ring-center');
  center.append(element('strong', '', data.total), element('span', '', data.total === 1 ? 'tarefa' : 'tarefas'));
  ring.append(svg, center);
  $('#status-chart').replaceChildren(ring, legend);
}

function renderPriorities(data) {
  const max = Math.max(1, ...Object.values(data.priority));
  $('#priority-chart').replaceChildren(...[...priorityKeys].reverse().map(priority => {
    const row = element('div', 'priority-row');
    const track = element('span', 'bar-track');
    track.setAttribute('aria-hidden', 'true');
    const bar = element('span', `priority-bar priority-${priority}`);
    bar.style.width = `${data.priority[priority] / max * 100}%`;
    track.append(bar);
    row.append(element('span', '', priorities[priority].label), track, element('strong', '', data.priority[priority]));
    return row;
  }));
}

const activityLabels = {
  created: ['Tarefa criada', 'plus'], edited: ['Tarefa editada', 'edit'], moved: ['Status alterado', 'move'],
  reordered: ['Ordem atualizada', 'list'], completed: ['Tarefa concluída', 'check'],
  deleted: ['Tarefa excluída', 'trash'], restored: ['Tarefa restaurada', 'circle'],
  imported: ['Importação de tarefas', 'upload'], demo: ['Exemplos carregados', 'spark'],
};
const activityDate = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

function renderActivity(activity) {
  const items = activity.slice(0, 6).map(({ type, label, when }) => {
    const [title, symbol] = activityLabels[type];
    const item = element('li', 'activity-item');
    const badge = element('span', 'activity-icon');
    badge.append(icon(symbol));
    const text = element('div', 'activity-copy');
    text.append(element('strong', '', title), element('span', '', label));
    const time = element('time', '', activityDate.format(new Date(when)));
    time.dateTime = when;
    item.append(badge, text, time);
    return item;
  });
  $('#activity-list').replaceChildren(...(items.length ? items : [element('li', 'activity-empty', 'O histórico aparece conforme você cria e organiza suas tarefas.')]));
}

export function renderDashboard({ tasks, activity }) {
  const data = summarize(tasks);
  $('#welcome').hidden = data.total > 0;
  renderMetrics(data);
  renderStatus(data);
  renderPriorities(data);
  renderActivity(activity);
}
