import {
  db, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, serverTimestamp, runTransaction
} from './firebase.js';

// UI elements
const menuGrid = document.getElementById('menuGrid');
const cartItemsEl = document.getElementById('cartItems');
const cartTotalEl = document.getElementById('cartTotal');
const pidInput = document.getElementById('pidInput');
const placeOrderMsg = document.getElementById('placeOrderMsg');
const checkoutForm = document.getElementById('checkoutForm');
const clearCartBtn = document.getElementById('clearCartBtn');

const navMenuBtn = document.getElementById('navMenuBtn');
const navMyOrdersBtn = document.getElementById('navMyOrdersBtn');
const menuView = document.getElementById('menuView');
const myOrdersView = document.getElementById('myOrdersView');

const lookupForm = document.getElementById('lookupForm');
const lookupPidInput = document.getElementById('lookupPidInput');
const ordersList = document.getElementById('ordersList');
const blockedNotice = document.getElementById('blockedNotice');

// Constants
const CANCELLATION_BLOCK_THRESHOLD = 3;
const PAYMENT_CODE_LENGTH = 6;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// State
let cart = {}; // itemId -> {item, qty}
let menuIndex = {}; // itemId -> item

// Navigation
navMenuBtn.addEventListener('click', () => switchView('menu'));
navMyOrdersBtn.addEventListener('click', () => switchView('orders'));

function switchView(view) {
  if (view === 'menu') {
    navMenuBtn.classList.add('active');
    navMyOrdersBtn.classList.remove('active');
    menuView.classList.add('active');
    myOrdersView.classList.remove('active');
  } else {
    navMyOrdersBtn.classList.add('active');
    navMenuBtn.classList.remove('active');
    myOrdersView.classList.add('active');
    menuView.classList.remove('active');
  }
}

// Load menu
async function loadMenu() {
  menuGrid.innerHTML = 'Loading menu...';
  const q = query(collection(db, 'menuItems'), orderBy('name'));
  const snap = await getDocs(q);
  menuGrid.innerHTML = '';
  menuIndex = {};
  snap.forEach(docSnap => {
    const item = { id: docSnap.id, ...docSnap.data() };
    menuIndex[item.id] = item;
    const card = document.createElement('div');
    card.className = 'card item-card';
    card.innerHTML = `
      <img src="${item.imageUrl || 'https://picsum.photos/seed/' + encodeURIComponent(item.name) + '/600/400'}" alt="${item.name}" />
      <div class="row">
        <strong>${item.name}</strong>
        <span>₹${item.price}</span>
      </div>
      <div class="row">
        <span class="muted">${item.available ? 'Available' : 'Unavailable'}</span>
        <div>
          <button class="btn btn-secondary" ${!item.available ? 'disabled' : ''} data-add="${item.id}">Add</button>
        </div>
      </div>
    `;
    menuGrid.appendChild(card);
  });

  // If PID present, try load its saved cart
  const pid = pidInput.value.trim().toUpperCase();
  if (pid) await loadCartForPid(pid);
}

menuGrid.addEventListener('click', (e) => {
  const id = e.target?.dataset?.add;
  if (!id) return;
  addToCart(id);
});

function addToCart(itemId) {
  const item = menuIndex[itemId];
  if (!item || !item.available) return;
  if (!cart[itemId]) cart[itemId] = { item, qty: 0 };
  cart[itemId].qty += 1;
  renderCart(true);
}

function renderCart(persist = false) {
  cartItemsEl.innerHTML = '';
  let total = 0;
  Object.values(cart).forEach(({ item, qty }) => {
    total += item.price * qty;
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `
      <div>${item.name} x ${qty}</div>
      <div>
        <button class="btn btn-text" data-dec="${item.id}">-</button>
        <button class="btn btn-text" data-inc="${item.id}">+</button>
        <button class="btn btn-text danger" data-rem="${item.id}">Remove</button>
      </div>
    `;
    cartItemsEl.appendChild(row);
  });
  cartTotalEl.textContent = total.toFixed(2);
  if (total === 0) {
    cartItemsEl.innerHTML = '<div class="muted">Your cart is empty.</div>';
  }
  if (persist) maybePersistCart();
}

cartItemsEl.addEventListener('click', (e) => {
  const dec = e.target?.dataset?.dec;
  const inc = e.target?.dataset?.inc;
  const rem = e.target?.dataset?.rem;
  if (inc) {
    cart[inc].qty += 1;
  } else if (dec) {
    cart[dec].qty -= 1;
    if (cart[dec].qty <= 0) delete cart[dec];
  } else if (rem) {
    delete cart[rem];
  }
  renderCart(true);
});

clearCartBtn.addEventListener('click', async () => {
  cart = {};
  renderCart(true);
  const pid = pidInput.value.trim().toUpperCase();
  if (pid) {
    // delete cart doc
    await setDoc(doc(db, 'students', pid, 'cart', 'current'), { items: {}, updatedAt: serverTimestamp() });
  }
});

// Helpers
function randCode(len = PAYMENT_CODE_LENGTH) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

async function generateUniquePaymentCode() {
  for (let attempts = 0; attempts < 10; attempts++) {
    const code = randCode();
    const ref = doc(db, 'paymentCodes', code);
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists()) throw new Error('collision');
        tx.set(ref, { createdAt: serverTimestamp(), orderId: null });
      });
      return code;
    } catch (e) { /* retry */ }
  }
  throw new Error('Failed to generate unique payment code. Try again.');
}

async function getStudentDoc(pid) {
  const ref = doc(db, 'students', pid);
  const snap = await getDoc(ref);
  return { ref, exists: snap.exists(), data: snap.exists() ? snap.data() : null };
}

async function isStudentBlocked(pid) {
  const { data } = await getStudentDoc(pid);
  return !!(data && data.blocked);
}

async function getCancellationsIn24h(pid) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const q = query(
    collection(db, 'students', pid, 'orders'),
    where('status', '==', 'cancelled'),
    where('createdAt', '>=', since)
  );
  const snap = await getDocs(q);
  return snap.size;
}

// Firestore-backed cart persistence by PID
async function maybePersistCart() {
  const pid = pidInput.value.trim().toUpperCase();
  if (!pid) return;
  const itemsMap = {};
  Object.values(cart).forEach(({ item, qty }) => {
    if (qty > 0) itemsMap[item.id] = qty;
  });
  await setDoc(doc(db, 'students', pid, 'cart', 'current'), {
    items: itemsMap,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

async function loadCartForPid(pid) {
  if (!pid) return;
  const ref = doc(db, 'students', pid, 'cart', 'current');
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const data = snap.data();
  const itemsMap = data.items || {};
  // rebuild cart from itemsMap and menuIndex
  cart = {};
  for (const [itemId, qty] of Object.entries(itemsMap)) {
    const item = menuIndex[itemId];
    if (item && qty > 0) {
      cart[itemId] = { item, qty };
    }
  }
  renderCart(false);
}

// Load saved cart when PID is entered/changed
pidInput.addEventListener('change', async () => {
  const pid = pidInput.value.trim().toUpperCase();
  if (!pid) return;
  await loadCartForPid(pid);
});

// Place order
checkoutForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  placeOrderMsg.textContent = '';
  const pid = pidInput.value.trim().toUpperCase();
  if (!pid) return;
  const items = Object.values(cart).map(({ item, qty }) => ({
    itemId: item.id, name: item.name, price: item.price, quantity: qty
  }));
  if (items.length === 0) {
    placeOrderMsg.textContent = 'Your cart is empty.';
    return;
  }
  try {
    const blocked = await isStudentBlocked(pid);
    if (blocked) {
      placeOrderMsg.textContent = 'You are blocked from ordering. Contact admin.';
      return;
    }
    const code = await generateUniquePaymentCode();

    const total = items.reduce((s, it) => s + it.price * it.quantity, 0);
    const orderBase = {
      pid,
      items,
      total,
      status: 'placed',
      paymentCode: code,
      paymentVerified: false,
      createdAt: serverTimestamp()
    };

    const ordersCol = collection(db, 'orders');
    const orderRef = await addDoc(ordersCol, orderBase);
    const studentOrderRef = doc(db, 'students', pid, 'orders', orderRef.id);
    await setDoc(studentOrderRef, { ...orderBase, orderId: orderRef.id });

    // Ensure student doc exists
    const studentRef = doc(db, 'students', pid);
    await setDoc(studentRef, { blocked: false, updatedAt: serverTimestamp() }, { merge: true });

    // Clear saved cart
    await setDoc(doc(db, 'students', pid, 'cart', 'current'), { items: {}, updatedAt: serverTimestamp() }, { merge: true });

    alert(`Order placed! Your payment code is: ${code}\nShow this code to the canteen.`);
    placeOrderMsg.textContent = `Order placed. Payment code: ${code}`;
    cart = {};
    renderCart(false);
  } catch (err) {
    console.error(err);
    placeOrderMsg.textContent = 'Failed to place order. Please try again.';
  }
});

// My Orders lookup
lookupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  ordersList.innerHTML = 'Loading...';
  blockedNotice.style.display = 'none';
  const pid = lookupPidInput.value.trim().toUpperCase();
  if (!pid) return;
  const blocked = await isStudentBlocked(pid);
  if (blocked) {
    blockedNotice.style.display = 'block';
    blockedNotice.textContent = 'You are currently blocked due to repeated misuse. Contact admin.';
  }
  const q = query(
    collection(db, 'students', pid, 'orders'),
    orderBy('createdAt', 'desc'),
    limit(20)
  );
  const snap = await getDocs(q);
  if (snap.empty) {
    ordersList.innerHTML = '<div class="muted">No orders found.</div>';
    return;
  }
  ordersList.innerHTML = '';
  snap.forEach(docSnap => {
    const o = { id: docSnap.id, ...docSnap.data() };
    const card = document.createElement('div');
    card.className = 'card order-card';
    const statusClass = o.status === 'cancelled' ? 'cancelled'
      : o.status === 'verified' ? 'paid'
      : o.status;

    const itemsHtml = (o.items || []).map(it => `${it.name} x ${it.quantity}`).join(', ');
    card.innerHTML = `
      <div class="row">
        <div><strong>Order ID:</strong> ${o.id}</div>
        <div class="order-status ${statusClass}">${o.status}${o.paymentVerified ? ' • paid' : ''}</div>
      </div>
      <div class="row"><span>${itemsHtml}</span><strong>₹${o.total?.toFixed?.(2) || o.total}</strong></div>
      <div class="row"><span>Payment Code: <strong>${o.paymentCode}</strong></span><span>${o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString() : ''}</span></div>
      <div class="actions">
        <button class="btn btn-secondary" data-refresh="${o.id}">Refresh</button>
        <button class="btn btn-danger" data-cancel="${o.id}" ${o.status !== 'placed' || o.paymentVerified ? 'disabled' : ''}>Cancel</button>
      </div>
    `;
    ordersList.appendChild(card);
  });
});

ordersList.addEventListener('click', async (e) => {
  const cancelId = e.target?.dataset?.cancel;
  const refreshId = e.target?.dataset?.refresh;
  const pid = lookupPidInput.value.trim().toUpperCase();
  if (!pid) return;

  if (refreshId) {
    lookupForm.dispatchEvent(new Event('submit'));
    return;
  }
  if (cancelId) {
    if (!confirm('Cancel this order? Repeated cancellations can lead to automatic blocking.')) return;
    try {
      const orderTopRef = doc(db, 'orders', cancelId);
      const orderStuRef = doc(db, 'students', pid, 'orders', cancelId);

      const orderSnap = await getDoc(orderStuRef);
      if (!orderSnap.exists()) throw new Error('Order not found');
      const order = orderSnap.data();
      if (order.status !== 'placed' || order.paymentVerified) {
        alert('Order cannot be cancelled.');
        return;
      }

      await updateDoc(orderTopRef, { status: 'cancelled', cancelledAt: serverTimestamp() });
      await updateDoc(orderStuRef, { status: 'cancelled', cancelledAt: serverTimestamp() });

      const cancels = await getCancellationsIn24h(pid);
      if (cancels + 1 >= CANCELLATION_BLOCK_THRESHOLD) {
        await setDoc(doc(db, 'students', pid), { blocked: true, updatedAt: serverTimestamp() }, { merge: true });
        alert('Order cancelled. You have been automatically blocked due to repeated cancellations.');
      } else {
        alert('Order cancelled.');
      }

      lookupForm.dispatchEvent(new Event('submit'));
    } catch (err) {
      console.error(err);
      alert('Failed to cancel order. Try again.');
    }
  }
});

// Initialize
loadMenu().then(() => renderCart(false));
