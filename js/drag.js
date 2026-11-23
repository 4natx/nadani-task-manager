import { element } from './dom.js';

export function setupDrag(region, onMove, announce) {
  let drag;
  let suppressClick = false;
  let frame = 0;

  function clearTarget() {
    drag?.column?.classList.remove('drop-active');
    drag?.marker?.classList.remove('drop-before');
  }

  function findTarget(x, y) {
    const column = document.elementFromPoint(x, y)?.closest('[data-column]');
    const next = column && region.contains(column) ? column : null;
    const before = next && [...next.querySelectorAll('[data-card]')].find(card => {
      const bounds = card.getBoundingClientRect();
      return card.dataset.card !== drag.id && y < bounds.top + bounds.height / 2;
    });
    if (drag.column !== next || drag.marker !== before) {
      clearTarget();
      next?.classList.add('drop-active');
      before?.classList.add('drop-before');
      drag.column = next;
      drag.marker = before;
    }
    return next ? { status: next.dataset.column, beforeId: before?.dataset.card ?? null } : null;
  }

  function autoScroll() {
    frame = 0;
    if (!drag?.active) return;
    const { x, y } = drag.point;
    const nav = document.querySelector('.sidebar').getBoundingClientRect();
    const footerTop = nav.width >= innerWidth - 1 ? nav.top : innerHeight;
    const speed = y > footerTop - 65 ? 11 : y < 115 ? -11 : 0;
    if (!speed) return;
    const previous = scrollY;
    window.scrollBy(0, speed);
    if (scrollY === previous) return;
    findTarget(x, y);
    frame = requestAnimationFrame(autoScroll);
  }

  function end(event, allowDrop = false) {
    if (!drag || (event && 'pointerId' in event && event.pointerId !== drag.pointerId)) return;
    const { handle, pointerId, id, active, ghost } = drag;
    const target = allowDrop && active ? findTarget(event.clientX, event.clientY) : null;
    clearTarget();
    drag = null;
    cancelAnimationFrame(frame);
    frame = 0;
    ghost?.remove();
    handle.closest('[data-card]')?.classList.remove('is-dragging');
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    if (!active) return;
    document.body.classList.remove('dragging');
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    if (target) onMove(id, target.status, target.beforeId);
    else announce('Movimentação cancelada.');
  }

  region.addEventListener('pointerdown', event => {
    const handle = event.target.closest('.drag-handle');
    if (!handle || drag || !event.isPrimary || event.button !== 0) return;
    const point = { x: event.clientX, y: event.clientY };
    drag = { handle, id: handle.dataset.id, pointerId: event.pointerId, point };
    handle.setPointerCapture(event.pointerId);
  });

  region.addEventListener('pointermove', event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const { clientX: x, clientY: y } = event;
    if (!drag.active) {
      if (Math.hypot(x - drag.point.x, y - drag.point.y) < 7) return;
      const card = drag.handle.closest('[data-card]');
      const ghost = element('div', 'drag-ghost', card.querySelector('h3').textContent);
      ghost.setAttribute('aria-hidden', 'true');
      document.body.append(ghost);
      drag.active = true;
      drag.ghost = ghost;
      card.classList.add('is-dragging');
      document.body.classList.add('dragging');
    }
    drag.point = { x, y };
    findTarget(x, y);
    drag.ghost.style.transform = `translate(${Math.max(5, Math.min(x + 12, innerWidth - 195))}px, ${Math.max(5, Math.min(y + 12, innerHeight - 72))}px)`;
    if (!frame) frame = requestAnimationFrame(autoScroll);
  });
  region.addEventListener('pointerup', event => end(event, true));
  region.addEventListener('pointercancel', end);
  region.addEventListener('lostpointercapture', end);
  region.addEventListener('click', event => {
    if (suppressClick) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && drag) end();
  });
  return () => end();
}
