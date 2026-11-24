// The help page inside the app. help.html is the single source: it is also a
// standalone page (readable without JavaScript, e.g. by an AI assistant), and
// here its <article> is shown in the main area.

import { h, button } from './ui.js';

let articlePromise = null;

function loadArticle() {
  articlePromise ||= fetch('help.html')
    .then((r) => { if (!r.ok) throw new Error(`Help page not found (${r.status}).`); return r.text(); })
    .then((html) => new DOMParser().parseFromString(html, 'text/html').querySelector('article.help'))
    .catch((e) => { articlePromise = null; throw e; });
  return articlePromise;
}

/** The public address of the help page, for AI assistants to read. */
export function helpPageUrl(fallback) {
  const { protocol, hostname, origin, pathname } = location;
  const local = !/^https?:$/.test(protocol) || hostname === 'localhost' || /^(127\.|10\.|192\.168\.|\[?::1)/.test(hostname);
  return local ? fallback : `${origin}${pathname.replace(/[^/]*$/, '')}help.html`;
}

/**
 * Render help into `main`. `section` is an element id such as "step-2".
 * `onBack` returns to the editor.
 */
export async function renderHelp(main, { section, backLabel, onBack }) {
  main.replaceChildren(h('p', { class: 'hint' }, 'Loading help…'));
  let src;
  try { src = await loadArticle(); }
  catch (e) { main.replaceChildren(h('p', { class: 'hint' }, e.message)); return; }
  const article = document.importNode(src, true);
  // In-page links scroll instead of changing the app's #step routing.
  article.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    e.preventDefault();
    const id = a.getAttribute('href').slice(1);
    article.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ behavior: 'smooth' });
    history.replaceState(null, '', `#help/${id}`);
  });
  main.replaceChildren(
    h('div', { class: 'help-back' },
      button(`← ${backLabel}`, onBack, { kind: 'small' }),
      h('a', { class: 'btn small ghost', href: 'help.html', target: '_blank', rel: 'noopener' }, 'Open in a new tab')),
    article);
  const target = section && article.querySelector(`#${CSS.escape(section)}`);
  if (target) target.scrollIntoView();
  else window.scrollTo(0, 0);
}
