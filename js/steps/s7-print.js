import { h, card, checkbox, hint, button, downloadBlob, stat, fmt } from '../ui.js';
import { pxToMm, lpiInUse } from '../core/geometry.js';

const CHECKLIST = [
  ['paper', 'Glossy photo paper loaded, and the matching paper type selected in the driver'],
  ['quality', 'Quality set to the highest mode'],
  ['bidir', 'High Speed (bidirectional) printing OFF: prevents pass misalignment and banding'],
  ['scale', 'Scaling 100%: "fit to page" off, borderless expansion off'],
  ['enhance', 'Auto-enhance / colour correction off (or the same on every print)'],
  ['patch', 'Printed a small test patch first (e.g. the 2-frame flip test) and checked it under the lens'],
];

export default {
  id: 7,
  title: 'Print & mount',
  subtitle: 'Settings & assembly',
  intro: 'Print the interlaced file at true size, then laminate the lens over it.',
  render(root, { store }) {
    const s = store.state;
    const info = store.assets.outputInfo;
    const out = store.assets.output;

    root.append(
      h('div', { class: 'cols' },
        card('Your file',
          out && info
            ? h('div', { class: 'stats' },
              stat('Print size', `${fmt.n(pxToMm(info.width, s.printer.ppi), 1)} × ${fmt.n(pxToMm(info.height, s.printer.ppi), 1)} mm`),
              stat('Resolution', `${s.printer.ppi} ppi (embedded)`),
              stat('Lens', `${fmt.n(lpiInUse(s.lens), 2)} LPI, ${s.lens.orientation}`),
              stat('Frame order', s.interlace.reverse ? 'reversed' : 'normal'))
            : hint('No interlaced file yet; generate it in Step 6.'),
          out ? h('div', { class: 'btn-row', style: { marginTop: '10px' } }, button('Download interlaced.png', () => downloadBlob(out, 'interlaced.png'), { kind: 'primary' })) : null,
          hint(`Print from an app that respects the embedded ${s.printer.ppi} ppi (e.g. the Epson Photo+ app or Windows Photos with "actual size"). Measure the print with a ruler: it should match the card size + bleed exactly.`),
        ),
        card('Printer checklist (Epson L3250)',
          h('ul', { class: 'checklist' }, CHECKLIST.map(([k, text]) => h('li', {}, checkbox({
            label: text, checked: !!s.print.checklist[k],
            onChange: (v) => store.update((st) => { st.print.checklist[k] = v; }),
          })))),
        ),
      ),
      h('div', { class: 'cols' },
        card('Mounting',
          h('ol', { class: 'steps-list' },
            h('li', {}, 'Let the print dry fully (at least 1 hour for dye inks; overnight is safer).'),
            h('li', {}, 'Find the ridge direction: run a fingernail across the lens; the ridged side faces you, smooth side down.'),
            h('li', {}, s.lens.orientation === 'vertical' ? 'Turn the lens so the ridges run vertically (top to bottom of the card).' : 'Turn the lens so the ridges run horizontally (left to right).'),
            h('li', {}, 'Lay the lens on the print. Align a ridge with a registration strip: when aligned, the whole strip goes dark or light at once as you tilt; diagonal bands mean it is rotated.'),
            h('li', {}, 'Tape one edge down once it looks right.'),
            h('li', {}, 'Lift the free side, apply adhesive (double-sided film or spray), and roll it down from the taped edge with a brayer to push out air.'),
            h('li', {}, 'Trim along the crop marks with a sharp knife and steel ruler, through the lens and print together.'),
          ),
        ),
        card('Troubleshooting',
          h('dl', { class: 'trouble' },
            h('dt', {}, 'Bands or beating stripes across the card'), h('dd', {}, 'Pitch is off: re-run the pitch test and enter the measured LPI. Also check bidirectional printing is OFF.'),
            h('dt', {}, 'Ghosting / double images'), h('dd', {}, 'Too much motion or depth per frame. Lower depth strength (Step 5) or effect amounts (Step 4), or the depth budget (Step 2).'),
            h('dt', {}, 'Effect happens in the wrong direction'), h('dd', {}, 'Rotate the lens 90°, or change the ridge orientation in Step 1 and re-interlace.'),
            h('dt', {}, '3D looks inside-out'), h('dd', {}, 'Toggle "Reverse frame order" in Step 6 and print again.'),
            h('dt', {}, 'Image looks fine at one angle, smeared at others'), h('dd', {}, 'The lens is slightly rotated. Re-align it using the registration strips before gluing.'),
            h('dt', {}, 'Print size is wrong'), h('dd', {}, 'The print app scaled the image. Turn off fit-to-page and print at 100% / actual size.'),
          ),
        ),
      ),
    );
  },
};
