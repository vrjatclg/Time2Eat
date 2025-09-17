// Tiny DOM + helpers
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
export const on = (el, ev, fn) => el && el.addEventListener(ev, fn);

export const fmtINR = (n) => {
  const num = Number(n || 0);
  return num.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
};

export const debounce = (fn, wait = 250) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
};

export const openDialog = (dlg) => {
  if (!dlg.open) dlg.showModal();
};
export const closeDialog = (dlg) => {
  if (dlg.open) dlg.close();
};

export const formatItemsSummary = (items = []) =>
  items.map(it => `${it.name} x ${it.quantity}`).join(', ');
