import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, collection, addDoc, updateDoc, deleteDoc, doc, 
  onSnapshot, serverTimestamp 
} from 'firebase/firestore';

// --- CONFIGURACIÓN DE FIREBASE ORIGINAL ---
const firebaseConfig = {
  apiKey: "AIzaSyATSpw_uzohLwm7zVUk3X_d6EAsDZNZLK0".trim(),
  authDomain: "winnerproduct-crm.firebaseapp.com".trim(),
  projectId: "winnerproduct-crm".trim(),
  storageBucket: "winnerproduct-crm.firebasestorage.app".trim(),
  messagingSenderId: "697988179670".trim(),
  appId: "1:697988179670:web:3910c31426d0d6e4bdcb77".trim()
};

// Inicialización Segura
let db;
let initError = null;
try {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
} catch (e) {
  console.error("Error Firebase:", e);
  initError = e.message;
}

const STATUS_CONFIG = {
  pending: { id: 'pending', label: 'Pendiente', color: 'bg-gray-100 text-gray-600', emoji: '🕒' },
  prepared: { id: 'prepared', label: 'Preparado', color: 'bg-blue-100 text-blue-700', emoji: '📦' },
  testing: { id: 'testing', label: 'En Testeo', color: 'bg-yellow-100 text-yellow-700', emoji: '🧪' },
  approved: { id: 'approved', label: 'Aprobado', color: 'bg-green-100 text-green-700', emoji: '✅' },
  rejected: { id: 'rejected', label: 'Rechazado', color: 'bg-red-100 text-red-700', emoji: '❌' }
};

const INITIAL_PRODUCT_STATE = {
  name: 'Nuevo Producto', description: '',
  costs: { base: 0, freight: 0, fulfillment: 0, commission: 0, cpa: 0, returns: 0, fixed: 0 },
  targetPrice: 0, origin: 'importacion', status: 'pending', rejectionReason: '', image: null,
  upsells: [
    { id: 1, name: '', cost: 0, price: 0, image: null }, 
    { id: 2, name: '', cost: 0, price: 0, image: null },
    { id: 3, name: '', cost: 0, price: 0, image: null },
    { id: 4, name: '', cost: 0, price: 0, image: null },
    { id: 5, name: '', cost: 0, price: 0, image: null },
  ]
};

const formatCurrency = (val) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(val || 0);

const calculateMetrics = (product) => {
  const c = product.costs || {};
  const totalProductCost = (parseFloat(c.base)||0) + (parseFloat(c.freight)||0) + (parseFloat(c.fulfillment)||0) +
    (parseFloat(c.commission)||0) + (parseFloat(c.cpa)||0) + (parseFloat(c.returns)||0) + (parseFloat(c.fixed)||0);
  const productPrice = parseFloat(product.targetPrice) || 0; 
  const productProfit = productPrice - totalProductCost;
  const productMargin = productPrice > 0 ? (productProfit / productPrice) * 100 : 0;
  const upsellsList = product.upsells || [];
  const upsellsCost = upsellsList.reduce((sum, u) => sum + (parseFloat(u.cost)||0), 0);
  const upsellsPrice = upsellsList.reduce((sum, u) => sum + (parseFloat(u.price)||0), 0);
  const bundleTotalCost = totalProductCost + upsellsCost;
  const bundleTotalPrice = productPrice + upsellsPrice;
  const bundleProfit = bundleTotalPrice - bundleTotalCost;
  const bundleMargin = bundleTotalPrice > 0 ? (bundleProfit / bundleTotalPrice) * 100 : 0;
  return { totalProductCost, productProfit, productMargin, bundleTotalCost, bundleTotalPrice, bundleProfit, bundleMargin, upsellsCount: upsellsList.filter(u => u.name && u.price > 0).length };
};

export default function App() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('active'); 
  const [rejectModal, setRejectModal] = useState({ isOpen: false, productId: null, reason: '' });

  useEffect(() => {
    if (initError || !db) return;
    const q = collection(db, 'artifacts', firebaseConfig.projectId, 'public', 'data', 'products');
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const loaded = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      loaded.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setProducts(loaded);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const addProduct = async () => {
    setActiveTab('active');
    try {
      await addDoc(collection(db, 'artifacts', firebaseConfig.projectId, 'public', 'data', 'products'), {
        ...INITIAL_PRODUCT_STATE, createdAt: serverTimestamp()
      });
    } catch (e) { alert("Error: " + e.message); }
  };

  const updateField = async (id, f, v) => {
    await updateDoc(doc(db, 'artifacts', firebaseConfig.projectId, 'public', 'data', 'products', id), { [f]: v });
  };

  const updateCost = async (id, costs, f, v) => {
    await updateDoc(doc(db, 'artifacts', firebaseConfig.projectId, 'public', 'data', 'products', id), { costs: { ...costs, [f]: parseFloat(v) || 0 } });
  };

  const updateUpsell = async (p, uid, f, v) => {
    const newUpsells = p.upsells.map(u => u.id === uid ? { ...u, [f]: v } : u);
    await updateDoc(doc(db, 'artifacts', firebaseConfig.projectId, 'public', 'data', 'products', p.id), { upsells: newUpsells });
  };

  const confirmRejection = async () => {
    if (!rejectModal.productId) return;
    await updateDoc(doc(db, 'artifacts', firebaseConfig.projectId, 'public', 'data', 'products', rejectModal.productId), {
      status: 'rejected',
      rejectionReason: rejectModal.reason
    });
    setRejectModal({ isOpen: false, productId: null, reason: '' });
  };

  const displayedProducts = products.filter(p => activeTab === 'active' ? p.status !== 'rejected' : p.status === 'rejected');

  return (
    <div className="min-h-screen bg-slate-50 p-4 font-sans text-slate-800">
      <div className="max-w-[1600px] mx-auto">
        <header className="flex justify-between items-center mb-6 bg-blue-900 text-white p-6 rounded-2xl shadow-xl">
          <h1 className="text-2xl font-black italic uppercase">Winner Product OS V10</h1>
          <button onClick={addProduct} className="bg-white text-blue-900 px-6 py-2 rounded-xl font-black text-sm uppercase">➕ Nuevo Producto</button>
        </header>

        <div className="flex gap-4 mb-8">
          <button onClick={() => setActiveTab('active')} className={`flex-1 py-3 rounded-xl font-black uppercase text-xs transition-all ${activeTab === 'active' ? 'bg-blue-600 text-white ring-4 ring-blue-100' : 'bg-white text-slate-500 shadow-sm'}`}>📦 Activos ({products.filter(p => p.status !== 'rejected').length})</button>
          <button onClick={() => setActiveTab('rejected')} className={`flex-1 py-3 rounded-xl font-black uppercase text-xs transition-all ${activeTab === 'rejected' ? 'bg-red-600 text-white ring-4 ring-red-100' : 'bg-white text-slate-500 shadow-sm'}`}>❌ Rechazados ({products.filter(p => p.status === 'rejected').length})</button>
        </div>

        <div className="grid grid-cols-1 gap-8">
          {displayedProducts.map(p => {
            const st = STATUS_CONFIG[p.status] || STATUS_CONFIG.pending; 
            const m = calculateMetrics(p);
            return (
              <div key={p.id} className="bg-white rounded-[2rem] shadow-xl overflow-hidden border border-slate-100">
                {p.status === 'rejected' && (
                  <div className="bg-red-50 p-6 border-b border-red-100">
                    <label className="text-[10px] font-black text-red-600 uppercase mb-2 block tracking-widest">Motivo de Descarte:</label>
                    <textarea value={p.rejectionReason} onChange={(e)=>updateField(p.id,'rejectionReason',e.target.value)} rows={2} className="w-full text-sm bg-white border border-red-200 rounded-xl p-3 outline-none resize-none focus:border-red-400" />
                  </div>
                )}
                <div className={`px-8 py-3 flex justify-between items-center border-b ${st.color}`}>
                  <span className="font-black text-xs uppercase tracking-widest">{st.emoji} {st.label}</span>
                </div>
                <div className="flex flex-col xl:flex-row">
                  <div className="xl:w-1/4 p-8 border-r border-slate-50">
                    <div className="aspect-square bg-slate-50 rounded-3xl border-2 border-dashed border-slate-200 mb-6 flex items-center justify-center relative overflow-hidden group">
                      {p.image ? <img src={p.image} className="w-full h-full object-cover" /> : <span className="text-4xl">📸</span>}
                    </div>
                    <input value={p.name} onChange={(e)=>updateField(p.id, 'name', e.target.value)} className="w-full text-2xl font-black bg-transparent outline-none mb-2" />
                  </div>
                  <div className="flex-1 p-8">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                      {['base','cpa','freight','fulfillment','commission','returns','fixed'].map(f => (
                        <div key={f} className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                          <label className="text-[8px] font-black text-slate-400 uppercase block mb-1">{f}</label>
                          <input type="number" value={p.costs?.[f]||''} onChange={(e)=>updateCost(p.id,p.costs,f,e.target.value)} className="w-full bg-transparent font-mono font-bold outline-none" />
                        </div>
                      ))}
                    </div>
                    <div className="bg-slate-900 p-8 rounded-[2.5rem] text-white">
                      <div className="flex justify-between items-end border-b border-white/10 pb-6 mb-6">
                        <div>
                          <label className="text-[10px] text-blue-400 font-black uppercase">Precio Venta</label>
                          <input type="number" value={p.targetPrice||''} onChange={(e)=>updateField(p.id,'targetPrice',e.target.value)} className="bg-transparent text-5xl font-black outline-none w-full" />
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] text-red-400 font-black">Costo Total</p>
                          <p className="text-2xl font-mono font-black">{formatCurrency(m.totalProductCost)}</p>
                        </div>
                      </div>
                      <div className="flex justify-between items-end">
                        <div>
                          <p className="text-[10px] text-slate-400 font-black">Utilidad</p>
                          <p className={`text-4xl font-black ${m.productProfit > 0 ? 'text-green-400' : 'text-red-400'}`}>{formatCurrency(m.productProfit)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] text-slate-400 font-black">Margen</p>
                          <p className="text-6xl font-black italic tracking-tighter">{m.productMargin.toFixed(1)}%</p>
                        </div>
                      </div>
                    </div>
                    <div className="mt-8 flex flex-wrap gap-3">
                      {Object.values(STATUS_CONFIG).map(s => (
                        <button key={s.id} onClick={() => s.id === 'rejected' ? setRejectModal({ isOpen: true, productId: p.id, reason: '' }) : updateField(p.id, 'status', s.id)} className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase border-2 transition-all ${p.status === s.id ? `${s.color} border-current shadow-md` : 'bg-white border-slate-100 text-slate-400'}`}>{s.emoji} {s.label}</button>
                      ))}
                    </div>
                  </div>
                  <div className="xl:w-1/4 bg-blue-50/50 p-8 border-l border-slate-100 flex flex-col">
                    <h3 className="text-xs font-black text-blue-900 uppercase mb-6 tracking-widest">Estrategia Upsells</h3>
                    <div className="space-y-4 mb-8 overflow-y-auto max-h-[300px]">
                      {p.upsells.map(u => (
                        <div key={u.id} className="bg-white p-3 rounded-2xl flex gap-3 border border-blue-100 shadow-sm relative group">
                          <div className="w-12 h-12 bg-slate-50 rounded-xl shrink-0 flex items-center justify-center border border-slate-100 overflow-hidden">{u.image ? <img src={u.image} className="w-full h-full object-cover" /> : <span className="text-xs opacity-20">📸</span>}</div>
                          <div className="flex-1 min-w-0">
                            <input value={u.name} onChange={(e)=>updateUpsell(p,u.id,'name',e.target.value)} className="w-full text-[10px] font-black text-slate-800 bg-transparent outline-none mb-1 truncate" placeholder="Nombre..." />
                            <div className="flex gap-2">
                              <input type="number" value={u.cost||''} onChange={(e)=>updateUpsell(p,u.id,'cost',e.target.value)} className="w-1/2 bg-slate-50 text-[9px] p-1 rounded font-mono" placeholder="Costo" />
                              <input type="number" value={u.price||''} onChange={(e)=>updateUpsell(p,u.id,'price',e.target.value)} className="w-1/2 bg-blue-50 text-[9px] p-1 rounded font-mono font-bold text-blue-700" placeholder="PVP" />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="bg-gradient-to-br from-blue-700 to-indigo-900 rounded-[2rem] p-6 text-white shadow-2xl mt-auto">
                      <div className="flex justify-between items-end mb-1">
                        <p className="text-[10px] text-blue-200 uppercase font-black">Ganancia Bundle</p>
                        <p className="text-2xl font-mono font-bold">{formatCurrency(m.bundleProfit)}</p>
                      </div>
                      <div className="flex justify-between items-center">
                        <p className="text-[10px] text-blue-200 uppercase font-black">Margen Total</p>
                        <span className="bg-white text-blue-700 px-2 py-0.5 rounded-lg text-sm font-black">{m.bundleMargin.toFixed(1)}%</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {rejectModal.isOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-2xl p-8 w-full max-w-md border border-red-100 animate-in zoom-in-95 duration-200">
            <h2 className="text-2xl font-black text-slate-800 uppercase mb-4 tracking-tighter">🚨 Rechazar Producto</h2>
            <p className="text-sm text-slate-500 mb-6 font-medium">Por favor, indica el motivo del rechazo:</p>
            <textarea autoFocus rows={4} value={rejectModal.reason} onChange={(e) => setRejectModal({ ...rejectModal, reason: e.target.value })} className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-4 text-sm focus:outline-none focus:border-red-400 focus:ring-4 focus:ring-red-50 mb-8" placeholder="Escribe el motivo aquí..." />
            <div className="flex gap-4">
              <button onClick={() => setRejectModal({ isOpen: false, productId: null, reason: '' })} className="flex-1 py-4 bg-slate-100 hover:bg-slate-200 text-slate-500 font-black uppercase text-[10px] rounded-xl">Cancelar</button>
              <button onClick={confirmRejection} className="flex-1 py-4 bg-red-600 hover:bg-red-700 text-white font-black uppercase text-[10px] rounded-xl shadow-lg shadow-red-200 transition-all active:scale-95">Rechazar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
