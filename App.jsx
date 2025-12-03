import React, { useState, useEffect, useCallback } from 'react';
import { 
  Plus, Trash2, Upload, Package, TrendingUp, CheckCircle2, 
  Beaker, XCircle, MoreVertical, Clock, Calculator, Truck, CreditCard, 
  Target, Cloud, Users
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, signInAnonymously, onAuthStateChanged 
} from 'firebase/auth';
import { 
  getFirestore, collection, addDoc, updateDoc, deleteDoc, doc, 
  onSnapshot, serverTimestamp 
} from 'firebase/firestore';

// --- CONFIGURACIÓN DE FIREBASE ---
// Limpiamos las claves de posibles espacios invisibles con .trim()
const firebaseConfig = {
  apiKey: "AIzaSyATSpw_uzohLwm7zVUk3X_d6EAsDZNZLK0".trim(),
  authDomain: "winnerproduct-crm.firebaseapp.com".trim(),
  projectId: "winnerproduct-crm".trim(),
  storageBucket: "winnerproduct-crm.firebasestorage.app".trim(),
  messagingSenderId: "697988179670".trim(),
  appId: "1:697988179670:web:3910c31426d0d6e4bdcb77".trim()
};

// Inicializamos la app
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- Constantes de UI ---
const STATUS_CONFIG = {
  pending: { id: 'pending', label: 'Pendiente', color: 'bg-gray-50 border-gray-300 text-gray-500', icon: Clock },
  prepared: { id: 'prepared', label: 'Preparado', color: 'bg-blue-50 border-blue-500 text-blue-700', icon: Package },
  testing: { id: 'testing', label: 'En Testeo', color: 'bg-yellow-50 border-yellow-500 text-yellow-700', icon: Beaker },
  approved: { id: 'approved', label: 'Aprobado', color: 'bg-green-50 border-green-500 text-green-700', icon: CheckCircle2 },
  rejected: { id: 'rejected', label: 'Rechazado', color: 'bg-red-50 border-red-500 text-red-700', icon: XCircle }
};

const INITIAL_PRODUCT_STATE = {
  name: 'Nuevo Producto', description: '',
  costs: { base: 0, freight: 0, fulfillment: 0, commission: 0, cpa: 0, returns: 0, fixed: 0 },
  targetPrice: 0, origin: 'importacion', status: 'pending', rejectionReason: '', image: null,
  upsells: [
    { id: 1, name: '', cost: 0, price: 0, image: null }, { id: 2, name: '', cost: 0, price: 0, image: null },
    { id: 3, name: '', cost: 0, price: 0, image: null }, { id: 4, name: '', cost: 0, price: 0, image: null },
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

// --- Componente Principal ---
export default function App() {
  const [user, setUser] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null); 
  const [showRejectModal, setShowRejectModal] = useState(null);
  const [rejectReason, setRejectReason] = useState("");

  // 1. Autenticación
  useEffect(() => {
    console.log("Iniciando autenticación...");
    const initAuth = async () => {
      try {
        await signInAnonymously(auth);
        console.log("Autenticación exitosa");
      } catch (error) {
        console.error("Auth Error:", error);
        setLoading(false); // IMPORTANTE: Dejar de cargar si hay error
        if (error.code === 'auth/configuration-not-found') {
          setErrorMsg("⚠️ ERROR FIREBASE: El 'Inicio de sesión Anónimo' NO está habilitado en la consola.");
        } else if (error.code === 'auth/api-key-not-valid') {
           setErrorMsg("⚠️ ERROR CLAVE: La API Key es inválida.");
        } else {
          setErrorMsg(`Error de conexión: ${error.message}`);
        }
      }
    };
    initAuth();
    
    return onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        setErrorMsg(null); 
        console.log("Usuario detectado:", currentUser.uid);
      }
    });
  }, []);

  // 2. Base de Datos
  useEffect(() => {
    if (!user) return;
    
    const q = collection(db, 'artifacts', firebaseConfig.projectId, 'public', 'data', 'products');
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const loaded = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      loaded.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setProducts(loaded);
      setLoading(false);
    }, (err) => {
      console.error("Firestore Error:", err);
      setLoading(false);
      if (err.code === 'permission-denied') {
        setErrorMsg("⚠️ PERMISO DENEGADO: Revisa las 'Reglas de Seguridad' en Firestore.");
      } else {
        setErrorMsg(`Error de base de datos: ${err.message}`);
      }
    });
    return () => unsubscribe();
  }, [user]);

  // --- Funciones de Datos ---
  const addProduct = async () => {
    if (!user) return;
    await addDoc(collection(db, 'artifacts', firebaseConfig.projectId, 'public', 'data', 'products'), {
      ...INITIAL_PRODUCT_STATE, createdAt: serverTimestamp(), createdBy: user.uid
    });
  };
  const updateProductField = async (id, f, v) => {
    await updateDoc(doc(db, 'artifacts', firebaseConfig.projectId, 'public', 'data', 'products', id), { [f]: v });
  };
  const updateProductCost = async (id, costs, f, v) => {
    await updateDoc(doc(db, 'artifacts', firebaseConfig.projectId, 'public', 'data', 'products', id), { costs: { ...costs, [f]: parseFloat(v) } });
  };
  const updateUpsell = async (p, uid, f, v) => {
    const newUpsells = p.upsells.map(u => u.id === uid ? { ...u, [f]: v } : u);
    await updateDoc(doc(db, 'artifacts', firebaseConfig.projectId, 'public', 'data', 'products', p.id), { upsells: newUpsells });
  };
  const deleteProduct = async (id) => {
    if (confirm('¿Eliminar producto?')) await deleteDoc(doc(db, 'artifacts', firebaseConfig.projectId, 'public', 'data', 'products', id));
  };
  const handleImageUpload = (e, p, uid=null) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => uid ? updateUpsell(p, uid, 'image', reader.result) : updateProductField(p.id, 'image', reader.result);
      reader.readAsDataURL(file);
    }
  };

  // --- Renderizado de Error (SIN ICONOS PARA EVITAR CRASH) ---
  if (errorMsg) {
    return (
      <div style={{ padding: '40px', backgroundColor: '#FEF2F2', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ backgroundColor: 'white', padding: '30px', borderRadius: '12px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)', maxWidth: '600px', borderLeft: '8px solid #EF4444' }}>
          <h2 style={{ color: '#1F2937', fontSize: '24px', fontWeight: 'bold', marginBottom: '10px' }}>¡Problema de Conexión!</h2>
          <p style={{ color: '#DC2626', fontSize: '18px', fontWeight: 'bold', marginBottom: '20px' }}>{errorMsg}</p>
          <div style={{ backgroundColor: '#F3F4F6', padding: '15px', borderRadius: '6px', fontSize: '12px', fontFamily: 'monospace', color: '#4B5563', overflowX: 'auto' }}>
            <p><strong>Configuración usada:</strong></p>
            <p>Project ID: {firebaseConfig.projectId}</p>
            <p>API Key: {firebaseConfig.apiKey.substring(0, 10)}...</p>
            <p>Auth Domain: {firebaseConfig.authDomain}</p>
          </div>
          <p style={{ marginTop: '20px', fontSize: '14px', color: '#6B7280' }}>
            Si el error es "configuration-not-found", ve a <strong>Firebase Console &gt; Authentication &gt; Sign-in method</strong> y asegúrate de que <strong>Anonymous</strong> esté en estado <strong>Enabled</strong>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 p-4 font-sans text-slate-800">
      <div className="max-w-[1600px] mx-auto">
        <header className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
              <Cloud className="text-blue-600" /> WINNER PRODUCT OS <span className="text-xs font-normal text-white bg-blue-600 px-2 py-0.5 rounded-full">V6.0</span>
            </h1>
            <p className="text-xs text-slate-500 mt-1 flex items-center gap-1"><Users size={12}/> {loading ? 'Cargando...' : `ID: ${user?.uid}`}</p>
          </div>
          <button onClick={addProduct} disabled={!user || loading} className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-5 py-2.5 rounded-lg shadow-lg text-sm font-bold disabled:opacity-50"><Plus size={18} /> AGREGAR</button>
        </header>

        {loading && (
          <div className="flex justify-center h-64 items-center">
             <div style={{ borderTopColor: 'transparent' }} className="w-8 h-8 border-4 border-blue-600 rounded-full animate-spin"></div>
          </div>
        )}

        {!loading && (
          <div className="grid grid-cols-1 gap-6">
            {products.length === 0 && <div className="text-center py-20 bg-white rounded-xl border-dashed border-slate-300"><p>Base de datos conectada. Agrega tu primer producto.</p></div>}
            {products.map(p => {
              const st = STATUS_CONFIG[p.status]; const Icon = st.icon; const m = calculateMetrics(p);
              return (
                <div key={p.id} className={`border-2 shadow-md bg-white rounded-xl overflow-hidden ${st.color.split(' ')[1]}`}>
                   <div className={`px-4 py-2 flex justify-between items-center border-b ${st.color.replace('text-', 'bg-').split(' ')[0]} bg-opacity-10`}>
                      <div className={`flex items-center gap-2 ${st.color.split(' ')[2]}`}><Icon size={18}/><span className="font-bold uppercase text-xs">{st.label}</span></div>
                      <div className="flex items-center gap-3"><button onClick={() => deleteProduct(p.id)} className="text-slate-400 hover:text-red-500"><Trash2 size={16}/></button></div>
                   </div>
                   <div className="flex flex-col xl:flex-row">
                      <div className="w-full xl:w-[25%] p-5 border-r border-slate-200">
                        <div className="aspect-square bg-slate-50 rounded-lg border-2 border-dashed border-slate-200 mb-4 relative flex items-center justify-center group">
                          {p.image ? <img src={p.image} className="w-full h-full object-cover"/> : <Upload className="text-slate-300"/>}
                          <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e)=>handleImageUpload(e,p)}/>
                        </div>
                        <input value={p.name} onChange={(e)=>updateProductField(p.id,'name',e.target.value)} className="w-full text-lg font-black bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 outline-none mb-2" placeholder="Nombre..."/>
                        <textarea value={p.description} onChange={(e)=>updateProductField(p.id,'description',e.target.value)} rows={4} className="w-full text-xs bg-slate-50 p-2 rounded resize-none" placeholder="Descripción..."/>
                      </div>
                      <div className="flex-1 p-5 border-r border-slate-200 bg-slate-50">
                         <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                           {[{k:'base',l:'Base'},{k:'cpa',l:'CPA'},{k:'freight',l:'Flete'},{k:'fulfillment',l:'Logística'},{k:'commission',l:'Comisión'},{k:'returns',l:'Devoluciones'},{k:'fixed',l:'Fijos'}].map(f=>(
                             <div key={f.k} className="bg-white p-2 rounded border border-slate-200"><label className="text-[10px] font-bold text-slate-400 uppercase">{f.l}</label><input type="number" value={p.costs?.[f.k]||''} onChange={(e)=>updateProductCost(p.id,p.costs,f.k,e.target.value)} className="w-full font-mono text-sm outline-none" placeholder="0"/></div>
                           ))}
                         </div>
                         <div className="bg-slate-200 rounded-lg p-4 mt-auto">
                            <div className="flex justify-between items-end mb-4 pb-3 border-b border-slate-300">
                               <div><label className="text-[10px] font-bold text-slate-500 uppercase">Precio Objetivo</label><input type="number" value={p.targetPrice||''} onChange={(e)=>updateProductField(p.id,'targetPrice',e.target.value)} className="bg-transparent font-mono font-bold text-xl w-32 outline-none"/></div>
                               <div className="text-right"><label className="text-[10px] font-bold text-red-500 uppercase">Costo Total</label><span className="font-mono text-sm text-red-600">{formatCurrency(m.totalProductCost)}</span></div>
                            </div>
                            <div className="flex justify-between"><span className="text-xs font-bold text-slate-500 uppercase">Utilidad</span><span className={`font-mono text-2xl font-black ${m.productProfit>0?'text-slate-800':'text-red-500'}`}>{formatCurrency(m.productProfit)}</span></div>
                         </div>
                         <div className="mt-4 flex flex-wrap gap-2">{Object.values(STATUS_CONFIG).map(s=>(<button key={s.id} onClick={()=>updateProductField(p.id,'status',s.id)} className={`px-3 py-1.5 rounded text-xs font-semibold border ${p.status===s.id ? `bg-white ${s.color}` : 'bg-white border-slate-200 text-slate-500'}`}>{s.label}</button>))}</div>
                      </div>
                      <div className="w-full xl:w-[28%] bg-slate-900 text-white p-5 flex flex-col">
                        <div className="space-y-2 mb-6 overflow-y-auto max-h-[300px] flex-1 custom-scrollbar">
                           {p.upsells.map(u=>(
                             <div key={u.id} className="bg-slate-800 p-2 rounded border border-slate-700 flex gap-2">
                               <div className="w-10 h-10 bg-slate-700 shrink-0 relative flex items-center justify-center">{u.image ? <img src={u.image} className="w-full h-full object-cover"/> : <Plus size={10}/>}<input type="file" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e)=>handleImageUpload(e,p,u.id)}/></div>
                               <div className="flex-1"><input value={u.name} onChange={(e)=>updateUpsell(p,u.id,'name',e.target.value)} className="w-full text-xs bg-transparent border-b border-slate-700 mb-1" placeholder="Upsell..."/><div className="flex gap-1"><input type="number" value={u.cost||''} onChange={(e)=>updateUpsell(p,u.id,'cost',e.target.value)} className="w-full bg-slate-900 text-[10px] p-1 rounded" placeholder="Costo"/><input type="number" value={u.price||''} onChange={(e)=>updateUpsell(p,u.id,'price',e.target.value)} className="w-full bg-blue-900 text-[10px] p-1 rounded font-bold text-blue-300" placeholder="Precio"/></div></div>
                             </div>
                           ))}
                        </div>
                        <div className="bg-gradient-to-br from-blue-600 to-blue-800 rounded-lg p-4 border border-blue-500 mt-auto">
                           <div className="flex justify-between items-end"><div><p className="text-[10px] text-blue-200 uppercase">Ganancia Total</p><p className="text-xl font-mono font-bold">{formatCurrency(m.bundleProfit)}</p></div><span className="bg-white text-blue-700 px-2 py-0.5 rounded text-sm font-bold">{m.bundleMargin.toFixed(1)}%</span></div>
                        </div>
                      </div>
                   </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
