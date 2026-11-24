import { icon } from './icons.js';

export class Comments {
  constructor({ layer, panel, container, toggle, getNotes, show, save, remove }) {
    Object.assign(this, { layer, panel, container, toggle, getNotes, show, save, remove });
    this.active = null;
    this.draft = null;
    this.visible = false;
    this.layer.addEventListener('click', event => {
      const pin = event.target.closest('[data-pin]');
      if (pin) this.select(Number(pin.dataset.pin));
    });
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

  begin(anchor, box) {
    this.active = null;
    this.draft = { anchor, box, text: '' };
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
    if (action === 'edit-note' && note) this.draft = { index: note.index, box: note.box, text: note.text };
    if (action === 'delete-note' && note && this.remove(note.index)) this.active = null;
    this.render();
    if (action === 'edit-note') this.panel.querySelector('textarea')?.focus({ preventScroll: true });
  }

  commit(text) {
    const draft = this.draft;
    this.draft = null;
    const index = this.save(draft, text);
    if (index === null) this.draft = draft;
    else this.active = index;
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
        empty.textContent = 'Выберите «Комментарий» на панели инструментов и нажмите на слово или объект.';
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

  renderMarkers() {
    this.layer.replaceChildren();
    const notes = this.getNotes();
    const selected = notes.find(note => note.index === this.active);
    const box = this.visible ? this.draft?.box ?? selected?.box : null;
    if (box) {
      const highlight = document.createElement('span');
      highlight.className = 'note-highlight';
      Object.assign(highlight.style, {
        left: `${box.x * 100}%`, top: `${box.y * 100}%`,
        width: `max(4px, ${box.w * 100}%)`, height: `max(4px, ${box.h * 100}%)`,
      });
      this.layer.append(highlight);
    }
    notes.forEach((note, index) => {
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
}
