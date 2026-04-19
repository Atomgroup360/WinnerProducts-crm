import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, collection, addDoc, updateDoc, deleteDoc, doc, 
  onSnapshot, serverTimestamp 
} from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';

// --- CONFIGURACIÓN DE FIREBASE ORIGINAL ---
const firebaseConfig = {
  apiKey: "AIzaSyATSpw_uzohLwm7zVUk3X_d6EAsDZNZLK0".trim(),
  authDomain: "winnerproduct-crm.firebaseapp.com".trim(),
  projectId: "winnerproduct-crm".trim(),
  storageBucket: "winnerproduct-crm.firebasestorage.app".trim(),
  messagingSenderId: "697988179670".trim(),
  appId: "1:697988179670:web:3910c31426d0d6e4bdcb77".trim()
};

// Inicialización de Base de Datos
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// --- Constantes de UI ---
const STATUS_CONFIG = {
  pending: { id: 'pending', label: 'Pendiente', color: 'bg-gray-100 text-gray-600', emoji: '🕒' },
  prepared: { id: 'prepared', label: 'Preparado', color: 'bg-blue-100 text-blue-700', emoji: '📦' },
  testing: { id: 'testing', label: 'En Testeo', color: 'bg-yellow-100 text-yellow-700', emoji: '🧪' },
  approved: { id: 'approved', label: 'Aprobado', color: 'bg-green-100 text-green-700', emoji: '✅' },
  rejected: { id: 'rejected', label: 'Rechazado', color: 'bg-red-100 text-red-700', emoji: '❌' }
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
  order: Date.now(), 
  upsells: [
    { id: 1, name: '', cost: 0, price: 0, image: null }, 
    { id: 2, name: '', cost: 0, price: 0, image: null },
    { id: 3, name: '', cost: 0, price: 0, image: null },
    { id: 4, name: '', cost: 0, price: 0, image: null },
    { id: 5, name: '', cost: 0, price: 0, image: null },
  ]
};

// --- Helpers ---
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
  const [user, setUser] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('pending'); 
  const [rejectModal, setRejectModal] = useState({ isOpen: false, productId: null, reason: '' });
  
  const [isCreating, setIsCreating] = useState(false);
  const [newProduct, setNewProduct] = useState(INITIAL_PRODUCT_STATE);

  // 1. Autenticación
  useEffect(() => {
    signInAnonymously(auth).catch(console.error);
    return onAuthStateChanged(auth, setUser);
  }, []);

  // 2. Conexión a Base de Datos
  useEffect(() => {
    if (!user) return;
    const q = collection(db, 'artifacts', 'winnerproduct-crm', 'public', 'data', 'products');
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const loaded = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      loaded.sort((a, b) => (a.order || 0) - (b.order || 0));
      setProducts(loaded);
      setLoading(false);
    }, (err) => {
      console.error("Firestore Error:", err);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [user]);

  // --- Funciones de Datos ---
  const handleSaveNewProduct = async () => {
    if (!newProduct.name) {
      alert("Por favor ingresa al menos el nombre del producto.");
      return;
    }
    try {
      await addDoc(collection(db, 'artifacts', 'winnerproduct-crm', 'public', 'data', 'products'), {
        ...newProduct, 
        order: Date.now(), 
        createdAt: serverTimestamp(), 
        createdBy: user.uid
      });
      setIsCreating(false);
      setNewProduct(INITIAL_PRODUCT_STATE);
      setActiveTab('pending');
    } catch (e) { alert("Error al guardar: " + e.message); }
  };

  const updateField = async (id, f, v) => {
    await updateDoc(doc(db, 'artifacts', 'winnerproduct-crm', 'public', 'data', 'products', id), { [f]: v });
  };

  const updateCost = async (id, costs, f, v) => {
    await updateDoc(doc(db, 'artifacts', 'winnerproduct-crm', 'public', 'data', 'products', id), { costs: { ...costs, [f]: parseFloat(v) || 0 } });
  };

  const updateUpsell = async (p, uid, f, v) => {
    const newUpsells = p.upsells.map(u => u.id === uid ? { ...u, [f]: v } : u);
    await updateDoc(doc(db, 'artifacts', 'winnerproduct-crm', 'public', 'data', 'products', p.id), { upsells: newUpsells });
  };

  // FUNCIÓN DE ELIMINACIÓN TOTAL (Libera espacio eliminando el Doc y sus imágenes Base64)
  const deleteProduct = async (id) => {
    if (window.confirm('¿ELIMINAR PERMANENTEMENTE? Se borrarán todos los datos e imágenes de la nube para liberar espacio.')) {
      try {
        await deleteDoc(doc(db, 'artifacts', 'winnerproduct-crm', 'public', 'data', 'products', id));
      } catch (e) {
        alert("Error al eliminar: " + e.message);
      }
    }
  };

  const moveProduct = async (productId, direction) => {
    const currentList = products.filter(p => p.status === activeTab);
    const index = currentList.findIndex(p => p.id === productId);
    const targetIndex = index + direction;

    if (targetIndex >= 0 && targetIndex < currentList.length) {
      const productA = currentList[index];
      const productB = currentList[targetIndex];
      const orderA = productA.order || (Date.now() + index);
      const orderB = productB.order || (Date.now() + targetIndex);

      try {
        await updateDoc(doc(db, 'artifacts', 'winnerproduct-crm', 'public', 'data', 'products', productA.id), { order: orderB });
        await updateDoc(doc(db, 'artifacts', 'winnerproduct-crm', 'public', 'data', 'products', productB.id), { order: orderA });
      } catch (e) { console.error(e); }
    }
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

  // --- VISTA INDEPENDIENTE DE CREACIÓN ---
  if (isCreating) {
    const mNew = calculateMetrics(newProduct);
    return (
      <div className="min-h-screen bg-slate-100 p-4 md:p-8 font-sans text-slate-800">
        <div className="max-w-5xl mx-auto bg-white shadow-2xl rounded-2xl overflow-hidden border border-slate-200">
          <header className="bg-blue-900 p-6 text-white flex justify-between items-center">
            <div>
              <h2 className="text-2xl font-black uppercase tracking-tight">Configuración de Nuevo Producto</h2>
              <p className="text-blue-200 text-xs uppercase font-bold mt-1 tracking-widest">Panel de Creación Profesional</p>
            </div>
            <button onClick={() => setIsCreating(false)} className="text-white/70 hover:text-white font-bold text-sm">✕ CANCELAR</button>
          </header>

          <div className="p-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-1 space-y-6">
              <div className="aspect-square bg-slate-50 rounded-xl border-2 border-dashed border-slate-300 relative flex items-center justify-center overflow-hidden group">
                {newProduct.image ? <img src={newProduct.image} className="w-full h-full object-cover"/> : <span className="text-slate-400 font-bold text-center p-4">Haz clic para subir imagen principal</span>}
                <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e)=>handleImage(e, "new")}/>
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase mb-2 block">Nombre del Producto</label>
                <input 
                  value={newProduct.name} 
                  onChange={(e)=>setNewProduct({...newProduct, name: e.target.value})} 
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3 font-bold text-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="Ej: Aspiradora Pro 2024"
                />
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase mb-2 block">Descripción Estratégica</label>
                <textarea 
                  value={newProduct.description} 
                  onChange={(e)=>setNewProduct({...newProduct, description: e.target.value})} 
                  rows={4} 
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                  placeholder="Escribe los puntos clave de venta..."
                />
              </div>
            </div>

            <div className="lg:col-span-2 space-y-8">
              <div className="bg-slate-50 p-6 rounded-xl border border-slate-200">
                <h3 className="text-sm font-black uppercase text-slate-600 mb-4 border-b pb-2 border-slate-200">Estructura de Costos (COP)</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    {k:'base',l:'Costo Producto'}, {k:'cpa',l:'CPA Ads'}, {k:'freight',l:'Flete'},
                    {k:'fulfillment',l:'Logística'}, {k:'commission',l:'Comisión'},
                    {k:'returns',l:'Devolución'}, {k:'fixed',l:'Fijos'}
                  ].map(f=>(
                    <div key={f.k}>
                      <label className="text-[9px] font-black text-slate-400 uppercase mb-1 block">{f.l}</label>
                      <input 
                        type="number" 
                        value={newProduct.costs[f.k] || ''} 
                        onChange={(e)=>setNewProduct({...newProduct, costs: {...newProduct.costs, [f.k]: parseFloat(e.target.value) || 0}})} 
                        className="w-full bg-white border border-slate-200 rounded-lg p-2 font-mono text-sm outline-none focus:border-blue-500"
                        placeholder="0"
                      />
                    </div>
                  ))}
                  <div className="col-span-2 bg-blue-900 p-3 rounded-lg text-white">
                    <label className="text-[9px] font-black text-blue-300 uppercase mb-1 block">Precio Objetivo (PVP)</label>
                    <input 
                      type="number" 
                      value={newProduct.targetPrice || ''} 
                      onChange={(e)=>setNewProduct({...newProduct, targetPrice: parseFloat(e.target.value) || 0})} 
                      className="w-full bg-transparent border-b border-blue-500 text-xl font-black outline-none"
                      placeholder="0"
                    />
                  </div>
                </div>
              </div>

              <div className="bg-slate-900 p-6 rounded-xl text-white">
                <h3 className="text-sm font-black uppercase text-blue-300 mb-4 flex justify-between items-center">
                  <span>Estrategia de Upsells</span>
                  <span className="text-[10px] bg-blue-800 px-2 py-1 rounded">Max 5 Slots</span>
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {newProduct.upsells.map(u => (
                    <div key={u.id} className="bg-slate-800 p-3 rounded-lg flex gap-3 border border-slate-700">
                      <div className="w-12 h-12 bg-slate-700 rounded-lg shrink-0 relative flex items-center justify-center overflow-hidden border border-slate-600">
                        {u.image ? <img src={u.image} className="w-full h-full object-cover"/> : <span className="text-xs">📸</span>}
                        <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e)=>handleImage(e, "new", u.id)}/>
                      </div>
                      <div className="flex-1 space-y-1">
                        <input 
                          value={u.name} 
                          onChange={(e)=>{
                            const up = newProduct.upsells.map(x => x.id === u.id ? {...x, name: e.target.value} : x);
                            setNewProduct({...newProduct, upsells: up});
                          }}
                          className="w-full bg-transparent border-b border-slate-700 text-xs font-bold outline-none focus:border-blue-400" 
                          placeholder="Nombre Upsell..."
                        />
                        <div className="flex gap-2">
                          <input 
                            type="number" value={u.cost || ''} 
                            onChange={(e)=>{
                              const up = newProduct.upsells.map(x => x.id === u.id ? {...x, cost: parseFloat(e.target.value) || 0} : x);
                              setNewProduct({...newProduct, upsells: up});
                            }}
                            className="w-1/2 bg-slate-900 text-[10px] p-1 rounded outline-none" placeholder="Costo" 
                          />
                          <input 
                            type="number" value={u.price || ''} 
                            onChange={(e)=>{
                              const up = newProduct.upsells.map(x => x.id === u.id ? {...x, price: parseFloat(e.target.value) || 0} : x);
                              setNewProduct({...newProduct, upsells: up});
                            }}
                            className="w-1/2 bg-blue-800 text-[10px] p-1 rounded font-bold outline-none" placeholder="Precio" 
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              
              <div className="flex gap-4 pt-4">
                <button 
                  onClick={() => setIsCreating(false)} 
                  className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-500 font-black p-4 rounded-xl transition-all uppercase tracking-widest text-sm"
                >
                  Descartar
                </button>
                <button 
                  onClick={handleSaveNewProduct} 
                  className="flex-[2] bg-blue-600 hover:bg-blue-700 text-white font-black p-4 rounded-xl transition-all shadow-xl shadow-blue-200 uppercase tracking-widest text-sm"
                >
                  Guardar Producto
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const displayedProducts = products.filter(p => p.status === activeTab);

  return (
    <div className="min-h-screen bg-slate-50 p-4 font-sans text-slate-800">
      <div className="max-w-[1600px] mx-auto">
        <header className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4 bg-blue-900 text-white p-4 rounded-lg shadow-lg">
          <div>
            <h1 className="text-2xl font-black tracking-tight flex items-center gap-2 uppercase">
              ☁️ WINNER PRODUCT OS <span className="text-xs font-normal bg-blue-600 px-2 py-0.5 rounded-full border border-blue-400">V10.0</span>
            </h1>
            <p className="text-xs text-blue-200 mt-1">{loading ? 'Cargando...' : 'Sistema Activo • Configuración Pro'}</p>
          </div>
          <button onClick={() => setIsCreating(true)} disabled={loading} className="bg-white text-blue-900 hover:bg-blue-50 px-5 py-2.5 rounded-lg shadow font-bold text-sm transition-colors uppercase tracking-tight">
            ➕ AGREGAR PRODUCTO
          </button>
        </header>

        <div className="flex flex-wrap gap-2 mb-6 border-b border-slate-200 pb-4">
          {Object.values(STATUS_CONFIG).map((config) => (
            <button 
              key={config.id}
              onClick={() => setActiveTab(config.id)} 
              className={`px-4 py-2 rounded-lg font-bold text-xs uppercase transition-all border ${activeTab === config.id ? `${config.color} border-current ring-1 ring-slate-300` : 'bg-white text-slate-500 border-slate-200'}`}
            >
              {config.emoji} {config.label} ({products.filter(p => p.status === config.id).length})
            </button>
          ))}
        </div>

        {loading ? <div className="text-center py-20 font-bold text-blue-600 animate-pulse">Sincronizando base de datos original...</div> : (
          <div className="grid grid-cols-1 gap-6">
            {displayedProducts.length === 0 && <div className="text-center py-20 bg-white rounded-xl border border-dashed border-slate-300"><p className="text-slate-500 font-bold uppercase tracking-widest text-xs">No hay productos en esta sección.</p></div>}
            {displayedProducts.map((p, idx) => {
              const st = STATUS_CONFIG[p.status] || STATUS_CONFIG.pending; 
              const m = calculateMetrics(p);
              return (
                <div key={p.id} className="border-2 shadow-sm bg-white rounded-xl overflow-hidden">
                   {p.status === 'rejected' && (
                     <div className="bg-red-50 p-4 border-b border-red-100">
                       <label className="text-xs font-black text-red-800 uppercase block mb-1">Motivo del rechazo:</label>
                       <textarea value={p.rejectionReason} onChange={(e)=>updateField(p.id,'rejectionReason',e.target.value)} rows={2} className="w-full text-sm bg-transparent border-b border-red-200 text-red-900 font-medium outline-none resize-none focus:border-red-500" placeholder="Escribe el motivo aquí..."/>
                     </div>
                   )}
                   <div className={`px-4 py-2 flex justify-between items-center border-b ${st.color}`}>
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2 font-bold uppercase text-xs"><span>{st.emoji}</span> {st.label}</div>
                        <div className="flex items-center gap-1 bg-white/50 rounded-md p-1 border border-black/5">
                          <button onClick={() => moveProduct(p.id, -1)} disabled={idx === 0} className={`p-1 hover:bg-white rounded ${idx === 0 ? 'opacity-20' : ''}`}><svg className="w-3 h-3 text-slate-800" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M5 15l7-7 7 7"></path></svg></button>
                          <button onClick={() => moveProduct(p.id, 1)} disabled={idx === displayedProducts.length - 1} className={`p-1 hover:bg-white rounded ${idx === displayedProducts.length - 1 ? 'opacity-20' : ''}`}><svg className="w-3 h-3 text-slate-800" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M19 9l-7 7-7-7"></path></svg></button>
                        </div>
                      </div>
                      <button onClick={() => deleteProduct(p.id)} className="text-slate-500 hover:text-red-600 font-bold px-2 text-[10px]">🗑️ ELIMINAR</button>
                   </div>
                   <div className="flex flex-col xl:flex-row">
                      <div className="w-full xl:w-[25%] p-5 border-r border-slate-200">
                        <div className="aspect-square bg-slate-50 rounded-lg border-2 border-dashed border-slate-200 mb-4 relative flex items-center justify-center group overflow-hidden">
                          {p.image ? <img src={p.image} className="w-full h-full object-cover"/> : <span className="text-4xl text-slate-300">📸</span>}
                          <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e)=>handleImage(e, p)}/>
                        </div>
                        <input value={p.name} onChange={(e)=>updateField(p.id,'name',e.target.value)} className="w-full text-lg font-black bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 outline-none mb-2" placeholder="Nombre..."/>
                        <textarea value={p.description} onChange={(e)=>updateField(p.id,'description',e.target.value)} rows={4} className="w-full text-xs bg-slate-50 p-2 rounded resize-none" placeholder="Descripción..."/>
                      </div>
                      
                      <div className="flex-1 p-5 border-r border-slate-200 bg-slate-50">
                         <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                           {[{k:'base',l:'COSTO PRODUCTO'}, {k:'cpa',l:'CPA'}, {k:'freight',l:'FLETE'}, {k:'fulfillment',l:'LOGÍSTICA'}, {k:'commission',l:'COMISIÓN'}, {k:'returns',l:'DEVOLUCIÓN'}, {k:'fixed',l:'FIJOS'}].map(f=>(
                             <div key={f.k} className="bg-white p-2 rounded border border-slate-200">
                               <label className="text-[10px] font-bold text-slate-400 uppercase">{f.l}</label>
                               <input type="number" value={p.costs?.[f.k]||''} onChange={(e)=>updateCost(p.id,p.costs,f.k,e.target.value)} className="w-full font-mono text-sm outline-none" placeholder="0"/>
                             </div>
                           ))}
                         </div>
                         <div className="bg-slate-200 rounded-lg p-4 mt-auto">
                            <div className="flex justify-between items-end mb-4 pb-3 border-b border-slate-300">
                               <div>
                                 <label className="text-[10px] font-bold text-slate-500 uppercase">PRECIO OBJETIVO</label>
                                 <input type="number" value={p.targetPrice||''} onChange={(e)=>updateField(p.id,'targetPrice',e.target.value)} className="bg-transparent font-mono font-bold text-xl w-32 outline-none" placeholder="0" />
                               </div>
                               <div className="text-right text-[10px] font-bold text-slate-500 uppercase">Costo Total: {formatCurrency(m.totalProductCost)}</div>
                            </div>
                            <div className="flex justify-between border-b border-slate-300 py-1.5"><span className="text-xs font-bold text-slate-500 uppercase">Utilidad Neta</span><span className={`font-mono text-xl font-black ${m.productProfit>0?'text-blue-800':'text-red-500'}`}>{formatCurrency(m.productProfit)}</span></div>
                            <div className="flex justify-between mt-1"><span className="text-xs font-bold text-slate-500 uppercase">Margen Neto</span><span className={`font-mono text-xl font-black ${m.productMargin>0?'text-blue-800':'text-red-500'}`}>{m.productMargin.toFixed(1)}%</span></div>
                         </div>
                         <div className="mt-4 flex flex-wrap gap-2">
                           {Object.values(STATUS_CONFIG).map(s=>(
                             <button key={s.id} onClick={()=>{ if (s.id === 'rejected' && p.status !== 'rejected') { setRejectModal({ isOpen: true, productId: p.id, reason: '' }); } else { updateField(p.id,'status',s.id); } }} className={`px-3 py-1.5 rounded text-xs font-semibold border ${p.status===s.id ? `bg-white ${s.color}` : 'bg-white border-slate-200 text-slate-500'}`}>{s.emoji} {s.label}</button>
                           ))}
                         </div>
                      </div>
                      <div className="w-full xl:w-[28%] bg-slate-900 text-white p-5 flex flex-col text-sm">
                        <h3 className="text-xs font-bold text-blue-300 mb-3 uppercase">Upsells ({m.upsellsCount} Activos)</h3>
                        <div className="space-y-2 mb-6 overflow-y-auto max-h-[300px] flex-1">
                           {p.upsells.map(u=>(
                             <div key={u.id} className="bg-slate-800 p-2 rounded border border-slate-700 flex gap-2">
                               <div className="w-10 h-10 bg-slate-700 shrink-0 relative flex items-center justify-center">{u.image ? <img src={u.image} className="w-full h-full object-cover"/> : <span className="text-xs">➕</span>}<input type="file" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e)=>handleImage(e, p, u.id)}/></div>
                               <div className="flex-1">
                                 <input value={u.name} onChange={(e)=>updateUpsell(p,u.id,'name',e.target.value)} className="w-full text-[10px] bg-transparent border-b border-slate-700 mb-1 outline-none" placeholder="Nombre..."/>
                                 <div className="flex gap-1">
                                   <input type="number" value={u.cost||''} onChange={(e)=>updateUpsell(p,u.id,'cost',e.target.value)} className="w-full bg-slate-900 text-[10px] p-1 rounded outline-none" placeholder="Costo"/>
                                   <input type="number" value={u.price||''} onChange={(e)=>updateUpsell(p,u.id,'price',e.target.value)} className="w-full bg-blue-900 text-[10px] p-1 rounded font-bold text-blue-300" placeholder="Precio"/>
                                 </div>
                               </div>
                             </div>
                           ))}
                        </div>
                        <div className="bg-gradient-to-br from-blue-600 to-blue-800 rounded-lg p-4 border border-blue-500 mt-auto shadow-lg">
                           <div className="flex justify-between items-end">
                              <div><p className="text-[10px] text-blue-200 uppercase">Utilidad Bundle</p><p className="text-xl font-mono font-bold">{formatCurrency(m.bundleProfit)}</p></div>
                              <div className="text-right"><p className="text-[10px] text-blue-200 uppercase">Margen</p><span className="bg-white text-blue-700 px-2 py-0.5 rounded text-sm font-black">{m.bundleMargin.toFixed(1)}%</span></div>
                           </div>
                        </div>
                      </div>
                   </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {rejectModal.isOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md">
            <h2 className="text-xl font-black text-slate-800 mb-4 uppercase">Rechazar Producto</h2>
            <textarea autoFocus rows={4} value={rejectModal.reason} onChange={(e) => setRejectModal({ ...rejectModal, reason: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded p-3 text-sm outline-none focus:ring-2 focus:ring-red-100 mb-6" placeholder="Motivo del rechazo..." />
            <div className="flex gap-3">
              <button onClick={() => setRejectModal({ isOpen: false, productId: null, reason: '' })} className="flex-1 py-3 bg-slate-100 font-bold rounded">Cancelar</button>
              <button onClick={confirmRejection} className="flex-1 py-3 bg-red-600 text-white font-bold rounded shadow-lg uppercase">Rechazar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
