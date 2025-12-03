Import React, { useState, useEffect, useCallback } from 'react';
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
// NOTA: REEMPLAZA ESTE BLOQUE CON TUS CLAVES O LA APLICACIÓN NO FUNCIONARÁ.
const firebaseConfig = {
  apiKey: "AIzaSyATSpw_uzohLwm7zVUk3X_d6EAsDZNZLK0",
  authDomain: "winnerproduct-crm.firebaseapp.com",
  projectId: "winnerproduct-crm",
  storageBucket: "winnerproduct-crm.firebasestorage.app",
  messagingSenderId: "697988179670",
  appId: "1:697988179670:web:3910c31426d0d6e4bdcb77"
};


// Inicializamos 'app' fuera del componente, pero los servicios 'auth' y 'db' se inicializan en el useEffect.
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
  
  // AHORA DEFINIMOS LAS VARIABLES DE CONEXIÓN DENTRO DEL COMPONENTE (USANDO EL ESTADO)
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [appId] = useState(firebaseConfig.projectId);

  // Modal states
  const [showRejectModal, setShowRejectModal] = useState(null);
  const [rejectReason, setRejectReason] = useState("");

  // 1. Autenticación e Inicialización de Servicios (CORREGIDO)
  useEffect(() => {
    // 1. Inicializar servicios de Firebase
    const firebaseAuth = getAuth(app);
    const firestoreDb = getFirestore(app);
    setAuth(firebaseAuth);
    setDb(firestoreDb);

    // 2. Iniciar sesión
    const initAuth = async () => {
      // Nota: Asumimos que __initial_auth_token no existe en Vercel, por eso usamos signInAnonymously
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(firebaseAuth, __initial_auth_token);
        } else {
          await signInAnonymously(firebaseAuth);
        }
      } catch (error) {
        console.error("Auth error:", error);
      }
    };
    initAuth();
    
    // 3. Listener de estado de autenticación
    const unsubscribe = onAuthStateChanged(firebaseAuth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []); // Se ejecuta solo una vez al montar

  // 2. Suscripción a Datos (Real-time)
  useEffect(() => {
    if (!user || !db) return; // Solo se ejecuta si hay usuario y DB

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
  }, [user, db, appId]); // Depende de que 'user' y 'db' estén listos

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
                                <span cla
