import { $, $$, on, fmtINR, openDialog, closeDialog, formatItemsSummary } from './utils.js';
import {
  auth, signInWithEmailAndPassword, onAuthStateChanged, signOut, updatePassword
} from './firebase.js';
import {
  fetchMenu, addMenuItem, updateMenuItem, deleteMenuItem,
  verifyPaymentByCode, getStudent, setStudentBlocked
} from './storage.js';
import {
  db, collection, doc, getDoc, getDocs, query, where, orderBy, limit, updateDoc
} from './firebase.js';

// Admin email used for Firebase Authentication
const ADMIN_EMAIL = 'admin@example.com'; // <-- set to your real admin email

// Elements
const adminApp = $('#adminApp');
const loginView = $('#loginView');

const adminPasswordInput = $('#adminPasswordInput');
const loginBtn = $('#loginBtn');
const logoutBtn = $('#logoutBtn');
const loginError = $('#loginError');

const orderSearch = $('#orderSearch');
const statusFilter = $('#statusFilter');
const refreshOrders = $('#refreshOrders');
const ordersTable = $('#ordersTable');

const verifyCodeInput = $('#verifyCodeInput');
const verifyCodeBtn = $('#verifyCodeBtn');
const verifyResult = $('#verifyResult');

const studentPidInput = $('#studentPidInput');
const checkStudentBtn = $('#checkStudentBtn');
const studentStatus = $('#studentStatus');
const blockStudentBtn = $('#blockStudentBtn');
const unblockStudentBtn = $('#unblockStudentBtn');

const addMenuItemBtn = $('#addMenuItemBtn');
const menuTable = $('#menuTable');

const menuModal = $('#menuModal');
const menuForm = $('#menuForm');
const menuModalTitle = $('#menuModalTitle');
const menuItemId = $('#menuItemId');
const menuName = $('#menuName');
const menuPrice = $('#menuPrice');
const menuImage = $('#menuImage');
const menuAvailable = $('#menuAvailable');
const menuCancelBtn = $('#menuCancelBtn');

// Auth wiring
onAuthStateChanged(auth, (user) => {
  if (user) {
    loginView.hidden = true;
    adminApp.hidden = false;
    loadOrders();
    loadMenu();
  } else {
    adminApp.hidden = true;
    loginView.hidden = false;
  }
});

on(loginBtn, 'click', async () => {
  loginError.hidden = true;
  const pwd = adminPasswordInput.value.trim();
  if (!pwd) return;
  try {
    await signInWithEmailAndPassword(auth, ADMIN_EMAIL, pwd);
  } catch (e) {
    loginError.hidden = false;
  }
});

on(logoutBtn, 'click', async () => {
  await signOut(auth);
});

// Orders
async function loadOrders() {
  ordersTable.innerHTML = 'Loading...';
  const col = collection(db, 'orders');
  let qRef = query(col, orderBy('createdAt', 'desc'), limit(50));
  const qtxt = (orderSearch.value || '').trim().toUpperCase();
  const status = statusFilter.value;

  // Basic filtering combinations
  if (qtxt && status) {
    // try pid+status
    qRef = query(col, where('pid', '==', qtxt), where('status', '==', toInternalStatus(status)), orderBy('createdAt', 'desc'), limit(50));
  } else if (qtxt) {
    // try by pid or code (fallback client filter for code)
    qRef = query(col, where('pid', '==', qtxt), orderBy('createdAt', 'desc'), limit(50));
  } else if (status) {
    qRef = query(col, where('status', '==', toInternalStatus(status)), orderBy('createdAt', 'desc'), limit(50));
  }

  const snap = await getDocs(qRef);
  let rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  // If search query looks like a code, additionally client-filter
  if (qtxt && !rows.length) {
    const allSnap = await getDocs(query(col, orderBy('createdAt', 'desc'), limit(100)));
    rows = allSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(o =>
      o.paymentCode?.toUpperCase() === qtxt || o.pid?.toUpperCase() === qtxt
    );
  }

  // Render table
  ordersTable.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>When</th>
          <th>PID</th>
          <th>Items</th>
          <th>Total</th>
          <th>Status</th>
          <th>Code</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  `;
  const tbody = ordersTable.querySelector('tbody');

  for (const o of rows) {
    const when = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString() : '';
    const items = formatItemsSummary(o.items || []);
    const badgeClass = toExternalBadge(o);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${when}</td>
      <td>${o.pid}</td>
      <td class="small muted">${items}</td>
      <td>₹ ${fmtINR(o.total)}</td>
      <td><span class="status ${badgeClass}">${statusLabel(o)}</span></td>
      <td>${o.paymentCode || ''}</td>
      <td>
        <button class="btn small" data-ready="${o.id}" ${!(o.paymentVerified && o.status !== 'ready' && o.status !== 'fulfilled') ? 'disabled' : ''}>Mark Ready</button>
        <button class="btn small" data-fulfill="${o.id}" ${(o.status !== 'ready') ? 'disabled' : ''}>Fulfill</button>
        <button class="btn danger small" data-delete="${o.id}">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  }
}

function toInternalStatus(external) {
  // Map UI filter to our internal status
  switch (external) {
    case 'PENDING_PAYMENT': return 'placed';
    case 'VERIFIED': return 'verified';
    case 'FULFILLED': return 'fulfilled';
    case 'CANCELLED': return 'cancelled';
    default: return '';
  }
}
function toExternalBadge(o) {
  if (o.status === 'cancelled') return 'CANCELLED';
  if (o.status === 'fulfilled') return 'FULFILLED';
  if (o.status === 'ready') return 'VERIFIED';
  if (o.status === 'verified') return 'VERIFIED';
  return o.paymentVerified ? 'VERIFIED' : 'PENDING_PAYMENT';
}
function statusLabel(o) {
  if (o.status === 'ready') return 'READY';
  if (o.status) return o.status.toUpperCase();
  return toExternalBadge(o);
}

on(refreshOrders, 'click', loadOrders);
on(statusFilter, 'change', loadOrders);
on(orderSearch, 'input', debounce(loadOrders, 300));

on(ordersTable, 'click', async (e) => {
  const btn = e.target;
  const id = btn?.dataset?.ready || btn?.dataset?.fulfill || btn?.dataset?.delete;
  if (!id) return;
  const orderRef = doc(db, 'orders', id);
  const snap = await getDoc(orderRef);
  if (!snap.exists()) return;
  const o = snap.data();
  const stuRef = doc(db, 'students', o.pid, 'orders', id);

  if (btn.dataset.ready) {
    await updateDoc(orderRef, { status: 'ready' });
    await updateDoc(stuRef, { status: 'ready' });
  } else if (btn.dataset.fulfill) {
    await updateDoc(orderRef, { status: 'fulfilled' });
    await updateDoc(stuRef, { status: 'fulfilled' });
  } else if (btn.dataset.delete) {
    if (!confirm('Delete this order?')) return;
    await updateDoc(orderRef, { status: 'cancelled' }); // soft mark before delete (optional)
    // Delete both
    await Promise.all([
      (await import('./firebase.js')).deleteDoc(orderRef),
      (await import('./firebase.js')).deleteDoc(stuRef)
    ]);
  }
  loadOrders();
});

// Verify payment code
on(verifyCodeBtn, 'click', async () => {
  verifyResult.textContent = '';
  const code = (verifyCodeInput.value || '').trim().toUpperCase();
  if (!code) return;
  try {
    const { order } = await verifyPaymentByCode(code);
    verifyResult.textContent = `Payment verified for ${order.pid}`;
    loadOrders();
  } catch (e) {
    verifyResult.textContent = e.message || 'Verification failed.';
  }
});

// Student status
on(checkStudentBtn, 'click', async () => {
  studentStatus.textContent = '';
  const pid = (studentPidInput.value || '').trim().toUpperCase();
  if (!pid) return;
  const stu = await getStudent(pid);
  if (!stu) {
    studentStatus.textContent = 'No record found. Student can place new order.';
    blockStudentBtn.disabled = false;
    unblockStudentBtn.disabled = true;
    blockStudentBtn.onclick = async () => {
      await setStudentBlocked(pid, true);
      studentStatus.textContent = 'Blocked.';
    };
    return;
  }
  studentStatus.textContent = `Blocked: ${stu.blocked ? 'Yes' : 'No'}`;
  blockStudentBtn.disabled = !!stu.blocked;
  unblockStudentBtn.disabled = !stu.blocked;
  blockStudentBtn.onclick = async () => {
    await setStudentBlocked(pid, true);
    studentStatus.textContent = 'Blocked: Yes';
    blockStudentBtn.disabled = true; unblockStudentBtn.disabled = false;
  };
  unblockStudentBtn.onclick = async () => {
    await setStudentBlocked(pid, false);
    studentStatus.textContent = 'Blocked: No';
    blockStudentBtn.disabled = false; unblockStudentBtn.disabled = true;
  };
});

// Menu
async function loadMenu() {
  menuTable.innerHTML = 'Loading...';
  const items = await fetchMenu();
  menuTable.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Name</th><th>Price</th><th>Avail</th><th>Image</th><th>Actions</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  `;
  const tbody = menuTable.querySelector('tbody');
  for (const it of items) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${it.name}</td>
      <td>₹ ${fmtINR(it.price)}</td>
      <td>${it.available ? 'Yes' : 'No'}</td>
      <td class="small muted">${it.imageUrl ? `<a href="${it.imageUrl}" target="_blank">link</a>` : '-'}</td>
      <td>
        <button class="btn small" data-edit="${it.id}">Edit</button>
        <button class="btn small" data-toggle="${it.id}">${it.available ? 'Disable' : 'Enable'}</button>
        <button class="btn danger small" data-del="${it.id}">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  }
}

on(addMenuItemBtn, 'click', () => {
  menuForm.reset();
  menuItemId.value = '';
  menuModalTitle.textContent = 'Add Menu Item';
  menuAvailable.checked = true;
  openDialog(menuModal);
});
on(menuCancelBtn, 'click', () => closeDialog(menuModal));

on(menuForm, 'submit', async (e) => {
  e.preventDefault();
  const payload = {
    name: menuName.value.trim(),
    price: Number(menuPrice.value || 0),
    imageUrl: menuImage.value.trim() || null,
    available: menuAvailable.checked
  };
  if (!payload.name) return;
  try {
    if (menuItemId.value) {
      await updateMenuItem(menuItemId.value, payload);
    } else {
      await addMenuItem(payload);
    }
    closeDialog(menuModal);
    loadMenu();
  } catch (e2) {
    alert('Failed to save item.');
  }
});

on(menuTable, 'click', async (e) => {
  const btn = e.target;
  const editId = btn?.dataset?.edit;
  const delId = btn?.dataset?.del;
  const toggleId = btn?.dataset?.toggle;
  if (editId) {
    // Load doc
    const snap = await getDoc(doc(db, 'menuItems', editId));
    if (!snap.exists()) return;
    const it = snap.data();
    menuItemId.value = editId;
    menuName.value = it.name || '';
    menuPrice.value = Number(it.price || 0);
    menuImage.value = it.imageUrl || '';
    menuAvailable.checked = !!it.available;
    menuModalTitle.textContent = 'Edit Menu Item';
    openDialog(menuModal);
  } else if (toggleId) {
    const snap = await getDoc(doc(db, 'menuItems', toggleId));
    if (!snap.exists()) return;
    const cur = !!snap.data().available;
    await updateMenuItem(toggleId, { available: !cur });
    loadMenu();
  } else if (delId) {
    if (!confirm('Delete this item?')) return;
    await deleteMenuItem(delId);
    loadMenu();
  }
});
