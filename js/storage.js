// Firestore data layer (no localStorage)
// Provides CRUD helpers used by student.js and admin.js
import {
  db, auth,
  collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, serverTimestamp, runTransaction
} from './firebase.js';

// Collections
const colMenu = () => collection(db, 'menuItems');
const colOrders = () => collection(db, 'orders');
const docStudent = (pid) => doc(db, 'students', pid);
const colStudentOrders = (pid) => collection(db, 'students', pid, 'orders');
const docStudentCart = (pid) => doc(db, 'students', pid, 'cart', 'current');
const docPayCode = (code) => doc(db, 'paymentCodes', code);

// Menu
export async function fetchMenu() {
  const snap = await getDocs(query(colMenu(), orderBy('name')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
export async function addMenuItem(item) {
  const now = serverTimestamp();
  const ref = await addDoc(colMenu(), { ...item, available: !!item.available, createdAt: now, updatedAt: now });
  return ref.id;
}
export async function updateMenuItem(id, patch) {
  return updateDoc(doc(db, 'menuItems', id), { ...patch, updatedAt: serverTimestamp() });
}
export async function deleteMenuItem(id) {
  return deleteDoc(doc(db, 'menuItems', id));
}

// Students
export async function getStudent(pid) {
  const snap = await getDoc(docStudent(pid));
  return snap.exists() ? { id: pid, ...snap.data() } : null;
}
export async function ensureStudent(pid) {
  await setDoc(docStudent(pid), { blocked: false, updatedAt: serverTimestamp() }, { merge: true });
}
export async function setStudentBlocked(pid, blocked) {
  await setDoc(docStudent(pid), { blocked, updatedAt: serverTimestamp() }, { merge: true });
}

// Cart persistence (Firestore)
export async function getCart(pid) {
  const snap = await getDoc(docStudentCart(pid));
  if (!snap.exists()) return {};
  return snap.data().items || {};
}
export async function setCart(pid, itemsMap) {
  await setDoc(docStudentCart(pid), { items: itemsMap, updatedAt: serverTimestamp() }, { merge: true });
}
export async function clearCart(pid) {
  await setCart(pid, {});
}

// Orders
export async function placeOrder({ pid, items }) {
  const total = items.reduce((s, it) => s + it.price * it.quantity, 0);
  const paymentCode = await generateUniquePaymentCode();
  const base = {
    pid, items, total,
    status: 'placed',
    paymentCode,
    paymentVerified: false,
    createdAt: serverTimestamp()
  };
  const topRef = await addDoc(colOrders(), base);
  await setDoc(doc(db, 'students', pid, 'orders', topRef.id), { ...base, orderId: topRef.id });
  await ensureStudent(pid);
  await clearCart(pid);
  return { id: topRef.id, ...base };
}

export async function listOrdersByPid(pid, limitN = 20) {
  const snap = await getDocs(query(colStudentOrders(pid), orderBy('createdAt', 'desc'), limit(limitN)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function cancelOrder(pid, orderId) {
  const stuRef = doc(db, 'students', pid, 'orders', orderId);
  const topRef = doc(db, 'orders', orderId);
  const now = serverTimestamp();

  // Guard: only if status is 'placed' and not verified
  const cur = await getDoc(stuRef);
  if (!cur.exists()) throw new Error('Order not found');
  const o = cur.data();
  if (o.status !== 'placed' || o.paymentVerified) throw new Error('Order not cancellable');

  await updateDoc(stuRef, { status: 'cancelled', cancelledAt: now });
  await updateDoc(topRef, { status: 'cancelled', cancelledAt: now });
}

export async function verifyPaymentByCode(code) {
  // Find order with this code
  const snap = await getDocs(query(colOrders(), where('paymentCode', '==', code), limit(1)));
  if (snap.empty) throw new Error('Invalid code');
  const d = snap.docs[0];
  const orderId = d.id;
  const order = d.data();
  if (order.paymentVerified) return { orderId, order }; // already verified
  await updateDoc(doc(db, 'orders', orderId), { paymentVerified: true, status: 'verified' });
  await updateDoc(doc(db, 'students', order.pid, 'orders', orderId), { paymentVerified: true, status: 'verified' });
  return { orderId, order: { ...order, paymentVerified: true, status: 'verified' } };
}

// Payment codes
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randCode(len = 6) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}
export async function generateUniquePaymentCode() {
  for (let i = 0; i < 10; i++) {
    const code = randCode();
    try {
      await runTransaction(db, async (tx) => {
        const ref = docPayCode(code);
        const snap = await tx.get(ref);
        if (snap.exists()) throw new Error('collision');
        tx.set(ref, { createdAt: serverTimestamp(), orderId: null });
      });
      return code;
    } catch {
      // try next
    }
  }
  throw new Error('Could not generate payment code, try again.');
}

// Misuse tracking (cancellations in last 24h)
export async function countCancellations24h(pid) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const snap = await getDocs(query(
    colStudentOrders(pid),
    where('status', '==', 'cancelled'),
    where('createdAt', '>=', since)
  ));
  return snap.size;
}
