import { $, $$, on, fmtINR, debounce, openDialog, closeDialog, formatItemsSummary } from './utils.js';
import {
  fetchMenu, getStudent, setStudentBlocked, placeOrder, listOrdersByPid,
  cancelOrder, getCart, setCart, clearCart, countCancellations24h
} from './storage.js';

// Elements
const studentNotice = $('#studentNotice');

const searchInput = $('#searchInput');
const showUnavailable = $('#showUnavailable');
const menuGrid = $('#menuGrid');

const cartBtn = $('#cartBtn');
const cartCount = $('#cartCount');
const cartDrawer = $('#cartDrawer');
const scrim = $('#scrim');
const closeCartBtn = $('#closeCartBtn');
const cartItems = $('#cartItems');
const subtotalEl = $('#subtotal');
const checkoutBtn = $('#checkoutBtn');

const pidDialog = $('#pidDialog');
const pidForm = $('#pidForm');
const pidInput = $('#pidInput');
const pidWarnings = $('#pidWarnings');
const cancelPidBtn = $('#cancelPid');

const paymentDialog = $('#paymentDialog');
const paymentTotal = $('#paymentTotal');
const generatePaymentCodeBtn = $('#generatePaymentCodeBtn');
const paymentCodeBlock = $('#paymentCodeBlock');
const paymentCodeText = $('#paymentCodeText');
const copyPayCodeBtn = $('#copyPayCodeBtn');
const cancelPaymentBtn = $('#cancelPaymentBtn');

const viewOrdersBtn = $('#viewOrdersBtn');
const ordersDialog = $('#ordersDialog');
const ordersForm = $('#ordersForm');
const ordersPidInput = $('#ordersPidInput');
const ordersCancelBtn = $('#ordersCancelBtn');
const ordersList = $('#ordersList');

// State
let allMenu = [];
let filteredMenu = [];
let cart = {}; // itemId -> qty
let currentPID = ''; // set during checkout/orders

// UI helpers
function openDrawer() {
  cartDrawer.classList.add('open');
  scrim.classList.add('open');
}
function closeDrawer() {
  cartDrawer.classList.remove('open');
  scrim.classList.remove('open');
}
on(scrim, 'click', closeDrawer);
on(closeCartBtn, 'click', closeDrawer);
on(cartBtn, 'click', () => {
  renderCart();
  openDrawer();
});

// Load menu + render
async function loadAndRenderMenu() {
  menuGrid.setAttribute('aria-busy', 'true');
  allMenu = await fetchMenu();
  menuGrid.removeAttribute('aria-busy');
  applyFilter();
}

function applyFilter() {
  const q = (searchInput.value || '').toLowerCase().trim();
  const includeUnavailable = showUnavailable.checked;
  filteredMenu = allMenu.filter(it => {
    const matches = it.name?.toLowerCase().includes(q);
    const availableOk = includeUnavailable ? true : !!it.available;
    return matches && availableOk;
  });
  renderMenu();
}

function renderMenu() {
  menuGrid.innerHTML = '';
  if (!filteredMenu.length) {
    menuGrid.innerHTML = `<div class="muted">No items found.</div>`;
    return;
  }
  for (const it of filteredMenu) {
    const card = document.createElement('div');
    card.className = 'card menu-card';
    const disabled = !it.available;
    card.innerHTML = `
      <img class="menu-img" src="${it.imageUrl || `https://picsum.photos/seed/${encodeURIComponent(it.name)}/600/600`}" alt="${it.name}" />
      <div class="menu-sub">
        <h3 class="menu-title">${it.name}</h3>
        <strong>₹ ${fmtINR(it.price)}</strong>
      </div>
      <div class="row spread">
        <span class="muted small">${it.available ? 'Available' : 'Unavailable'}</span>
        <div class="qty-row">
          <button class="btn" data-add="${it.id}" ${disabled ? 'disabled' : ''}>Add</button>
        </div>
      </div>
    `;
    menuGrid.appendChild(card);
  }
}

on(searchInput, 'input', debounce(applyFilter, 200));
on(showUnavailable, 'change', applyFilter);

on(menuGrid, 'click', (e) => {
  const id = e.target?.dataset?.add;
  if (!id) return;
  cart[id] = (cart[id] || 0) + 1;
  updateCartCount();
  if (currentPID) persistCart(); // save if PID known
});

function updateCartCount() {
  const count = Object.values(cart).reduce((s, q) => s + q, 0);
  cartCount.textContent = count;
}

async function renderCart() {
  // Build a map itemId->item for visible data (price/name)
  const idx = Object.fromEntries(allMenu.map(m => [m.id, m]));
  cartItems.innerHTML = '';
  let total = 0;
  Object.entries(cart).forEach(([id, qty]) => {
    const item = idx[id];
    if (!item || qty <= 0) return;
    total += (item.price || 0) * qty;
    const row = document.createElement('div');
    row.className = 'cart-item';
    row.innerHTML = `
      <img src="${item.imageUrl || `https://picsum.photos/seed/${encodeURIComponent(item.name)}/200/200`}" alt="${item.name}" />
      <div class="grow">
        <div class="row spread">
          <strong>${item.name}</strong>
          <strong>₹ ${fmtINR(item.price * qty)}</strong>
        </div>
        <div class="row gap">
          <button class="icon-btn" data-dec="${id}">-</button>
          <span>${qty}</span>
          <button class="icon-btn" data-inc="${id}">+</button>
          <button class="icon-btn" data-rem="${id}">Remove</button>
        </div>
      </div>
    `;
    cartItems.appendChild(row);
  });
  subtotalEl.textContent = fmtINR(total);
}

on(cartItems, 'click', (e) => {
  const inc = e.target?.dataset?.inc;
  const dec = e.target?.dataset?.dec;
  const rem = e.target?.dataset?.rem;
  if (inc) cart[inc] = (cart[inc] || 0) + 1;
  if (dec) {
    cart[dec] = (cart[dec] || 0) - 1;
    if (cart[dec] <= 0) delete cart[dec];
  }
  if (rem) delete cart[rem];
  updateCartCount();
  renderCart();
  if (currentPID) persistCart();
});

// Checkout flow (PID -> Payment -> Create Order)
on(checkoutBtn, 'click', async () => {
  if (Object.keys(cart).length === 0) {
    alert('Your cart is empty.');
    return;
  }
  pidWarnings.textContent = '';
  openDialog(pidDialog);
});

on(cancelPidBtn, 'click', () => closeDialog(pidDialog));

on(pidForm, 'submit', async (e) => {
  e.preventDefault();
  const pid = pidInput.value.trim().toUpperCase();
  if (!pid) return;
  currentPID = pid;

  // Load saved cart for this PID (merge with current cart)
  const saved = await getCart(pid);
  for (const [itemId, qty] of Object.entries(saved)) {
    cart[itemId] = Math.max(cart[itemId] || 0, qty);
  }
  updateCartCount();
  renderCart();

  // Check blocked
  const stu = await getStudent(pid);
  if (stu?.blocked) {
    pidWarnings.textContent = 'You are blocked from ordering. Please contact the canteen admin.';
    return;
  }

  // Open payment modal
  paymentTotal.textContent = subtotalEl.textContent;
  closeDialog(pidDialog);
  openDialog(paymentDialog);
});

on(cancelPaymentBtn, 'click', () => closeDialog(paymentDialog));

on(generatePaymentCodeBtn, 'click', async () => {
  try {
    // Build items array for order
    const idx = Object.fromEntries(allMenu.map(m => [m.id, m]));
    const items = Object.entries(cart).map(([itemId, qty]) => ({
      itemId, name: idx[itemId]?.name || 'Item', price: idx[itemId]?.price || 0, quantity: qty
    }));
    if (items.length === 0) {
      alert('Your cart is empty.');
      return;
    }

    // Place order (creates order + student subdoc + payment code)
    const order = await placeOrder({ pid: currentPID, items });
    paymentCodeText.textContent = order.paymentCode;
    paymentCodeBlock.hidden = false;

    // Clear local cart state
    cart = {};
    updateCartCount();
    renderCart();
  } catch (err) {
    console.error(err);
    alert('Failed to place order. Please try again.');
  }
});

on(copyPayCodeBtn, 'click', async () => {
  const code = paymentCodeText.textContent.trim();
  try {
    await navigator.clipboard.writeText(code);
    copyPayCodeBtn.textContent = 'Copied!';
    setTimeout(() => (copyPayCodeBtn.textContent = 'Copy Code'), 1200);
  } catch {
    // ignore
  }
});

// Orders viewing
on(viewOrdersBtn, 'click', () => {
  ordersList.innerHTML = '';
  openDialog(ordersDialog);
});

on(ordersCancelBtn, 'click', () => closeDialog(ordersDialog));

on(ordersForm, 'submit', async (e) => {
  e.preventDefault();
  const pid = ordersPidInput.value.trim().toUpperCase();
  if (!pid) return;
  currentPID = pid; // reuse
  const orders = await listOrdersByPid(pid);
  renderOrdersList(pid, orders);
});

function mapStatus(o) {
  if (o.status === 'cancelled') return 'CANCELLED';
  if (o.status === 'fulfilled') return 'FULFILLED';
  if (o.status === 'ready') return 'VERIFIED'; // keep badge style while showing text "Ready"
  if (o.status === 'verified') return 'VERIFIED';
  return o.paymentVerified ? 'VERIFIED' : 'PENDING_PAYMENT';
}

function renderOrdersList(pid, orders) {
  ordersList.innerHTML = '';
  if (!orders.length) {
    ordersList.innerHTML = '<div class="muted small">No orders found.</div>';
    return;
  }
  for (const o of orders) {
    const li = document.createElement('div');
    li.className = 'order-card';
    const itemsText = formatItemsSummary(o.items || []);
    const badgeClass = mapStatus(o);
    const statusText = o.status?.toUpperCase() || badgeClass;
    li.innerHTML = `
      <div class="row">
        <strong>${pid}</strong>
        <span class="status ${badgeClass}">${statusText}${o.paymentVerified ? ' • PAID' : ''}</span>
      </div>
      <div class="order-items small muted">${itemsText}</div>
      <div class="row spread">
        <div>₹ ${fmtINR(o.total)}</div>
        <div class="row gap">
          <span class="small muted">Code: ${o.paymentCode}</span>
          <button class="btn ghost small" data-refresh="${o.id}">Refresh</button>
          <button class="btn danger small" data-cancel="${o.id}" ${o.status !== 'placed' || o.paymentVerified ? 'disabled' : ''}>Cancel</button>
        </div>
      </div>
    `;
    ordersList.appendChild(li);
  }
}

on(ordersList, 'click', async (e) => {
  const btn = e.target;
  const cancelId = btn?.dataset?.cancel;
  const refreshId = btn?.dataset?.refresh;
  if (!currentPID) return;
  if (refreshId) {
    const orders = await listOrdersByPid(currentPID);
    renderOrdersList(currentPID, orders);
    return;
  }
  if (cancelId) {
    if (!confirm('Cancel this order? Repeated cancellations can lead to blocking.')) return;
    try {
      await cancelOrder(currentPID, cancelId);
      const cancels = await countCancellations24h(currentPID);
      if (cancels >= 3) {
        await setStudentBlocked(currentPID, true);
        alert('Order cancelled. You have been automatically blocked due to repeated cancellations.');
      } else {
        alert('Order cancelled.');
      }
      const orders = await listOrdersByPid(currentPID);
      renderOrdersList(currentPID, orders);
    } catch (err) {
      alert(err.message || 'Failed to cancel order.');
    }
  }
});

// Persist cart in Firestore for known PID
async function persistCart() {
  if (!currentPID) return;
  const itemsMap = {};
  Object.entries(cart).forEach(([id, qty]) => {
    if (qty > 0) itemsMap[id] = qty;
  });
  await setCart(currentPID, itemsMap);
}

// Load initial
loadAndRenderMenu();
