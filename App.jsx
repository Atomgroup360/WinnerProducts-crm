import React, { useState, useEffect, useCallback } from 'react';
import { 
  Plus, 
  Trash2, 
  Upload, 
  Package, 
  TrendingUp, 
  AlertCircle, 
  CheckCircle2, 
  Beaker, 
  XCircle, 
  MoreVertical,
  Clock,
  Calculator,
  Truck,
  CreditCard,
  Target,
  RefreshCw,
  Box,
  Building2,
  Cloud,
  Users
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInAnonymously, 
  onAuthStateChanged,
  signInWithCustomToken 
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  onSnapshot,
  serverTimestamp 
} from 'firebase/firestore';

// --- Configuración de Firebase (TUS CLAVES AQUÍ) ---
// 🔴 ¡REEMPLAZA ESTE BLOQUE CON TUS CLAVES REALES DE LA CONSOLA DE FIREBASE!
const firebaseConfig = {
  apiKey: "AIzaSyATSpw_uzohLwm7zVUk3X_d6EAsDZNZLK0", // Pega tu clave real AQUÍ
  authDomain: "winnerproduct-crm.firebaseapp.com",
  projectId: "winnerproduct-crm", 
  storageBucket: "winnerproduct-crm.firebasestorage.app",
  messagingSenderId: "697988179670",
  appId: "1:697988179670:web:3910c31426d0d6e4bdcb77"
};

// *** VERIFICACIÓN CRÍTICA ***
if (firebaseConfig.apiKey.includes("EL_VALOR_DE_TU_APIKEY") || firebaseConfig.apiKey.length < 30) {
  // Esta verificación detecta si la clave está incompleta o es el placeholder
  console.error("==========================================================================================");
  console.error("🔴 ERROR CRÍTICO DE CONFIGURACIÓN:");
  console.error("   La CLAVE API (apiKey) es inválida o aún es el marcador de posición.");
  console.error("   SOLUCIÓN: Copia la clave de la Configuración de tu Proyecto de Firebase y reemplázala en App.jsx.");
  console.error("==========================================================================================");
}

// Inicializamos 'app' una sola vez (esto es correcto)
const app = initializeApp(firebaseConfig); 

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

// --- Helpers Financieros ---
const formatCurrency = (val) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(val || 0);

const calculateMetrics = (product) => {
  const c = product.costs || {};
  
  const totalProductCost = (parseFloat(c.base) || 0) + (parseFloat(c.freight) || 0) + (parseFloat(c.fulfillment) || 0) +
    (parseFloat(c.commission) || 0) + (parseFloat(c.cpa) || 0) + (parseFloat(c.returns) || 0) + (parseFloat(c.fixed) || 0);

  const productPrice = parseFloat(product.targetPrice) || 0;
  const productProfit = productPrice - totalProductCost;
  const productMargin = productPrice > 0 ? (productProfit / productPrice) * 100 : 0;

  const upsellsList = product.upsells || [];
  const upsellsCost = upsellsList.reduce((sum, u) => sum + (parseFloat(u.cost) || 0), 0);
  const upsellsPrice = upsellsList.reduce((sum, u) => sum + (parseFloat(u.price) || 0), 0);
  
  const bundleTotalCost = totalProductCost + upsellsCost;
  const bundleTotalPrice = productPrice + upsellsPrice;
  const bundleProfit = bundleTotalPrice - bundleTotalCost;
  const bundleMargin = bundleTotalPrice > 0 ? (bundleProfit / bundleTotalPrice) * 100 : 0;

  return { 
    totalProductCost, productProfit, productMargin, bundleTotalCost,
    bundleTotalPrice, bundleProfit, bundleMargin,
    upsellsCount: upsellsList.filter(u => u.name && u.price > 0).length
  };
};

// --- Componente Principal ---

export default function App() {
  const [user, setUser] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // ESTO CORRIGE EL ERROR: Inicializamos auth y db usando estados
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [appId] = useState(firebaseConfig.projectId);

  // Modal states
  const [showRejectModal, setShowRejectModal] = useState(null);
  const [rejectReason, setRejectReason] = useState("");

  // 1. Autenticación e Inicialización de Servicios (CORREGIDO)
  useEffect(() => {
    // 1. Inicializar servicios de Firebase DENTRO del useEffect
    const firebaseAuth = getAuth(app);
    const firestoreDb = getFirestore(app);
    setAuth(firebaseAuth);
    setDb(firestoreDb);

    // 2. Iniciar sesión
    const initAuth = async () => {
      try {
        // En Vercel, el __initial_auth_token no existe, por eso usamos signInAnonymously
        await signInAnonymously(firebaseAuth);
      } catch (error) {
        // Mostramos el error en la consola si no es por clave
        console.error("Auth error:", error);
      }
    };
    initAuth();
    
    // 3. Listener de estado de autenticación
    const unsubscribe = onAuthStateChanged(firebaseAuth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []); 

  // 2. Suscripción a Datos (Real-time)
  useEffect(() => {
    if (!user || !db) return; 

    // Ruta pública para compartir datos entre socios
    const q = collection(db, 'artifacts', appId, 'public', 'data', 'products');
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const loadedProducts = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      loadedProducts.sort((a, b) => {
        const tA = a.createdAt?.seconds || 0;
        const tB = b.createdAt?.seconds || 0;
        return tB - tA;
      });

      setProducts(loadedProducts);
      setLoading(false);
    }, (error) => {
      console.error("Firestore error:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user, db, appId]); 

  // --- Acciones de Base de Datos ---

  const addProduct = useCallback(async () => {
    if (!user || !db) return;
    try {
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'products'), {
        ...INITIAL_PRODUCT_STATE,
        createdAt: serverTimestamp(),
        createdBy: user.uid
      });
    } catch (e) {
      console.error("Error adding:", e);
    }
  }, [user, db, appId]);

  const updateProductField = useCallback(async (id, field, value) => {
    if (!user || !db) return;
    try {
      const productRef = doc(db, 'artifacts', appId, 'public', 'data', 'products', id);
      await updateDoc(productRef, { [field]: value });
    } catch (e) {
      console.error("Error updating:", e);
    }
  }, [user, db, appId]);

  const updateProductCost = useCallback(async (id, currentCosts, field, value) => {
    if (!user || !db) return;
    try {
      const productRef = doc(db, 'artifacts', appId, 'public', 'data', 'products', id);
      await updateDoc(productRef, { 
        costs: { ...currentCosts, [field]: parseFloat(value) } 
      });
    } catch (e) {
      console.error("Error updating cost:", e);
    }
  }, [user, db, appId]);

  const updateUpsell = useCallback(async (product, upsellId, field, value) => {
    if (!user || !db) return;
    try {
      const newUpsells = (product.upsells || []).map(u => 
        u.id === upsellId ? { ...u, [field]: value } : u
      );
      const productRef = doc(db, 'artifacts', appId, 'public', 'data', 'products', product.id);
      await updateDoc(productRef, { upsells: newUpsells });
    } catch (e) {
      console.error("Error updating upsell:", e);
    }
  }, [user, db, appId]);

  const deleteProduct = useCallback(async (id) => {
    if (!confirm('¿Estás seguro de eliminar este producto para todos los usuarios?')) return;
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'products', id));
    } catch (e) {
      console.error("Error deleting:", e);
    }
  }, [db, appId]);

  // --- Lógica de UI ---

  const handleStatusChange = async (product, newStatus) => {
    if (newStatus === 'rejected') {
      setShowRejectModal(product.id);
      setRejectReason(product.rejectionReason || "");
    } else {
      await updateProductField(product.id, 'status', newStatus);
      await updateProductField(product.id, 'rejectionReason', '');
    }
  };

  const confirmRejection = async () => {
    if (!rejectReason.trim()) return alert("Justificación requerida");
    await updateProductField(showRejectModal, 'status', 'rejected');
    await updateProductField(showRejectModal, 'rejectionReason', rejectReason);
    setShowRejectModal(null);
    setRejectReason("");
  };

  const handleImageUpload = (e, product, upsellId = null) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (upsellId) {
          updateUpsell(product, upsellId, 'image', reader.result);
        } else {
          updateProductField(product.id, 'image', reader.result);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 p-4 font-sans text-slate-800">
      <div className="max-w-[1600px] mx-auto">
        
        {/* Header */}
        <header className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
              <Cloud className="text-blue-600" />
              WINNER PRODUCT OS <span className="text-xs font-normal text-white bg-blue-600 px-2 py-0.5 rounded-full">CLOUD SYNC</span>
            </h1>
            <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
              <Users size={12}/> {loading ? 'Conectando...' : (user ? `Sincronizado. Usuario ID: ${user.uid}` : 'Autenticando...')}
            </p>
          </div>
          <button 
            onClick={addProduct}
            disabled={!user || loading}
            className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-5 py-2.5 rounded-lg shadow-lg transition-all text-sm font-bold disabled:opacity-50"
          >
            <Plus size={18} /> AGREGAR PRODUCTO
          </button>
        </header>

        {/* Loading State */}
        {loading && (
           <div className="flex justify-center items-center h-64">
             <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
           </div>
        )}

        {/* Grid */}
        {!loading && (
        <div className="grid grid-cols-1 gap-6">
          {products.length === 0 && (
            <div className="text-center py-20 bg-white rounded-xl border border-dashed border-slate-300">
              <p className="text-slate-400">La base de datos está vacía. Agrega el primer producto ganador.</p>
            </div>
          )}

          {products.map(product => {
            const statusStyle = STATUS_CONFIG[product.status] || STATUS_CONFIG.pending;
            const StatusIcon = statusStyle.icon;
            const m = calculateMetrics(product);

            return (
              <div 
                key={product.id} 
                className={`overflow-hidden transition-all duration-300 border-2 shadow-md bg-white rounded-xl ${
                  product.status === 'pending' ? 'border-slate-300' :
                  statusStyle.color.split(' ')[1]
                }`}
              >
                {/* --- Barra Superior --- */}
                <div className={`px-4 py-2 flex justify-between items-center border-b bg-opacity-10 ${
                   product.status === 'pending' ? 'bg-slate-100 border-slate-200' : 
                   statusStyle.color.replace('text-', 'bg-').split(' ')[0] + ' ' + statusStyle.color.split(' ')[1].replace('border-b-', 'border-')
                }`}>
                  <div className={`flex items-center gap-2 ${product.status === 'pending' ? 'text-slate-500' : statusStyle.color.split(' ')[2]}`}>
                    <StatusIcon size={18} />
                    <span className="font-bold uppercase tracking-wide text-xs">{statusStyle.label}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1 bg-white px-2 py-1 rounded border border-slate-200">
                        {product.origin === 'nacional' ? <span className="text-xs">🇨🇴</span> : <span className="text-xs">🚢</span>}
                        <select 
                        value={product.origin}
                        onChange={(e) => updateProductField(product.id, 'origin', e.target.value)}
                        className="text-[10px] font-bold uppercase bg-transparent outline-none cursor-pointer"
                        >
                        <option value="nacional">Nacional</option>
                        <option value="importacion">Importación</option>
                        </select>
                    </div>
                    <button onClick={() => deleteProduct(product.id)} className="text-slate-400 hover:text-red-500 transition-colors">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                <div className="flex flex-col xl:flex-row">
                  
                  {/* === COLUMNA 1: PRODUCTO === */}
                  <div className="w-full xl:w-[25%] p-5 border-r border-slate-200 bg-white flex flex-col">
                    <div className="aspect-square bg-slate-50 rounded-lg border-2 border-dashed border-slate-200 flex flex-col items-center justify-center relative overflow-hidden group hover:border-blue-400 transition-colors mb-4">
                        {product.image ? (
                        <img src={product.image} alt="Product" className="w-full h-full object-cover" />
                        ) : (
                        <div className="text-center p-4">
                            <Upload className="mx-auto text-slate-300 mb-2" />
                            <span className="text-[10px] text-slate-400 uppercase font-bold">Foto Principal</span>
                        </div>
                        )}
                        <input type="file" accept="image/*" onChange={(e) => handleImageUpload(e, product)} className="absolute inset-0 opacity-0 cursor-pointer" />
                    </div>
                    <input 
                        type="text" 
                        value={product.name}
                        onChange={(e) => updateProductField(product.id, 'name', e.target.value)}
                        placeholder="Nombre del Producto..."
                        className="w-full text-lg font-black text-slate-800 border-b border-transparent hover:border-slate-300 focus:border-blue-500 focus:outline-none bg-transparent mb-2"
                    />
                    <textarea 
                        value={product.description}
                        onChange={(e) => updateProductField(product.id, 'description', e.target.value)}
                        placeholder="Copy / Descripción..."
                        rows={4}
                        className="w-full text-xs text-slate-600 bg-slate-50 border-0 rounded p-2 focus:ring-1 focus:ring-blue-200 outline-none resize-none flex-1"
                    />
                  </div>

                  {/* === COLUMNA 2: COSTOS === */}
                  <div className="flex-1 p-5 bg-slate-50 border-r border-slate-200 flex flex-col">
                    <div className="flex items-center gap-2 mb-4">
                        <CreditCard size={16} className="text-slate-500"/>
                        <h3 className="font-bold text-slate-700 text-sm uppercase">Costos & Márgenes</h3>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                        {[
                          { key: 'base', label: 'Costo Base', icon: Package, color: 'text-slate-400' },
                          { key: 'cpa', label: 'CPA (Ads)', icon: Target, color: 'text-purple-400' },
                          { key: 'freight', label: 'Flete', icon: Truck, color: 'text-slate-400' },
                          { key: 'fulfillment', label: 'Logística/FF', icon: Box, color: 'text-slate-400' },
                          { key: 'commission', label: 'Comisiones', icon: CreditCard, color: 'text-slate-400' },
                          { key: 'returns', label: 'Devoluciones', icon: RefreshCw, color: 'text-orange-400' },
                          { key: 'fixed', label: 'Costos Fijos', icon: Building2, color: 'text-slate-400' },
                        ].map((field) => (
                           <div key={field.key} className="bg-white p-2 rounded border border-slate-200 shadow-sm">
                              <label className={`flex items-center gap-1 text-[10px] font-bold ${field.color} uppercase mb-1`}>
                                  <field.icon size={10} /> {field.label}
                              </label>
                              <input 
                                type="number" 
                                value={product.costs?.[field.key] || ''} 
                                onChange={(e) => updateProductCost(product.id, product.costs, field.key, e.target.value)} 
                                className={`w-full font-mono text-sm outline-none ${field.key === 'cpa' ? 'text-purple-700' : 'text-slate-700'}`} 
                                placeholder="0"
                              />
                           </div>
                        ))}
                    </div>

                    {/* Resumen Financiero Producto Individual */}
                    <div className="bg-slate-200 rounded-lg p-4 mt-auto">
                        <div className="flex justify-between items-end mb-4 border-b border-slate-300 pb-3">
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Precio Objetivo</label>
                                <div className="flex items-center bg-white rounded px-2 py-1">
                                    <span className="text-slate-400 text-sm mr-1">$</span>
                                    <input 
                                        type="number" 
                                        value={product.targetPrice || ''} 
                                        onChange={(e) => updateProductField(product.id, 'targetPrice', parseFloat(e.target.value))} 
                                        className="bg-transparent font-mono font-bold text-xl text-slate-800 outline-none w-40" 
                                        placeholder="0" 
                                    />
                                </div>
                            </div>
                            <div className="text-right">
                                <label className="text-[10px] font-bold text-red-500 uppercase block">Costo Total Real</label>
                                <span className="font-mono text-sm text-red-600 block">{formatCurrency(m.totalProductCost)}</span>
                            </div>
                        </div>
                        
                        <div className="flex items-center justify-between">
                            <div className="text-xs font-bold text-slate-500 uppercase">Utilidad Neta (Solo Prod.)</div>
                            <div className="text-right flex items-center gap-4">
                                <span className={`font-mono text-2xl font-black ${m.productProfit > 0 ? 'text-slate-800' : 'text-red-500'}`}>
                                    {formatCurrency(m.productProfit)}
                                </span>
                                <span className={`px-2 py-1 rounded text-sm font-bold ${m.productMargin > 25 ? 'bg-green-100 text-green-700' : m.productMargin > 10 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                                    {m.productMargin.toFixed(1)}%
                                </span>
                            </div>
                        </div>
                    </div>
                    
                    <div className="mt-4 flex flex-wrap gap-2">
                        {Object.values(STATUS_CONFIG).map((status) => (
                            <button
                            key={status.id}
                            onClick={() => handleStatusChange(product, status.id)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-all ${
                                product.status === status.id 
                                ? 'ring-2 ring-offset-1 ' + (status.id === 'pending' ? 'ring-slate-400 bg-slate-200 text-slate-800' : 'ring-blue-500 ' + status.color)
                                : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'
                            }`}
                            >
                            <status.icon size={14} />
                            {status.label}
                            </button>
                        ))}
                    </div>

                    {product.status === 'rejected' && (
                        <div className="mt-2 text-xs text-red-600 bg-red-50 p-2 rounded border border-red-100 animate-in fade-in">
                            <strong>Motivo:</strong> {product.rejectionReason}
                        </div>
                    )}
                  </div>

                  {/* === COLUMNA 3: UPSELLS === */}
                  <div className="w-full xl:w-[28%] bg-slate-900 text-white p-5 flex flex-col">
                    <div className="flex items-center gap-2 mb-3 pb-2 border-b border-slate-700">
                      <Calculator size={16} className="text-green-400"/>
                      <span className="text-xs font-bold uppercase tracking-wider">Métricas de la Oferta Total</span>
                    </div>

                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-bold text-xs uppercase flex items-center gap-2 text-blue-400">
                            <MoreVertical size={14} /> Upsells ({m.upsellsCount})
                        </h3>
                        <span className="text-[9px] bg-slate-800 text-slate-400 px-2 py-1 rounded border border-slate-700">
                           BUNDLE
                        </span>
                    </div>

                    <div className="space-y-2 mb-6 overflow-y-auto max-h-[300px] flex-1 pr-1 custom-scrollbar">
                         {(product.upsells || []).map((upsell) => (
                        <div key={upsell.id} className="bg-slate-800 p-2 rounded border border-slate-700 flex gap-2 group hover:border-slate-600 transition-colors">
                          <div className="w-10 h-10 bg-slate-700 rounded shrink-0 relative overflow-hidden mt-1">
                             {upsell.image ? (
                                <img src={upsell.image} className="w-full h-full object-cover" />
                             ) : (
                                <div className="w-full h-full flex items-center justify-center text-slate-500">
                                  <Plus size={12} />
                                </div>
                             )}
                             <input type="file" accept="image/*" onChange={(e) => handleImageUpload(e, product, upsell.id)} className="absolute inset-0 opacity-0 cursor-pointer" />
                          </div>
                          
                          <div className="flex-1 min-w-0">
                             <input 
                                type="text" 
                                value={upsell.name}
                                onChange={(e) => updateUpsell(product, upsell.id, 'name', e.target.value)}
                                className="w-full text-xs font-medium text-slate-200 bg-transparent border-b border-slate-700 focus:border-blue-500 focus:outline-none mb-1.5 pb-0.5 placeholder-slate-600"
                                placeholder={`Upsell #${upsell.id}`}
                              />
                             <div className="flex gap-2">
                                <div className="flex-1 bg-slate-900/50 rounded px-1.5 py-0.5 border border-slate-700">
                                    <label className="text-[8px] text-slate-500 block uppercase">Costo</label>
                                    <input 
                                        type="number" 
                                        value={upsell.cost || ''} 
                                        onChange={(e) => updateUpsell(product, upsell.id, 'cost', parseFloat(e.target.value))}
                                        className="w-full bg-transparent text-xs font-mono outline-none text-slate-300" 
                                        placeholder="0"
                                    />
                                </div>
                                <div className="flex-1 bg-blue-900/20 rounded px-1.5 py-0.5 border border-blue-900/30">
                                    <label className="text-[8px] text-blue-400 block uppercase">Venta</label>
                                    <input 
                                        type="number" 
                                        value={upsell.price || ''} 
                                        onChange={(e) => updateUpsell(product, upsell.id, 'price', parseFloat(e.target.value))}
                                        className="w-full bg-transparent text-xs font-mono font-bold text-blue-400 outline-none" 
                                        placeholder="0"
                                    />
                                </div>
                             </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* RESULTADO ESCENARIO BUNDLE */}
                    <div className="mt-auto bg-gradient-to-br from-blue-600 to-blue-800 rounded-lg p-4 shadow-lg border border-blue-500">
                        <div className="flex items-center gap-2 mb-3 pb-2 border-b border-blue-500/50">
                            <TrendingUp size={16} className="text-white"/>
                            <span className="text-xs font-black uppercase tracking-wider text-white">Escenario Total</span>
                        </div>
                        
                        <div className="space-y-2">
                            <div className="flex justify-between text-xs text-blue-100">
                                <span>Precio Total Venta:</span>
                                <span className="font-mono">{formatCurrency(m.bundleTotalPrice)}</span>
                            </div>
                            <div className="flex justify-between text-xs text-blue-100">
                                <span>Costo Total Bundle:</span>
                                <span className="font-mono text-blue-200">{formatCurrency(m.bundleTotalCost)}</span>
                            </div>
                            
                            <div className="pt-2 mt-2 border-t border-blue-500/50 flex justify-between items-end">
                                <div>
                                    <p className="text-[10px] text-blue-200 uppercase mb-0.5">Ganancia Neta</p>
                                    <p className="text-xl font-mono font-bold text-white">{formatCurrency(m.bundleProfit)}</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-[10px] text-blue-200 uppercase mb-0.5">Margen</p>
                                    <span className={`px-2 py-0.5 rounded text-sm font-bold shadow-sm ${m.bundleMargin < 20 ? 'bg-orange-100 text-orange-800' : 'bg-white text-blue-700'}`}>
                                        {m.bundleMargin.toFixed(1)}%
                                    </span>
                                </div>
                            </div>
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
      
       {showRejectModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
              <XCircle className="text-red-500" /> Motivo del Rechazo
            </h3>
            <textarea
              autoFocus
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:border-red-500 outline-none h-32 resize-none mb-4"
              placeholder="Justificación obligatoria..."
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowRejectModal(null)} className="px-4 py-2 text-sm text-gray-600 font-medium hover:bg-gray-100 rounded-lg">Cancelar</button>
              <button onClick={confirmRejection} className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg">Rechazar Producto</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
