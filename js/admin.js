import {
  auth, signInWithEmailAndPassword, onAuthStateChanged, signOut,
  db, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, onSnapshot, serverTimestamp,
  // storage
  storage, storageRef, uploadBytes, getDownloadURL
} from './firebase.js';

// Views and nav
const loginView = document.getElementById('loginView');
const ordersView = document.getElementById('ordersView');
const menuAdminView = document.getElementById('menuAdminView');
const studentsAdminView = document.getElementById('studentsAdminView');

const navOrdersBtn = document.getElementById('navOrdersBtn');
const navMenuBtn = document.getElementById('navMenuBtn');
const navStudentsBtn = document.getElementById('navStudentsBtn');
const signOutBtn = document.getElementById('signOutBtn');

// Login
const adminLoginForm = document.getElementById('adminLoginForm');
const adminEmail = document.getElementById('adminEmail');
const adminPassword = document.getElementById('adminPassword');
const loginMsg = document.getElementById('loginMsg');

// Orders elements
const searchPidInput = document.getElementById('searchPidInput');
const statusFilter = document.getElementById('statusFilter');
const refreshOrdersBtn = document.getElementById('refreshOrdersBtn');
const ordersAdminList = document.getElementById('ordersAdminList');

const verifyForm = document.getElementById('verifyForm');
const verifyCodeInput = document.getElementById('verifyCodeInput');
const verifyMsg = document.getElementById('verifyMsg');

// Menu elements
const newItemForm = document.getElementById('newItemForm');
const newItemName = document.getElementById('newItemName');
const newItemPrice = document.getElementById('newItemPrice');
const newItemImageUrl = document.getElementById('newItemImageUrl');
const newItemImageFile = document.getElementById('newItemImageFile');
const menuAdminGrid = document.getElementById('menuAdminGrid');

// Students elements
const studentLookupForm = document.getElementById('studentLookupForm');
const studentPidInput = document.getElementById('studentPidInput');
const studentInfo = document.getElementById('studentInfo');
const studentInfoPid = document.getElementById('studentInfoPid');
const studentInfoBlocked = document.getElementById('studentInfoBlocked');
const studentInfoCancels = document.getElementById('studentInfoCancels');
const blockStudentBtn = document.getElementById('blockStudentBtn');
const unblockStudentBtn = document.getElementById('unblockStudentBtn');

function showSection(section) {
  [loginView, ordersView, menuAdminView, studentsAdminView].forEach(s => s.style.display = 'none');
  section.style.display = 'block';
}

navOrdersBtn.addEventListener('click', () => {
  navOrdersBtn.classList.add('active');
  navMenuBtn.classList.remove('active');
  navStudentsBtn.classList.remove('active');
  showSection(ordersView);
  loadOrders();
});
navMenuBtn.addEventListener('click', () => {
  navMenuBtn.classList.add('active');
  navOrdersBtn.classList.remove('active');
  navStudentsBtn.classList.remove('active');
  showSection(menuAdminView);
});
navStudentsBtn.addEventListener('click', () => {
  navStudentsBtn.classList.add('active');
  navOrdersBtn.classList.remove('active');
  navMenuBtn.classList.remove('active');
  showSection(studentsAdminView);
});

// Auth
adminLoginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginMsg.textContent = '';
  try {
    await signInWithEmailAndPassword(auth, adminEmail.value.trim(), adminPassword.value.trim());
  } catch (err) {
    console.error(err);
    loginMsg.textContent = 'Sign-in failed. Check credentials.';
  }
});

signOutBtn.addEventListener('click', async () => {
  await signOut(auth);
});

onAuthStateChanged(auth, (user) => {
  if (user) {
    signOutBtn.style.display = 'inline-block';
    navOrdersBtn.classList.add('active');
    navMenuBtn.classList.remove('active');
    navStudentsBtn.classList.remove('active');
    showSection(ordersView);
    loadOrders();
    startMenuWatcher();
  } else {
    signOutBtn.style.display = 'none';
    showSection(loginView);
  }
});

// Orders loading
async function loadOrders() {
  ordersAdminList.innerHTML = 'Loading...';
  let qRef = query(collection(db, 'orders'), orderBy('createdAt', 'desc'), limit(50));
  const pid = searchPidInput.value.trim().toUpperCase();
  const status = statusFilter.value;
  if (pid && status) {
    qRef = query(collection(db, 'orders'),
      where('pid', '==', pid),
      where('status', '==', status),
      orderBy('createdAt', 'desc'),
      limit(50)
    );
  } else if (pid) {
    qRef = query(collection(db, 'orders'),
      where('pid', '==', pid),
      orderBy('createdAt', 'desc'),
      limit(50)
    );
  } else if (status) {
    qRef = query(collection(db, 'orders'),
      where('status', '==', status),
      orderBy('createdAt', 'desc'),
      limit(50)
    );
  }

  const snap = await getDocs(qRef);
  if (snap.empty) {
    ordersAdminList.innerHTML = '<div class="muted">No orders.</div>';
    return;
  }
  ordersAdminList.innerHTML = '';
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
        <div><strong>${o.pid}</strong> • ${o.id}</div>
        <div class="order-status ${statusClass}">${o.status}${o.paymentVerified ? ' • paid' : ''}</div>
      </div>
      <div class="row"><span>${itemsHtml}</span><strong>₹${o.total?.toFixed?.(2) || o.total}</strong></div>
      <div class="row"><span>Code: <strong>${o.paymentCode}</strong></span><span>${o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString() : ''}</span></div>
      <div class="actions">
        <button class="btn btn-primary" data-markready="${o.id}" ${!(o.paymentVerified && o.status !== 'ready' && o.status !== 'fulfilled') ? 'disabled' : ''}>Mark Ready</button>
        <button class="btn btn-secondary" data-fulfill="${o.id}" ${(o.status !== 'ready') ? 'disabled' : ''}>Mark Fulfilled</button>
        <button class="btn btn-danger" data-delete="${o.id}">Delete</button>
      </div>
    `;
    ordersAdminList.appendChild(card);
  });
}

refreshOrdersBtn.addEventListener('click', loadOrders);
searchPidInput.addEventListener('change', loadOrders);
statusFilter.addEventListener('change', loadOrders);

ordersAdminList.addEventListener('click', async (e) => {
  const id = e.target?.dataset?.markready || e.target?.dataset?.fulfill || e.target?.dataset?.delete;
  if (!id) return;
  const orderRef = doc(db, 'orders', id);
  const orderSnap = await getDoc(orderRef);
  if (!orderSnap.exists()) return;
  const order = orderSnap.data();
  const studentOrderRef = doc(db, 'students', order.pid, 'orders', id);

  if (e.target?.dataset?.markready) {
    await updateDoc(orderRef, { status: 'ready' });
    await updateDoc(studentOrderRef, { status: 'ready' });
    loadOrders();
  } else if (e.target?.dataset?.fulfill) {
    await updateDoc(orderRef, { status: 'fulfilled' });
    await updateDoc(studentOrderRef, { status: 'fulfilled' });
    loadOrders();
  } else if (e.target?.dataset?.delete) {
    if (!confirm('Delete this order?')) return;
    await deleteDoc(orderRef);
    await deleteDoc(studentOrderRef);
    loadOrders();
  }
});

// Verify payment code
verifyForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  verifyMsg.textContent = '';
  const code = verifyCodeInput.value.trim().toUpperCase();
  if (!code) return;
  try {
    const qRef = query(collection(db, 'orders'), where('paymentCode', '==', code), limit(1));
    const snap = await getDocs(qRef);

    if (snap.empty) {
      verifyMsg.textContent = 'Invalid code.';
      return;
    }

    const oSnap = snap.docs[0];
    const orderId = oSnap.id;
    const order = oSnap.data();

    if (order.paymentVerified) {
      verifyMsg.textContent = 'Already verified.';
      return;
    }

    const orderRef = doc(db, 'orders', orderId);
    await updateDoc(orderRef, { paymentVerified: true, status: 'verified' });

    const studentOrderRef = doc(db, 'students', order.pid, 'orders', orderId);
    await updateDoc(studentOrderRef, { paymentVerified: true, status: 'verified' });

    verifyMsg.textContent = `Payment verified for PID ${order.pid}.`;
    loadOrders();
  } catch (err) {
    console.error(err);
    verifyMsg.textContent = 'Verification failed. Try again.';
  }
});

// Menu management
function startMenuWatcher() {
  const qRef = query(collection(db, 'menuItems'), orderBy('name'));
  onSnapshot(qRef, (snap) => {
    menuAdminGrid.innerHTML = '';
    snap.forEach(docSnap => {
      const item = { id: docSnap.id, ...docSnap.data() };
      const card = document.createElement('div');
      card.className = 'card item-card';
      card.innerHTML = `
        <img src="${item.imageUrl || 'https://picsum.photos/seed/' + encodeURIComponent(item.name) + '/600/400'}" alt="${item.name}" />
        <div class="row">
          <strong contenteditable="true" data-name="${item.id}">${item.name}</strong>
          <input class="price-input" data-price="${item.id}" type="number" min="0" value="${item.price}" />
        </div>
        <div class="row">
          <span class="muted">${item.available ? 'Available' : 'Unavailable'}</span>
          <div class="actions">
            <input type="file" accept="image/*" data-imgfile="${item.id}" />
            <button class="btn btn-secondary" data-upload="${item.id}">Upload Image</button>
            <button class="btn btn-secondary" data-toggle="${item.id}">${item.available ? 'Mark Unavailable' : 'Mark Available'}</button>
            <button class="btn btn-primary" data-save="${item.id}">Save</button>
            <button class="btn btn-danger" data-del="${item.id}">Delete</button>
          </div>
        </div>
      `;
      menuAdminGrid.appendChild(card);
    });
  });
}

async function uploadMenuImage(file, itemId, itemName) {
  const cleanName = (itemName || 'item').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();
  const path = `menuImages/${itemId}-${Date.now()}-${cleanName}`;
  const ref = storageRef(storage, path);
  const snap = await uploadBytes(ref, file);
  const url = await getDownloadURL(snap.ref);
  return url;
}

menuAdminGrid.addEventListener('click', async (e) => {
  const id = e.target?.dataset?.toggle || e.target?.dataset?.save || e.target?.dataset?.del || e.target?.dataset?.upload;
  if (!id) return;

  const card = e.target.closest('.item-card');
  const nameEl = card.querySelector(`[data-name="${id}"]`);
  const priceEl = card.querySelector(`[data-price="${id}"]`);

  if (e.target?.dataset?.upload) {
    const fileInput = card.querySelector(`[data-imgfile="${id}"]`);
    const file = fileInput?.files?.[0];
    if (!file) {
      alert('Choose an image file first.');
      return;
    }
    const refDoc = doc(db, 'menuItems', id);
    const snap = await getDoc(refDoc);
    const item = snap.exists() ? snap.data() : { name: nameEl.textContent.trim() || 'Item' };
    const url = await uploadMenuImage(file, id, item.name);
    await updateDoc(refDoc, { imageUrl: url, updatedAt: serverTimestamp() });
    alert('Image uploaded.');
    return;
  }

  if (e.target?.dataset?.toggle) {
    const ref = doc(db, 'menuItems', id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const { available = true } = snap.data();
    await updateDoc(ref, { available: !available, updatedAt: serverTimestamp() });
  } else if (e.target?.dataset?.save) {
    const ref = doc(db, 'menuItems', id);
    const newName = nameEl.textContent.trim();
    const newPrice = Number(priceEl.value);
    await updateDoc(ref, { name: newName, price: newPrice, updatedAt: serverTimestamp() });
    alert('Saved.');
  } else if (e.target?.dataset?.del) {
    if (!confirm('Delete this menu item?')) return;
    await deleteDoc(doc(db, 'menuItems', id));
  }
});

newItemForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = newItemName.value.trim();
  const price = Number(newItemPrice.value);
  const imageUrlText = newItemImageUrl.value.trim();
  const file = newItemImageFile.files?.[0] || null;
  if (!name || !Number.isFinite(price)) return;

  // Create empty item first to get ID if we need to upload file
  const base = { name, price, imageUrl: imageUrlText || null, available: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
  let docRef = await addDoc(collection(db, 'menuItems'), base);

  if (file) {
    const url = await uploadMenuImage(file, docRef.id, name);
    await updateDoc(docRef, { imageUrl: url, updatedAt: serverTimestamp() });
  }

  newItemName.value = '';
  newItemPrice.value = '';
  newItemImageUrl.value = '';
  newItemImageFile.value = '';
});
