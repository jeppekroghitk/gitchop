/** Adding the page you are on as a link, in a form that stands where the filter was. */
import { isSafeUrl } from '../../lib/links.js';
import { node } from '../dom.js';

function defaultLabel() {
  return document.title.replace(/\s*[·|—-]\s*GitHub\s*$/i, '').trim().slice(0, 80);
}

/** @param {import('../menu.js').Menu} menu */
export function createForm(menu) {
  const { state } = menu;
  const { panel, filter, list } = menu.el;

  function closeForm() {
    state.form?.remove();
    state.form = null;
    filter.hidden = false;
    filter.focus();
  }

  function openForm() {
    if (state.form) return;
    filter.hidden = true;

    const form = node('div', 'gc-form');
    state.form = form;
    const icon = node('input');
    icon.placeholder = '🔗';
    icon.maxLength = 4;
    icon.setAttribute('aria-label', 'Icon');

    const label = node('input');
    label.placeholder = 'Label';
    label.value = defaultLabel();
    label.setAttribute('aria-label', 'Label');

    const url = node('input', 'gc-form-url');
    url.value = location.href;
    url.setAttribute('aria-label', 'URL');

    const save = node('button', 'gc-btn gc-btn--primary', 'Save');
    const cancel = node('button', 'gc-btn', 'Cancel');
    const actions = node('div', 'gc-form-actions');
    actions.append(cancel, save);

    form.append(icon, label, url, actions);
    panel.insertBefore(form, list);

    const submit = async () => {
      const value = url.value.trim();
      if (!value || !isSafeUrl(value)) {
        url.focus();
        url.select();
        return;
      }
      const link = {
        id: crypto.randomUUID(),
        icon: icon.value.trim().slice(0, 4),
        label: label.value.trim().slice(0, 80) || value,
        url: value,
      };
      closeForm();
      filter.value = '';
      menu.search.cancel();
      menu.search.reset();
      await menu.list.persist([...menu.list.links(), link]);
    };

    save.addEventListener('click', submit);
    cancel.addEventListener('click', closeForm);
    form.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submit();
      }
    });

    label.focus();
    label.select();
  }

  return { open: openForm, close: closeForm };
}
