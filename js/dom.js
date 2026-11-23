export const $ = selector => document.querySelector(selector);

export function element(tag, className = '', text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function svgElement(tag, attributes) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

export function icon(name) {
  const svg = svgElement('svg', { class: 'icon', 'aria-hidden': 'true', focusable: 'false' });
  svg.append(svgElement('use', { href: `./assets/icons/ui.svg#${name}` }));
  return svg;
}

export function action(text, name, { className = 'button secondary', symbol, label, id, status } = {}) {
  const button = element('button', className);
  button.type = 'button';
  button.dataset.action = name;
  if (id) button.dataset.id = id;
  if (status) button.dataset.status = status;
  if (label) button.setAttribute('aria-label', label);
  if (symbol) button.append(icon(symbol));
  if (text) button.append(text);
  return button;
}
