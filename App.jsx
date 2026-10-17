import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, collection, addDoc, updateDoc, deleteDoc, doc, 
  onSnapshot, serverTimestamp, Timestamp, setDoc 
} from 'firebase/firestore';
import { 
  getAuth, 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  signOut 
} from 'firebase/auth';

// --- CONFIGURACIÓN DE FIREBASE ---
const firebaseConfig = {
  apiKey: "AIzaSyATSpw_uzohLwm7zVUk3X_d6EAsDZNZLK0".trim(),
  authDomain: "winnerproduct-crm.firebaseapp.com".trim(),
  projectId: "winnerproduct-crm".trim(),
  storageBucket: "winnerproduct-crm.firebasestorage.app".trim(),
  messagingSenderId: "697988179670".trim(),
  appId: "1:697988179670:web:3910c31426d0d6e4bdcb77".trim()
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'winnerproduct-crm';

// --- CONFIGURACIÓN DE ESTADOS ---
const WINNER_STATUS = {
  pending: { id: 'pending', label: 'Pendiente', color: 'bg-zinc-100 text-zinc-600', activeColor: 'bg-zinc-800 text-white', emoji: '🕒' },
  prepared: { id: 'prepared', label: 'Preparado', color: 'bg-blue-50 text-blue-600', activeColor: 'bg-blue-600 text-white', emoji: '📦' },
  testing: { id: 'testing', label: 'En Testeo', color: 'bg-amber-50 text-amber-600', activeColor: 'bg-amber-500 text-white', emoji: '🧪' },
  approved: { id: 'approved', label: 'Aprobado', color: 'bg-emerald-50 text-emerald-600', activeColor: 'bg-emerald-600 text-white', emoji: '✅' },
  rejected: { id: 'rejected', label: 'Rechazado', color: 'bg-rose-50 text-rose-600', activeColor: 'bg-rose-600 text-white', emoji: '❌' }
};

const IMPORT_STATUS = {
  pending: { id: 'pending', label: 'Pendiente', color: 'bg-zinc-100 text-zinc-600', activeColor: 'bg-zinc-800 text-white', emoji: '⏳' },
  approved: { id: 'approved', label: 'Aprobado', color: 'bg-emerald-50 text-emerald-600', activeColor: 'bg-emerald-600 text-white', emoji: '🛳️' }
};

const IMPORT_STATES_LIST = {
  warehouse: { id: 'warehouse', label: 'EN BODEGA', emoji: '🏭', bgColor: 'bg-slate-100 border-slate-300' },
  portChina: { id: 'portChina', label: 'EN PUERTO CHINA', emoji: '🚢', bgColor: 'bg-blue-100 border-blue-300' },
  seaRoute: { id: 'seaRoute', label: 'EN RUTA MARÍTIMA', emoji: '🌊', bgColor: 'bg-cyan-100 border-cyan-300' },
  portColombia: { id: 'portColombia', label: 'EN PUERTO COLOMBIA', emoji: '⚓', bgColor: 'bg-emerald-100 border-emerald-300' },
  warehouseColombia: { id: 'warehouseColombia', label: 'EN BODEGA COLOMBIA', emoji: '🏚️', bgColor: 'bg-amber-100 border-amber-300' },
  delivered: { id: 'delivered', label: 'ENTREGADO', emoji: '✅', bgColor: 'bg-green-100 border-green-500' }
};

// --- ESTADOS INICIALES ---
const getInitialWinner = () => ({
  type: 'winner',
  name: '', dropiCode: '', supplier: '', description: '',
  costs: { base: 0, freight: 0, fulfillment: 0, commission: 0, cpa: 0, returns: 0, fixed: 0 },
  targetPrice: 0, status: 'pending', rejectionReason: '', image: null, order: 0,
  isWorking: false,
  createdAtText: '',
  testingData: Array(5).fill().map((_, i) => ({ id: i+1, sellerName: '', startDate: '', endDate: '' })),
  upsells: [
    { id: 1, name: '', cost: 0, price: 0, image: null },
    { id: 2, name: '', cost: 0, price: 0, image: null },
    { id: 3, name: '', cost: 0, price: 0, image: null },
    { id: 4, name: '', cost: 0, price: 0, image: null },
    { id: 5, name: '', cost: 0, price: 0, image: null }
  ]
});

const getInitialImport = () => ({
  type: 'import',
  name: '', chineseSupplier: '', dollarRate: 0, prodCostUSD: 0, cbmCostCOP: 0,
  unitsQty: 0, ctnQty: 0, yiwuFreightUSD: 0, status: 'pending', image: null, order: 0,
  isWorking: false,
  createdAtText: '',
  measures: { width: 0, height: 0, length: 0 },
  purchaseDate: '',
  advancePayment: { amount: 0, date: '' },
  totalPayment: { amount: 0, date: '' },
  actualQuantity: 0,
  variables: Array(5).fill().map((_, i) => ({ id: i+1, name: '', qty: 0 })),
  importStatus: 'warehouse'
});

const getInitialProjection = () => ({
  name: '', price: '', productCost: '', freight: '', fulfillment: '', commission: '',
  adSpend: '', cpm: '', ctr: '', loadSpeed: '', conversionRate: '',
  effectiveness: '', returnRate: '', fixedExpenses: '', activeCampaigns: 1
});

// --- AYUDANTES ---
const formatCurrency = (val) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(val || 0);

const getCurrentDateTime = () => {
  const now = new Date();
  const day = now.getDate().toString().padStart(2, '0');
