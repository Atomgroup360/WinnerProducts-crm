import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, collection, addDoc, updateDoc, deleteDoc, doc, 
  onSnapshot, serverTimestamp, query 
} from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';

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
const db = getFirestore(app);
const auth = getAuth(app);

const STATUS_CONFIG = {
  pending: { id: 'pending', label: 'Pendiente', color: 'bg-zinc-100 text-zinc-600', activeColor: 'bg-zinc-800 text-white', emoji: '🕒' },
  prepared: { id: 'prepared', label: 'Preparado', color: 'bg-blue-50 text-blue-600', activeColor: 'bg-blue-600 text-white', emoji: '📦' },
  testing: { id: 'testing', label: 'En Testeo', color: 'bg-amber-50 text-amber-600', activeColor: 'bg-amber-500 text-white', emoji: '🧪' },
  approved: { id: 'approved', label: 'Aprobado', color: 'bg-emerald-50 text-emerald-600', activeColor: 'bg-emerald-600 text-white', emoji: '✅' },
  rejected: { id: 'rejected', label: 'Rechazado', color: 'bg-rose-50 text-rose-600', activeColor: 'bg-rose-600 text-white', emoji: '❌' }
};

const INITIAL_PRODUCT_STATE = {
  name: '',
  description: '',
  costs: { base: 0, freight: 0, fulfillment: 0, commission: 0, cpa: 0, returns: 0, fixed: 0 },
  targetPrice: 0,
  origin: 'importacion',
  status: 'pending',
  rejectionReason: '',
  image: null,
  order: 0, 
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
  const totalBaseCost = (parseFloat(c.base)||0) + (parseFloat(c.freight)||0) + (parseFloat(c.fulfillment)||0) +
    (parseFloat(c.commission)||0) + (parseFloat(c.cpa)||0) + (parseFloat(c.returns)||0) + (parseFloat(c.fixed)||0);
  const basePrice = parseFloat(product.targetPrice) || 0; 
  const upsellsList = product.upsells || [];
  const upsellsCostTotal = upsellsList.reduce((sum, u) => sum + (parseFloat(u.cost)||0), 0);
  const upsellsPriceTotal = upsellsList.reduce((sum, u) => sum + (parseFloat(u.price)||0), 0);
  
  const combinedTotalCost = totalBaseCost + upsellsCostTotal;
  const combinedTotalPrice = basePrice + upsellsPriceTotal;
  const finalProfit = combinedTotalPrice - combinedTotalCost;
  const finalMargin = combinedTotalPrice > 0 ? (finalProfit / combinedTotalPrice) * 100 : 0;
  
  return { 
    totalBaseCost, 
    basePrice,
    combinedTotalCost, 
    combinedTotalPrice, 
    finalProfit, 
    finalMargin, 
    upsellsCount: upsellsList.filter(u => u.name && (u.price > 0 || u.cost > 0)).length 
  };
};

export default function App() {
  const [user, setUser] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('pending'); 
  const [expandedBundles, setExpandedBundles] = useState({});
  const [rejectModal, setRejectModal] = useState({ isOpen: false, productId: null, reason: '' });
  const [isCreating, setIsCreating] = useState(false);
  const [newProduct, setNewProduct] = useState(INITIAL_PRODUCT_STATE);

  useEffect(() => {
    signInAnonymously(auth).catch(console.error);
    return onAuthStateChanged(auth, setUser);
  }, []);

  useEffect(() => {
    if (!user) return;
    const q = collection(db, 'artifacts', 'winnerproduct-crm', 'public', 'data', 'products');
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const loaded = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      loaded.sort((a, b) => (a.order || 0) - (b.order || 0));
      setProducts(loaded);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [user]);

  const handleSaveNewProduct = async () => {
    if (!newProduct.name) return;
    const timestamp = Date.now();
    const regNumber = `REG-${(products.length + 1).toString().padStart(3, '0')}`;
    
    try {
      await addDoc(collection(db, 'artifacts', 'winnerproduct-crm', 'public', 'data', 'products'), {
        ...newProduct, 
        regNumber,
        order: timestamp, 
        createdAt: serverTimestamp(), 
        createdBy: user.uid
      });
      setIsCreating(false);
      setNewProduct(INITIAL_PRODUCT_STATE);
      setActiveTab('pending');
    } catch (e) { console.error(e); }
  };

  const updateField = async (id, f, v) => {
    await updateDoc(doc(db, 'artifacts', 'winnerproduct-crm', 'public', 'data', 'products', id), { [f]: v });
  };

  const updateCost = async (id, costs, f, v) => {
    await updateDoc(doc(db, 'artifacts', 'winnerproduct-crm', 'public', 'data', 'products', id), { 
      costs: { ...costs, [f]: parseFloat(v) || 0 } 
    });
  };

  const updateUpsell = async (p, uid, f, v) => {
    const newUpsells = p.upsells.map(u => u.id === uid ? { ...u, [f]: v } : u);
    await updateDoc(doc(db, 'artifacts', 'winnerproduct-crm', 'public', 'data', 'products', p.id), { upsells: newUpsells });
  };

  const resetUpsell = async (product, bundleId) => {
    const clearedUpsells = product.upsells.map(u => 
      u.id === bundleId ? { id: bundleId, name: '', cost: 0, price: 0, image: null } : u
    );
    try {
      await updateDoc(doc(db, 'artifacts', 'winnerproduct-crm', 'public', 'data', 'products', product.id), { 
        upsells: clearedUpsells 
      });
    } catch (e) { console.error(e); }
  };

  const deleteProduct = async (id) => {
    if (window.confirm('¿Borrar producto permanentemente?')) {
      try { await deleteDoc(doc(db, 'artifacts', 'winnerproduct-crm', 'public', 'data', 'products', id)); } catch (e) { console.error(e); }
    }
  };

  const moveProduct = async (productId, direction) => {
    const currentTabList = products.filter(p => p.status === activeTab);
    const index = currentTabList.findIndex(p => p.id === productId);
    const targetIndex = index + direction;

    if (targetIndex >= 0 && targetIndex < currentTabList.length) {
      const productA = currentTabList[index];
      const productB = currentTabList[targetIndex];
      let orderA = productA.order || (Date.now() - 1000);
      let orderB = productB.order || Date.now();
      if (orderA === orderB) orderB = orderA + 1;

      try {
        await updateDoc(doc(db, 'artifacts', 'winnerproduct-crm', 'public', 'data', 'products', productA.id), { order: orderB });
        await updateDoc(doc(db, 'artifacts', 'winnerproduct-crm', 'public', 'data', 'products', productB.id), { order: orderA });
      } catch (err) { console.error("Error al mover:", err); }
    }
  };

  const toggleBundles = (id) => {
    setExpandedBundles(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleImage = (e, target = "new", upsellId = null) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (target === "new") {
          if (upsellId) {
            const up = newProduct.upsells.map(u => u.id === upsellId ? {...u, image: reader.result} : u);
            setNewProduct({...newProduct, upsells: up});
          } else {
            setNewProduct({...newProduct, image: reader.result});
          }
        } else {
          if (upsellId) {
            const up = target.upsells.map(u => u.id === upsellId ? {...u, image: reader.result} : u);
            updateDoc(doc(db, 'artifacts', 'winnerproduct-crm', 'public', 'data', 'products', target.id), { upsells: up });
          } else {
            updateField(target.id, 'image', reader.result);
          }
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const confirmRejection = async () => {
    if (!rejectModal.productId) return;
    await updateDoc(doc(db, 'artifacts', 'winnerproduct-crm', 'public', 'data', 'products', rejectModal.productId), {
      status: 'rejected',
      rejectionReason: rejectModal.reason
    });
    setRejectModal({ isOpen: false, productId: null, reason: '' });
    setActiveTab('rejected');
  };

  if (isCreating) {
    return (
      <div className="min-h-screen bg-[#f8fafc] p-4 md:p-8 font-sans animate-in fade-in duration-500">
        <div className="max-w-4xl mx-auto bg-white shadow-2xl rounded-[1.5rem] md:rounded-[2.5rem] overflow-hidden border border-zinc-200/50">
          <header className="bg-zinc-900 p-6 md:p-8 text-white flex justify-between items-center">
            <div>
              <h2 className="text-xl md:text-2xl font-bold tracking-tight text-white">Configurar Nuevo Producto</h2>
              <p className="text-zinc-400 text-[10px] font-bold mt-1 tracking-widest">SISTEMA DE REGISTRO SECUENCIAL</p>
            </div>
            <button onClick={() => setIsCreating(false)} className="bg-white/10 hover:bg-white/20 px-4 py-2 rounded-full font-bold text-[10px] transition-all uppercase tracking-widest text-white">CERRAR</button>
          </header>
          
          <div className="p-6 md:p-10 space-y-8 md:space-y-10">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12 text-zinc-900">
              <div className="space-y-6">
                <div className="aspect-square bg-zinc-50 rounded-[1.5rem] md:rounded-[2rem] border-2 border-dashed border-zinc-200 relative flex items-center justify-center overflow-hidden shadow-inner group cursor-pointer">
                  {newProduct.image ? <img src={newProduct.image} className="w-full h-full object-cover"/> : <span className="text-zinc-400 font-bold text-[10px] uppercase">Imagen Principal</span>}
                  <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e)=>handleImage(e, "new")}/>
                </div>
                <input value={newProduct.name} onChange={(e)=>setNewProduct({...newProduct, name: e.target.value})} className="w-full border-b border-zinc-200 pb-2 font-bold text-xl md:text-2xl outline-none focus:border-zinc-900 transition-colors text-zinc-900" placeholder="Nombre comercial..."/>
                <textarea value={newProduct.description} onChange={(e)=>setNewProduct({...newProduct, description: e.target.value})} rows={3} className="w-full bg-zinc-50 border border-zinc-100 rounded-xl md:rounded-2xl p-4 text-sm resize-none outline-none focus:ring-2 focus:ring-zinc-200 text-zinc-600" placeholder="Estrategia de venta..."/>
              </div>

              <div className="space-y-6 md:space-y-8">
                <div className="bg-zinc-50 p-5 md:p-6 rounded-2xl md:rounded-3xl border border-zinc-100 shadow-sm">
                  <h3 className="text-[10px] font-black uppercase text-zinc-400 mb-4 md:mb-6 tracking-[0.2em]">Estructura de Costos</h3>
                  <div className="grid grid-cols-2 gap-3 md:gap-4">
                    {[{k:'base',l:'Producto'}, {k:'cpa',l:'Ads'}, {k:'freight',l:'Flete'}, {k:'fulfillment',l:'Log.'}, {k:'commission',l:'Com.'}, {k:'returns',l:'Dev.'}, {k:'fixed',l:'Fijos'}].map(f=>(
                      <div key={f.k}>
                        <label className="text-[8px] font-bold text-zinc-500 uppercase block mb-1">{f.l}</label>
                        <input type="number" onChange={(e)=>setNewProduct({...newProduct, costs: {...newProduct.costs, [f.k]: parseFloat(e.target.value)||0}})} className="w-full bg-white border border-zinc-200 rounded-lg p-2 text-sm font-mono outline-none focus:ring-2 focus:ring-zinc-900/5 text-zinc-700" placeholder="0"/>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-zinc-900 p-5 md:p-6 rounded-2xl md:rounded-3xl text-white shadow-xl">
                  <label className="text-[9px] font-bold uppercase text-zinc-400 mb-2 block tracking-widest leading-none">PVP Individual Objetivo</label>
                  <div className="flex items-center gap-2">
                    <span className="text-xl font-medium opacity-40">$</span>
                    <input type="number" onChange={(e)=>setNewProduct({...newProduct, targetPrice: parseFloat(e.target.value)||0})} className="w-full bg-transparent border-b border-zinc-700 text-3xl md:text-4xl font-bold outline-none text-white" placeholder="0"/>
                  </div>
                </div>
              </div>
            </div>
            <button onClick={handleSaveNewProduct} className="w-full bg-zinc-900 hover:bg-black text-white font-bold py-5 md:py-6 rounded-2xl md:rounded-[1.8rem] text-sm md:text-lg shadow-2xl transition-all uppercase tracking-[0.2em] active:scale-[0.98]">Guardar y Asignar Registro</button>
          </div>
        </div>
      </div>
    );
  }

  const displayedProducts = products.filter(p => p.status === activeTab);

  return (
    <div className="min-h-screen bg-[#f1f5f9] p-3 md:p-8 font-sans text-zinc-900">
      <div className="max-w-[1400px] mx-auto">
        <header className="flex flex-col md:flex-row justify-between items-center mb-6 md:mb-10 gap-4 md:gap-6 bg-white p-5 md:p-6 rounded-[1.5rem] md:rounded-[2rem] shadow-sm border border-zinc-200/50">
          <div className="flex items-center gap-4 w-full md:w-auto">
            <div className="w-10 h-10 md:w-12 md:h-12 bg-zinc-900 rounded-xl md:rounded-2xl flex items-center justify-center text-white text-lg shadow-lg shadow-zinc-200 shrink-0">💎</div>
            <div>
              <h1 className="text-xl md:text-2xl font-black tracking-tighter flex items-center gap-2 uppercase italic text-zinc-900">WINNER OS <span className="text-[9px] font-normal bg-zinc-900 text-white px-2 py-0.5 rounded-full not-italic tracking-normal">V13.5</span></h1>
              <p className="text-[9px] text-zinc-400 mt-0.5 uppercase font-bold tracking-[0.2em]">{loading ? 'Conectando...' : 'Base de Datos Activa'}</p>
            </div>
          </div>
          <button onClick={() => setIsCreating(true)} className="bg-zinc-900 hover:bg-black text-white w-full md:w-auto px-8 py-3.5 rounded-xl md:rounded-2xl shadow-xl font-bold text-[10px] md:text-xs transition-all uppercase tracking-widest active:scale-95 group">
            ➕ Nuevo Producto
          </button>
        </header>

        <div className="flex flex-wrap gap-2 mb-6 md:mb-10 overflow-x-auto pb-2 scrollbar-hide">
          {Object.values(STATUS_CONFIG).map((config) => (
            <button 
              key={config.id} 
              onClick={() => setActiveTab(config.id)} 
              className={`px-4 md:px-6 py-2.5 md:py-3 rounded-xl md:rounded-2xl font-bold text-[10px] md:text-[11px] whitespace-nowrap uppercase transition-all tracking-wider ${activeTab === config.id ? `${config.activeColor} shadow-lg scale-105` : 'bg-white text-zinc-400 hover:bg-zinc-50 border border-zinc-200/50'}`}
            >
              {config.emoji} {config.label} <span className="ml-1 opacity-50">({products.filter(p => p.status === config.id).length})</span>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-6 md:gap-10">
          {displayedProducts.map((p, idx) => {
            const st = STATUS_CONFIG[p.status]; 
            const m = calculateMetrics(p);
            const isBundlesExpanded = expandedBundles[p.id];
            
            return (
              <div key={p.id} className="bg-white rounded-[1.5rem] md:rounded-[2.5rem] shadow-sm border border-zinc-200/50 overflow-hidden transition-all hover:shadow-xl group animate-in slide-in-from-bottom-4 duration-500">
                {p.status === 'rejected' && (
                  <div className="bg-rose-50/50 p-4 md:p-6 border-b border-rose-100/50">
                    <label className="text-[8px] font-black text-rose-600 uppercase block mb-1 tracking-widest leading-none">Feedback de Rechazo:</label>
                    <textarea value={p.rejectionReason} onChange={(e)=>updateField(p.id,'rejectionReason',e.target.value)} rows={2} className="w-full text-xs md:text-sm bg-white/50 border border-rose-200 rounded-xl md:rounded-2xl p-3 md:p-4 text-rose-900 font-medium outline-none resize-none focus:border-rose-400 shadow-inner" placeholder="Motivo..."/>
                  </div>
                )}
                
                <div className={`px-4 md:px-8 py-3 md:py-4 flex flex-col sm:flex-row justify-between items-start sm:items-center border-b gap-3 ${activeTab === st.id ? 'bg-zinc-50/50' : 'bg-zinc-50'}`}>
                   <div className="flex flex-wrap items-center gap-3 md:gap-6 w-full sm:w-auto">
                     <div className="bg-zinc-900 text-white px-3 py-1 rounded-lg text-[9px] md:text-[10px] font-black tracking-widest shadow-sm">
                       {p.regNumber || 'REG-000'}
                     </div>
                     <span className="font-bold text-[10px] md:text-[11px] uppercase tracking-[0.1em] md:tracking-[0.2em] text-zinc-600">{st.emoji} {st.label}</span>
                     
                     <div className="flex items-center gap-1.5 md:gap-2 bg-white rounded-xl p-1 shadow-inner border border-zinc-100">
                        <button onClick={() => moveProduct(p.id, -1)} disabled={idx === 0} className={`w-7 h-7 md:w-8 md:h-8 flex items-center justify-center hover:bg-zinc-900 hover:text-white rounded-lg md:rounded-xl transition-all ${idx === 0 ? 'opacity-10' : 'active:scale-75'}`}>
                            <svg className="w-3.5 h-3.5 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3"><path d="M5 15l7-7 7 7"/></svg>
                        </button>
                        <span className="text-[9px] md:text-[10px] font-black text-zinc-400 px-1 select-none">#{idx + 1}</span>
                        <button onClick={() => moveProduct(p.id, 1)} disabled={idx === displayedProducts.length - 1} className={`w-7 h-7 md:w-8 md:h-8 flex items-center justify-center hover:bg-zinc-900 hover:text-white rounded-lg md:rounded-xl transition-all ${idx === displayedProducts.length - 1 ? 'opacity-10' : 'active:scale-75'}`}>
                            <svg className="w-3.5 h-3.5 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3"><path d="M19 9l-7 7-7-7"/></svg>
                        </button>
                     </div>
                   </div>
                   <button onClick={() => deleteProduct(p.id)} className="text-zinc-300 hover:text-rose-600 font-bold text-[9px] md:text-[10px] uppercase tracking-widest transition-colors flex items-center gap-2 ml-auto sm:ml-0">
                     <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                     <span className="hidden sm:inline">Eliminar</span>
                   </button>
                </div>

                <div className="flex flex-col xl:flex-row">
                   <div className="w-full xl:w-[25%] p-6 md:p-8 border-r border-zinc-100 bg-zinc-50/20 flex flex-col items-center xl:items-stretch text-center xl:text-left">
                     <div className="w-full max-w-[240px] aspect-square bg-white rounded-[1.5rem] md:rounded-[2rem] border border-zinc-200 mb-5 md:mb-6 relative flex items-center justify-center overflow-hidden shadow-sm group/img cursor-pointer">
                       {p.image ? <img src={p.image} className="w-full h-full object-cover transition-transform duration-700 group-hover/img:scale-110"/> : <span className="text-3xl md:text-5xl opacity-10 font-bold italic text-zinc-900">IMG</span>}
                       <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center text-white text-[10px] font-bold uppercase tracking-widest">Cambiar</div>
                       <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e)=>handleImage(e, p)}/>
                     </div>
                     <input value={p.name} onChange={(e)=>updateField(p.id,'name',e.target.value)} className="w-full text-lg md:text-xl font-bold bg-transparent border-b border-transparent hover:border-zinc-200 focus:border-zinc-900 outline-none mb-2 md:mb-3 py-1 transition-all text-zinc-900" placeholder="Nombre..."/>
                     <textarea value={p.description} onChange={(e)=>updateField(p.id,'description',e.target.value)} rows={3} className="w-full text-[10px] md:text-[11px] bg-white p-4 rounded-xl md:rounded-2xl resize-none outline-none border border-zinc-100 shadow-inner text-zinc-500 leading-relaxed focus:ring-4 focus:ring-zinc-100" placeholder="Descripción..."/>
                   </div>
                   
                   <div className="flex-1 p-6 md:p-8 bg-white space-y-6 md:space-y-8">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4">
                        {[{k:'base',l:'Prod'}, {k:'cpa',l:'Ads'}, {k:'freight',l:'Flete'}, {k:'fulfillment',l:'Log.'}, {k:'commission',l:'Com.'}, {k:'returns',l:'Dev.'}, {k:'fixed',l:'Fijos'}].map(f=>(
                          <div key={f.k} className="bg-zinc-50/50 p-3 md:p-4 rounded-xl md:rounded-2xl border border-zinc-100 hover:bg-white hover:shadow-md transition-all">
                            <label className="text-[8px] md:text-[9px] font-black text-zinc-400 uppercase block mb-1 tracking-tighter leading-none">{f.l}</label>
                            <input type="number" value={p.costs?.[f.k]||''} onChange={(e)=>updateCost(p.id,p.costs,f.k,e.target.value)} className="w-full font-mono text-xs md:text-sm font-bold outline-none text-zinc-800 bg-transparent" placeholder="0"/>
                          </div>
                        ))}
                      </div>

                      <div className="bg-zinc-900 rounded-[1.5rem] md:rounded-[2.2rem] p-5 md:p-8 text-white shadow-xl relative overflow-hidden group/profit">
                         <div className="absolute top-0 right-0 w-32 h-32 md:w-48 md:h-48 bg-blue-500/10 rounded-full blur-[60px] md:blur-[80px] -mr-16 -mt-16 md:-mr-20 md:-mt-20"></div>
                         <div className="flex flex-col md:flex-row justify-between items-start md:items-end border-b border-zinc-800 pb-5 md:pb-6 mb-5 md:mb-6 gap-4 md:gap-6 relative z-10">
                            <div className="flex-1 w-full">
                              <label className="text-[8px] md:text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-2 md:mb-3 block leading-none">PVP Sugerido (Inc. Bundles)</label>
                              <div className="flex items-center gap-2">
                                <span className="text-xl font-bold opacity-30">$</span>
                                <input type="number" value={p.targetPrice||''} onChange={(e)=>updateField(p.id,'targetPrice',e.target.value)} className="bg-transparent font-bold text-3xl md:text-5xl outline-none w-full tracking-tighter focus:text-blue-400 transition-colors text-white" placeholder="0" />
                              </div>
                            </div>
                            <div className="text-left md:text-right">
                               <p className="text-[8px] md:text-[10px] font-bold text-rose-400 uppercase tracking-widest mb-1 leading-none italic">Inversión Combinada</p>
                               <p className="text-xl md:text-2xl font-mono font-bold tracking-tight text-rose-50">{formatCurrency(m.combinedTotalCost)}</p>
                            </div>
                         </div>
                         <div className="flex flex-col sm:flex-row justify-between items-center gap-4 md:gap-6 relative z-10">
                            <div className="bg-white/5 p-4 md:p-5 rounded-xl md:rounded-2xl border border-white/5 w-full sm:flex-1 transition-all group-hover/profit:bg-white/10 text-center sm:text-left">
                               <p className="text-[8px] md:text-[9px] font-bold text-zinc-500 uppercase tracking-widest mb-1 leading-none">Utilidad Neta del Embudo</p>
                               <p className={`text-2xl md:text-4xl font-mono font-bold ${m.finalProfit > 0 ? 'text-emerald-400' : 'text-rose-500'}`}>{formatCurrency(m.finalProfit)}</p>
                            </div>
                            <div className="text-center sm:text-right w-full sm:w-auto">
                                <p className="text-[8px] md:text-[9px] font-bold text-zinc-500 uppercase tracking-widest mb-1 leading-none">Rentabilidad</p>
                                <p className="text-4xl md:text-6xl font-black italic tracking-tighter leading-none text-white">{m.finalMargin.toFixed(1)}%</p>
                            </div>
                         </div>
                      </div>

                      <div className="flex flex-wrap gap-2 pt-2 justify-center md:justify-start">
                        {Object.values(STATUS_CONFIG).map(s=>(<button key={s.id} onClick={()=>{ if (s.id === 'rejected' && p.status !== 'rejected') { setRejectModal({ isOpen: true, productId: p.id, reason: '' }); } else { updateField(p.id,'status',s.id); } }} className={`px-4 md:px-5 py-2 md:py-2.5 rounded-lg md:rounded-xl text-[9px] md:text-[10px] font-bold border-2 uppercase transition-all tracking-wider ${p.status===s.id ? `bg-white ${s.color} border-current shadow-md` : 'bg-white border-zinc-100 text-zinc-400 hover:bg-zinc-50 hover:text-zinc-600'}`}>{s.emoji} {s.label}</button>))}
                      </div>
                   </div>

                   <div className="w-full xl:w-[32%] bg-[#fcfdfe] p-6 md:p-8 flex flex-col border-l border-zinc-100 shadow-inner">
                     <button 
                        onClick={() => toggleBundles(p.id)}
                        className={`w-full flex justify-between items-center p-4 md:p-5 rounded-xl md:rounded-2xl border-2 transition-all duration-300 ${isBundlesExpanded ? 'bg-zinc-900 border-zinc-900 text-white shadow-2xl' : 'bg-white border-zinc-100 text-zinc-900 hover:border-zinc-300 shadow-sm'}`}
                     >
                        <div className="flex items-center gap-3">
                            <span className="text-lg">🍱</span>
                            <div className="text-left">
                                <p className="text-[9px] md:text-[10px] font-black uppercase tracking-widest leading-none">Estrategia Bundles</p>
                                <p className={`text-[8px] md:text-[9px] font-bold mt-1 opacity-60`}>{m.upsellsCount} configurados</p>
                            </div>
                        </div>
                        <svg className={`w-4 h-4 md:w-5 md:h-5 transition-transform duration-500 ${isBundlesExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="4"><path d="M19 9l-7 7-7-7"/></svg>
                     </button>

                     <div className={`transition-all duration-500 ease-in-out overflow-hidden ${isBundlesExpanded ? 'max-h-[1000px] opacity-100 mt-5 md:mt-6' : 'max-h-0 opacity-0 mt-0'}`}>
                        <div className="space-y-3 md:space-y-4 pr-1 custom-scrollbar overflow-y-auto max-h-[500px] md:max-h-[600px]">
                            {p.upsells.map(u=>(
                            <div key={u.id} className="bg-white p-3 md:p-4 rounded-2xl md:rounded-3xl border border-zinc-100 flex gap-3 md:gap-4 relative group/bundle transition-all hover:shadow-lg border-l-4 border-l-blue-500">
                                <div className="w-10 h-10 md:w-12 md:h-12 bg-zinc-50 rounded-lg md:rounded-xl relative shrink-0 flex items-center justify-center border border-zinc-100 overflow-hidden shadow-inner cursor-pointer group/up">
                                {u.image ? <img src={u.image} className="w-full h-full object-cover"/> : <span className="text-[10px] opacity-20 text-zinc-900">➕</span>}
                                <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e)=>handleImage(e, p, u.id)}/>
                                </div>
                                <div className="flex-1 min-w-0 pr-6 md:pr-4">
                                <input value={u.name} onChange={(e)=>updateUpsell(p,u.id,'name',e.target.value)} className="w-full text-[10px] md:text-[11px] font-bold bg-transparent border-b border-transparent focus:border-blue-500 mb-1 outline-none truncate text-zinc-900" placeholder="Nombre..."/>
                                <div className="flex gap-2 mt-1">
                                    <div className="w-1/2">
                                    <label className="text-[7px] text-zinc-400 uppercase block leading-none mb-1">Costo</label>
                                    <input type="number" value={u.cost||''} onChange={(e)=>updateUpsell(p,u.id,'cost',e.target.value)} className="w-full bg-zinc-50 text-[9px] md:text-[10px] p-1 md:p-1.5 rounded-lg font-mono outline-none border border-transparent text-zinc-700" placeholder="0"/>
                                    </div>
                                    <div className="w-1/2">
                                    <label className="text-[7px] text-blue-500 uppercase block leading-none mb-1 font-bold">Venta</label>
                                    <input type="number" value={u.price||''} onChange={(e)=>updateUpsell(p,u.id,'price',e.target.value)} className="w-full bg-blue-50 text-[9px] md:text-[10px] p-1 md:p-1.5 rounded-lg font-bold text-blue-600 outline-none border border-transparent text-blue-700" placeholder="0"/>
                                    </div>
                                </div>
                                </div>
                                <button 
                                onClick={() => resetUpsell(p, u.id)} 
                                className="text-zinc-300 opacity-100 sm:opacity-0 group-hover/bundle:opacity-100 transition-all p-1 hover:text-rose-500 absolute right-2 top-2 hover:scale-125"
                                title="Resetear Bundle"
                                >
                                <svg className="w-3.5 h-3.5 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                </button>
                            </div>
                            ))}
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
        <div className="fixed inset-0 bg-zinc-950/80 backdrop-blur-sm flex items-center justify-center z-[100] p-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-2xl md:rounded-[3rem] shadow-2xl p-6 md:p-10 w-full max-w-md border border-zinc-100 animate-in zoom-in-95 duration-200">
            <h2 className="text-xl md:text-2xl font-black text-zinc-900 mb-2 uppercase tracking-tighter italic border-b border-zinc-100 pb-4 text-center sm:text-left">Rechazar Producto</h2>
            <p className="text-[9px] md:text-[10px] text-zinc-400 my-4 md:my-6 font-bold uppercase tracking-[0.15em] md:tracking-[0.2em] leading-relaxed italic text-center sm:text-left">Explica los motivos técnicos del descarte para el registro histórico...</p>
            <textarea autoFocus rows={4} value={rejectModal.reason} onChange={(e) => setRejectModal({ ...rejectModal, reason: e.target.value })} className="w-full bg-zinc-50 border-2 border-slate-100 rounded-xl md:rounded-[1.5rem] p-4 md:p-6 text-sm focus:outline-none focus:border-zinc-900 focus:ring-8 focus:ring-zinc-900/5 mb-6 md:mb-8 transition-all font-medium text-zinc-700 shadow-inner" placeholder="Ej: CPA demasiado costoso, margen bajo 20%..." />
            <div className="flex flex-col sm:flex-row gap-3 md:gap-4">
              <button onClick={() => setRejectModal({ isOpen: false, productId: null, reason: '' })} className="order-2 sm:order-1 flex-1 py-4 md:py-5 bg-zinc-100 hover:bg-zinc-200 text-zinc-500 font-black uppercase text-[10px] tracking-[0.1em] md:tracking-[0.2em] rounded-xl md:rounded-2xl transition-all">Cancelar</button>
              <button onClick={confirmRejection} className="order-1 sm:order-2 flex-1 py-4 md:py-5 bg-rose-600 hover:bg-rose-700 text-white font-black uppercase text-[10px] tracking-[0.1em] md:tracking-[0.2em] rounded-xl md:rounded-2xl shadow-xl shadow-rose-200 active:scale-95 transition-all">RECHAZAR</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
