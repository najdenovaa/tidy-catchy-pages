import { icon } from './icons.js';
import { calloutLayout } from './comment-layout.js';

const svgNode = (name, attributes) => {
  const element = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
};

export class Comments {
  constructor({ layer, panel, container, toggle, getPage, show, revealPage, save, move, remove }) {
    Object.assign(this, { layer, panel, container, toggle, getPage, show, revealPage, save, move, remove });
    this.getNotes = () => this.getPage()?.notes ?? [];
    this.active = null;
    this.draft = null;
    this.visible = false;
    this.layer.addEventListener('click', event => {
      const pin = event.target.closest('[data-pin]');
      if (pin) this.select(Number(pin.dataset.pin));
      const callout = event.target.closest('[data-callout]');
      if (callout && event.detail === 0 && callout.dataset.part === 'bubble') this.select(Number(callout.dataset.callout));
    });
    this.layer.addEventListener('pointerdown', event => this.startMove(event));
    this.layer.addEventListener('pointermove', event => this.updateMove(event));
    this.layer.addEventListener('pointerup', event => this.finishMove(event));
    this.layer.addEventListener('lostpointercapture', event => {
      if (this.drag?.id !== event.pointerId) return;
      this.drag = null;
      this.renderMarkers();
    });
    this.layer.addEventListener('keydown', event => this.moveWithKeys(event));
    this.panel.addEventListener('click', event => this.actions(event));
    this.panel.addEventListener('submit', event => {
      event.preventDefault();
      const text = event.target.elements.note.value.trim();
      if (text) this.commit(text);
    });
    this.panel.addEventListener('input', event => {
      if (this.draft && event.target.name === 'note') this.draft.text = event.target.value;
    });
    this.toggle.addEventListener('click', () => this.visible ? this.hide() : this.open());
  }

  open() {
    this.visible = true;
    this.panel.hidden = false;
    this.container.hidden = true;
    this.toggle.setAttribute('aria-pressed', 'true');
    this.show();
    this.render();
  }

  hide() {
    this.visible = false;
    this.panel.hidden = true;
    this.container.hidden = false;
    this.toggle.setAttribute('aria-pressed', 'false');
    this.active = null;
    this.renderMarkers();
  }

  begin(anchor, boxes) {
    this.active = null;
    this.selection = null;
    this.draft = { anchor, boxes, text: '' };
    this.open();
    this.panel.querySelector('textarea').focus({ preventScroll: true });
  }

  select(index) {
    if (!this.getNotes().some(note => note.index === index)) return;
    this.active = index;
    this.draft = null;
    this.open();
    this.panel.querySelector(`[data-note="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  reset() {
    this.draft = null;
    this.active = null;
    this.selection = null;
    this.drag = null;
    this.render();
  }

  actions(event) {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.note !== undefined) {
      this.select(Number(button.dataset.note));
      return;
    }
    const action = button.dataset.action;
    if (!action) return;
    const note = this.getNotes().find(note => note.index === this.active);
    if (action === 'cancel-note') this.draft = null;
    if (action === 'edit-note' && note) this.draft = { index: note.index, boxes: note.boxes ?? [note.box], text: note.text };
    if (action === 'delete-note' && note && this.remove(note.index)) this.active = null;
    this.render();
    if (action === 'edit-note') this.panel.querySelector('textarea')?.focus({ preventScroll: true });
  }

  commit(text) {
    const draft = this.draft;
    this.draft = null;
    const index = this.save(draft, text);
    if (index === null) this.draft = draft;
    else {
      this.active = index;
      this.revealPage();
    }
    this.render();
  }

  render() {
    if (this.visible) {
      const notes = this.getNotes();
      this.panel.replaceChildren();
      const heading = document.createElement('h2');
      heading.className = 'comments-title';
      heading.textContent = 'Комментарии к странице';
      this.panel.append(heading);
      if (this.draft) this.panel.append(this.composer());
      if (!notes.length && !this.draft) {
        const empty = document.createElement('p');
        empty.className = 'comments-empty';
        empty.textContent = 'Выберите «Комментарий» и протяните по тексту. Щелчок добавит комментарий к слову или объекту.';
        this.panel.append(empty);
      }
      notes.forEach((note, index) => this.panel.append(this.card(note, index + 1)));
    }
    this.renderMarkers();
  }

  composer() {
    const form = document.createElement('form');
    form.className = 'note-composer';
    const caption = document.createElement('p');
    caption.className = 'note-anchor';
    caption.textContent = this.draft.anchor?.label || (this.draft.index !== undefined ? 'Редактирование комментария' : 'Новый комментарий');
    form.append(caption);
    const field = document.createElement('textarea');
    field.name = 'note';
    field.setAttribute('aria-label', 'Текст комментария');
    field.placeholder = 'Напишите комментарий';
    field.maxLength = 3000;
    field.required = true;
    field.value = this.draft.text;
    form.append(field);
    const actions = document.createElement('div');
    actions.className = 'note-actions';
    actions.innerHTML = '<button type="submit" class="button primary">Сохранить</button><button type="button" class="button ghost" data-action="cancel-note">Отмена</button>';
    form.append(actions);
    return form;
  }

  card(note, number) {
    const card = document.createElement('article');
    const active = this.active === note.index;
    card.className = 'note-card' + (active ? ' active' : '');
    const selector = document.createElement('button');
    selector.type = 'button';
    selector.dataset.note = note.index;
    selector.className = 'note-heading';
    selector.setAttribute('aria-pressed', active);
    selector.textContent = number + (note.label ? ' · ' + note.label : ' · Комментарий');
    card.append(selector);
    const content = document.createElement('p');
    content.className = 'note-body';
    content.textContent = note.text;
    card.append(content);
    if (active && !this.draft) {
      const actions = document.createElement('div');
      actions.className = 'note-actions';
      actions.innerHTML = `<button type="button" class="button ghost" data-action="edit-note">Изменить</button>
        <button type="button" class="icon-button danger-icon" data-action="delete-note" aria-label="Удалить комментарий">${icon('trash')}</button>`;
      card.append(actions);
    }
    return card;
  }

  previewSelection(boxes) {
    this.selection = boxes;
    this.renderMarkers();
  }

  startMove(event) {
    const control = event.target.closest('[data-callout]');
    if (!control || !event.isPrimary || event.button !== 0 || this.draft) return;
    const index = Number(control.dataset.callout);
    const note = this.getNotes().find(note => note.index === index);
    if (!note) return;
    const page = this.getPage();
    const layout = calloutLayout(page.pageWidth, page.pageHeight, note);
    const { x, y, w, h } = layout.bubble;
    const part = control.dataset.part;
    const point = part === 'bubble' ? [x + w / 2, y + h / 2] : layout.line[1];
    this.drag = {
      id: event.pointerId, index, part, start: [event.clientX, event.clientY],
      point: [point[0] / page.pageWidth, point[1] / page.pageHeight],
    };
    this.layer.setPointerCapture(event.pointerId);
  }

  updateMove(event) {
    const drag = this.drag;
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.start[0], dy = event.clientY - drag.start[1];
    if (!drag.position && Math.hypot(dx, dy) < 4) return;
    drag.position = { [drag.part]: [drag.point[0] + dx / this.layer.clientWidth, drag.point[1] + dy / this.layer.clientHeight] };
    this.active = drag.index;
    this.renderMarkers();
  }

  finishMove(event) {
    if (this.drag?.id !== event.pointerId) return;
    const { index, position, part } = this.drag;
    this.drag = null;
    if (!position && part === 'bubble') this.select(index);
    else if (!position || !this.move(index, position)) this.renderMarkers();
  }

  moveWithKeys(event) {
    const control = event.target.closest('[data-callout]');
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!control || !direction || this.draft) return;
    event.preventDefault();
    const index = Number(control.dataset.callout);
    const note = this.getNotes().find(note => note.index === index);
    if (!note) return;
    const part = control.dataset.part;
    const { pageWidth, pageHeight } = this.getPage();
    const layout = calloutLayout(pageWidth, pageHeight, note);
    const { x, y, w, h } = layout.bubble;
    const point = part === 'bubble' ? [x + w / 2, y + h / 2] : layout.line[1];
    const step = event.shiftKey ? 14 : 3;
    this.active = index;
    this.move(index, { [part]: [(point[0] + direction[0] * step) / pageWidth, (point[1] + direction[1] * step) / pageHeight] });
    this.layer.querySelector(`[data-callout="${index}"][data-part="${part}"]`)?.focus({ preventScroll: true });
  }

  renderMarkers() {
    this.layer.replaceChildren();
    const notes = this.getNotes();
    const selected = notes.find(note => note.index === this.active);
    const boxes = this.selection ?? (this.visible ? this.draft?.boxes ?? (selected?.box && [selected.box]) : null);
    for (const box of boxes ?? []) {
      const highlight = document.createElement('span');
      highlight.className = 'note-highlight';
      Object.assign(highlight.style, {
        left: `${box.x * 100}%`, top: `${box.y * 100}%`,
        width: `max(4px, ${box.w * 100}%)`, height: `max(4px, ${box.h * 100}%)`,
      });
      this.layer.append(highlight);
    }
    notes.forEach((note, index) => {
      if (note.callout) {
        this.renderCallout(note, index + 1);
        return;
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'note-pin';
      button.dataset.pin = note.index;
      button.style.left = `${Math.min(.975, Math.max(.025, note.pin.x + note.pin.w / 2)) * 100}%`;
      button.style.top = `${Math.min(.975, Math.max(.025, note.pin.y + note.pin.h / 2)) * 100}%`;
      button.setAttribute('aria-pressed', this.active === note.index && this.visible);
      button.setAttribute('aria-label', `Комментарий ${index + 1}${note.label ? ' · ' + note.label : ''}`);
      button.title = note.label || 'Открыть комментарий';
      button.textContent = index + 1;
      this.layer.append(button);
    });
  }

  renderCallout(note, number) {
    const { pageWidth, pageHeight } = this.getPage();
    const current = this.active === note.index;
    const moving = this.drag?.index === note.index ? this.drag.position : null;
    const layout = calloutLayout(pageWidth, pageHeight, { ...note, ...moving });
    const drawing = svgNode('svg', { class: 'note-drawing', viewBox: `0 0 ${pageWidth} ${pageHeight}`, 'aria-hidden': 'true' });
    for (const { x, y, w, h } of layout.targets) {
      drawing.append(svgNode('rect', { x, y, width: w, height: h, class: 'note-target' }));
    }
    drawing.append(svgNode('polyline', { points: layout.line.map(point => point.join(',')).join(' '), class: 'note-leader' }));
    this.layer.append(drawing);
    const bubble = document.createElement('button');
    bubble.type = 'button';
    bubble.className = 'note-bubble';
    bubble.dataset.callout = note.index;
    bubble.dataset.part = 'bubble';
    bubble.title = 'Перетащите облачко или нажмите, чтобы открыть комментарий';
    bubble.setAttribute('aria-label', `Комментарий ${number}. ${note.text}`);
    bubble.setAttribute('aria-pressed', current);
    bubble.textContent = layout.lines.join('\n');
    const { x, y, w, h } = layout.bubble;
    const viewScale = this.layer.clientWidth / pageWidth;
    Object.assign(bubble.style, {
      left: `${x / pageWidth * 100}%`, top: `${y / pageHeight * 100}%`,
      width: `${w / pageWidth * 100}%`, height: `${h / pageHeight * 100}%`,
      padding: `${layout.padding * viewScale}px`, fontSize: `${11 * viewScale}px`, lineHeight: `${14 * viewScale}px`,
    });
    this.layer.append(bubble);
    if (current) {
      const elbow = document.createElement('button');
      elbow.type = 'button';
      elbow.className = 'note-elbow';
      elbow.dataset.callout = note.index;
      elbow.dataset.part = 'elbow';
      elbow.setAttribute('aria-label', 'Переместить изгиб линии комментария');
      elbow.title = 'Перетащите, чтобы изменить изгиб линии';
      elbow.style.left = `${layout.line[1][0] / pageWidth * 100}%`;
      elbow.style.top = `${layout.line[1][1] / pageHeight * 100}%`;
      this.layer.append(elbow);
    }
  }
}
