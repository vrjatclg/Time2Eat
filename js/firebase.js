// Firebase initialization and exports (ES modules via CDN)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut,
  updatePassword, EmailAuthProvider, reauthenticateWithCredential
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, onSnapshot, serverTimestamp, runTransaction
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyDUYtoPn2MM6rAkcjk1il5baoRG6vegibA",
  authDomain: "ready2eat-ef71f.firebaseapp.com",
  projectId: "ready2eat-ef71f",
  storageBucket: "ready2eat-ef71f.firebasestorage.app",
  messagingSenderId: "374606696659",
  appId: "1:374606696659:web:3dbf508a2ae2f1a6044426",
  measurementId: "G-W8Q1L1DB8P"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Re-exports
export {
  signInWithEmailAndPassword, onAuthStateChanged, signOut, updatePassword,
  EmailAuthProvider, reauthenticateWithCredential,
  collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, onSnapshot, serverTimestamp, runTransaction
};
