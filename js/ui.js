// Interface behaviour: steps, segmented controls, tooltips, theme, status and welcome guide.

const $ = (id) => document.getElementById(id);
const store = {
  get: (k, d = null) => {
    try {
      return localStorage.getItem(k) ?? d;
    } catch {
      return d;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
    }
  },
};

const segs = [];

// ---------- theme ----------
const root = document.documentElement;
$('themeToggle').addEventListener('click', () => {
  const next = root.dataset.theme === 'light' ? 'dark' : 'light';
  root.dataset.theme = next;
  store.set('diorama-theme', next);
});

// ---------- steps ----------
const steps = [...document.querySelectorAll('.step')];
const pills = [...document.querySelectorAll('.step-pill')];
const order = steps.map((s) => s.dataset.step);
const dots = $('stepDots');
order.forEach((k, i) => {
  const d = document.createElement('span');
  d.className = 'dot';
  d.dataset.tip = `Step ${i + 1}: ${pills[i].querySelector('span').textContent}`;
  d.onclick = () => show(k);
  dots.append(d);
});
function show(key) {
  const i = Math.max(0, order.indexOf(key));
  steps.forEach((s, j) => s.classList.toggle('active', j === i));
  pills.forEach((p, j) => {
    p.classList.toggle('active', j === i);
    p.classList.toggle('done', j < i);
  });
  [...dots.children].forEach((d, j) => {
    d.classList.toggle('on', j === i);
    d.classList.toggle('done', j < i);
  });
  $('stepPrev').disabled = i === 0;
  $('stepNext').textContent = i === order.length - 1 ? 'Done' : 'Next';
  $('stepNext').disabled = i === order.length - 1;
  document.querySelector('.panel-scroll').scrollTop = 0;
  syncSegments();
  store.set('diorama-step', order[i]);
}
pills.forEach((p) => (p.onclick = () => show(p.dataset.step)));
$('stepPrev').onclick = () => show(order[Math.max(0, order.indexOf(current()) - 1)]);
$('stepNext').onclick = () => show(order[Math.min(order.length - 1, order.indexOf(current()) + 1)]);
const current = () => steps.find((s) => s.classList.contains('active'))?.dataset.step || order[0];
show(store.get('diorama-step', 'place'));

// ---------- segmented controls ----------
for (const sel of document.querySelectorAll('select.seg-select')) {
  const group = document.createElement('div');
  group.className = 'segmented';
  group.setAttribute('role', 'radiogroup');
  for (const opt of sel.options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = opt.textContent;
    b.dataset.value = opt.value;
    b.onclick = () => {
      if (sel.value === opt.value) return;
      sel.value = opt.value;
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      syncSegments();
    };
    group.append(b);
  }
  sel.classList.add('seg-select-native');
  sel.after(group);
  segs.push([sel, group]);
  sel.addEventListener('change', syncSegments);
}
function syncSegments() {
  for (const [sel, group] of segs) for (const b of group.children) b.classList.toggle('on', b.dataset.value === sel.value);
}
syncSegments();

// ---------- tooltips ----------
const tip = $('tooltip');
let tipTimer = null;
let tipFor = null;
function placeTip(el) {
  const r = el.getBoundingClientRect();
  tip.style.left = '0px';
  tip.style.top = '0px';
  const t = tip.getBoundingClientRect();
  let x = r.left + r.width / 2 - t.width / 2;
  let y = r.bottom + 10;
  if (y + t.height > innerHeight - 8) y = r.top - t.height - 10;
  x = Math.max(8, Math.min(innerWidth - t.width - 8, x));
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
}
document.addEventListener('pointerover', (e) => {
  const el = e.target.closest('[data-tip]');
  if (el === tipFor) return;
  tipFor = el;
  clearTimeout(tipTimer);
  tip.classList.remove('on');
  if (!el) return;
  tipTimer = setTimeout(() => {
    tip.textContent = el.dataset.tip;
    placeTip(el);
    tip.classList.add('on');
  }, 450);
});
document.addEventListener('pointerdown', () => {
  clearTimeout(tipTimer);
  tip.classList.remove('on');
});

// ---------- range fills, segment sync, status ----------
function refresh() {
  for (const r of document.querySelectorAll('input[type=range]')) {
    const pct = ((r.value - r.min) / (r.max - r.min || 1)) * 100;
    r.style.setProperty('--pct', `${pct}%`);
  }
  syncSegments();
  const pill = $('statusPill');
  const text = $('status').textContent.trim();
  pill.classList.toggle('running', !$('progress').hidden || /…$/.test(text));
  pill.classList.toggle('error', /failed|unavailable|could not/i.test(text));
  pill.dataset.tip = text || 'Ready.';
  $('btnExportTop').disabled = $('btnExport').disabled;
  $('stageEmpty').hidden = !$('btnExport').disabled;
}
document.addEventListener('input', (e) => e.target.matches?.('input[type=range]') && refresh());
setInterval(refresh, 400);
refresh();

$('btnExportTop').onclick = () => $('btnExport').click();

// ---------- view state ----------
new MutationObserver(() => document.body.classList.toggle('view-3d', $('tab3d').classList.contains('active'))).observe($('tab3d'), {
  attributes: true,
  attributeFilter: ['class'],
});

// ---------- file pickers ----------
for (const input of document.querySelectorAll('.file-btn input[type=file]')) {
  const label = input.nextElementSibling;
  const original = label.textContent;
  input.addEventListener('change', () => {
    const n = input.files.length;
    label.textContent = n === 0 ? original : n === 1 ? input.files[0].name : `${n} files`;
    setTimeout(() => {
      if (!input.value) label.textContent = original;
    }, 1500);
  });
}

// ---------- labels list shortcut ----------
$('openLabelList').onclick = () => {
  $('tab3d').click();
  setTimeout(() => $('lblPanelToggle').click(), 50);
};

// ---------- welcome guide ----------
const welcome = $('welcome');
const hideWelcome = () => {
  welcome.hidden = true;
  store.set('diorama-welcome', 'done');
};
if (store.get('diorama-welcome') === 'done') welcome.hidden = true;
$('welcomeClose').onclick = hideWelcome;
const chips = $('welcomeChips');
const fillChips = () => {
  chips.textContent = '';
  for (const opt of [...$('preset').options].filter((o) => o.value !== '').slice(0, 6)) {
    const b = document.createElement('button');
    b.className = 'pill';
    b.textContent = opt.textContent.split(',')[0].replace(/\s*\(.*\)/, '');
    b.dataset.tip = `Frame ${opt.textContent}, then press Build.`;
    b.onclick = () => {
      $('preset').value = opt.value;
      $('preset').dispatchEvent(new Event('change'));
    };
    chips.append(b);
  }
};
new MutationObserver(fillChips).observe($('preset'), { childList: true });
fillChips();
new MutationObserver(() => {
  if (!/^No area/.test($('selInfo').textContent)) hideWelcome();
}).observe($('selInfo'), { childList: true, characterData: true, subtree: true });

new MutationObserver(() => {
  if (store.get('diorama-welcome') !== 'done') welcome.hidden = $('tab3d').classList.contains('active');
}).observe($('tab3d'), { attributes: true, attributeFilter: ['class'] });
