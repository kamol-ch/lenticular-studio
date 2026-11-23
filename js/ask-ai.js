// "Ask AI" dialog: opens the user's AI site in a new tab with a pre-filled
// prompt (question + current step + settings). Nothing is sent by this app.

import { h, button, checkbox, toast } from './ui.js';
import { AI_SITES, EXAMPLE_QUESTIONS, buildAskPrompt, HELP_URL } from './core/askai.js';

let dialog = null;

/**
 * @param {{ step:{id:number,title:string}, state:object, plan?:object, warnings?:string[] }} ctx
 */
export function openAskAI(ctx) {
  dialog?.remove();
  const question = h('textarea', { rows: 3, maxlength: 500, placeholder: `e.g. ${EXAMPLE_QUESTIONS[ctx.step.id] || 'How does this step work?'}`, 'aria-label': 'Your question' });
  let include = true;
  const preview = h('pre', { class: 'ask-preview' });
  const prompt = () => buildAskPrompt({ ...ctx, question: question.value, includeSettings: include });
  const refresh = () => { preview.textContent = prompt(); };
  question.addEventListener('input', refresh);

  const open = (site) => {
    if (!question.value.trim()) { question.focus(); toast('Type your question first.'); return; }
    window.open(site.url(prompt()), '_blank', 'noopener');
    dialog.close();
  };
  const copy = async () => {
    await navigator.clipboard.writeText(prompt());
    toast('Prompt copied. Paste it into any AI assistant.');
  };

  dialog = h('dialog', { class: 'ask-dialog', 'aria-labelledby': 'ask-title' },
    h('form', { method: 'dialog' },
      h('header', { class: 'ask-head' },
        h('h3', { id: 'ask-title' }, `Ask an AI about Step ${ctx.step.id} · ${ctx.step.title}`),
        h('button', { class: 'btn ghost small', value: 'close', 'aria-label': 'Close' }, '✕')),
      h('p', { class: 'hint' }, 'Opens your own AI assistant in a new tab with your question, this step and your settings. Only this text is shared, never your images.'),
      question,
      checkbox({ label: 'Include my settings and warnings', checked: true, hint: 'So the answer uses your numbers.', onChange: (v) => { include = v; refresh(); } }),
      h('details', { class: 'more' }, h('summary', {}, 'Preview the prompt'), preview),
      h('div', { class: 'btn-row ask-actions' },
        ...AI_SITES.map((s) => button(`Ask ${s.name}`, () => open(s), { kind: 'small primary' })),
        button('Copy prompt', copy, { kind: 'small' })),
      h('p', { class: 'hint ask-foot' }, 'AI answers can be wrong: check them against the ', h('a', { href: HELP_URL.replace('raw.githubusercontent.com', 'github.com').replace('/main/', '/blob/main/'), target: '_blank', rel: 'noopener' }, 'help page'), '.')));
  dialog.addEventListener('close', () => dialog?.remove());
  document.body.append(dialog);
  refresh();
  dialog.showModal();
  question.focus();
}
