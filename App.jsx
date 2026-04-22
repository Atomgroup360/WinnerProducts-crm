import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, collection, addDoc, updateDoc, deleteDoc, doc, 
  onSnapshot, serverTimestamp 
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

// Enrutador dinámico para evitar bloqueos de permisos en diferentes entornos
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

// --- FABRICANTES DE ESTADO INICIAL ---
const getInitialWinner = () => ({
  type: 'winner',
  name: '', dropiCode: '', supplier: '', description: '',
  costs: { base: 0, freight: 0, fulfillment: 0, commission: 0, cpa: 0, returns: 0, fixed: 0 },
  targetPrice: 0, status: 'pending', rejectionReason: '', image: null, order: 0,
  isWorking: false,
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
  measures: { width: 0, height: 0, length: 0 },
  purchaseDate: '', advancePayment: 0, buyer: '', estimatedArrival: '',
  colors: Array(7).fill(0).map((_, i) => ({ id: i+1, color: '', qty: 0 }))
});

// --- AYUDANTES ---
const formatCurrency = (val) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(val || 0);

const calculateWinnerMetrics = (p) => {
  if (!p) return { totalCost: 0, totalPrice: 0, profit: 0, margin: 0, activeUpsells: 0 };
  const c = p.costs || {};
  const baseCost = (parseFloat(c.base)||0) + (parseFloat(c.freight)||0) + (parseFloat(c.fulfillment)||0) +
    (parseFloat(c.commission)||0) + (parseFloat(c.cpa)||0) + (parseFloat(c.returns)||0) + (parseFloat(c.fixed)||0);
  const basePrice = parseFloat(p.targetPrice) || 0;
  const upsells = p.upsells || [];
  const uCost = upsells.reduce((sum, u) => sum + (parseFloat(u.cost)||0), 0);
  const uPrice = upsells.reduce((sum, u) => sum + (parseFloat(u.price)||0), 0);
  const totalCost = baseCost + uCost;
  const totalPrice = basePrice + uPrice;
  const profit = totalPrice - totalCost;
  const margin = totalPrice > 0 ? (profit / totalPrice) * 100 : 0;
  return { totalCost, totalPrice, profit, margin, activeUpsells: upsells.filter(u => u.name).length };
};

const calculateImportMetrics = (p) => {
  if (!p) return { cbmPerCtn: 0, totalCbm: 0, costChinaCOP: 0, nationalizationCOP: 0, totalLandCostCOP: 0, unitCostColombia: 0 };
  const m = p.measures || { width: 0, height: 0, length: 0 };
  const cbmPerCtn = (parseFloat(m.width) * parseFloat(m.height) * parseFloat(m.length)) / 1000000;
  const totalCbm = cbmPerCtn * (parseFloat(p.ctnQty) || 0);
  const costChinaUSD = ((parseFloat(p.prodCostUSD) || 0) * (parseFloat(p.unitsQty) || 0)) + (parseFloat(p.yiwuFreightUSD) || 0);
  const costChinaCOP = costChinaUSD * (parseFloat(p.dollarRate) || 0) * 1.03;
  const nationalizationCOP = totalCbm * (parseFloat(p.cbmCostCOP) || 0);
  const totalLandCostCOP = costChinaCOP + nationalizationCOP;
  const unitCostColombia = (parseFloat(p.unitsQty) > 0) ? totalLandCostCOP / parseFloat(p.unitsQty) : 0;
  return { cbmPerCtn, totalCbm, costChinaCOP, nationalizationCOP, totalLandCostCOP, unitCostColombia };
};

// --- COMPRESOR DE IMÁGENES ---
const compressImage = (base64Str) => {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const MAX_WIDTH = 800;
      const MAX_HEIGHT = 800;
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > MAX_WIDTH) { height = Math.round((height * MAX_WIDTH) / width); width = MAX_WIDTH; }
      } else {
        if (height > MAX_HEIGHT) { width = Math.round((width * MAX_HEIGHT) / height); height = MAX_HEIGHT; }
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.7)); 
    };
  });
};

// --- COMPONENTE LOGIN ---
function LoginScreen({ setErrorExt }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      console.error(err);
      let msg = 'Credenciales inválidas.';
      if (err.code === 'auth/network-request-failed') msg = 'Error de red o API restringida.';
      setError(msg);
      setErrorExt(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f1f5f9] flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-[2.5rem] shadow-2xl p-8 md:p-12 border border-zinc-200/50 animate-in zoom-in-95 duration-300 text-center">
        <div className="w-20 h-20 bg-zinc-900 rounded-[1.5rem] flex items-center justify-center text-white text-4xl shadow-xl italic font-black mx-auto mb-6">W</div>
        <h1 className="text-3xl font-black tracking-tighter uppercase italic text-zinc-900 leading-none">Winner OS</h1>
        <p className="text-zinc-400 text-[10px] font-bold mt-2 tracking-widest uppercase mb-10 text-center w-full">Cloud Management System</p>
        
        <form onSubmit={handleLogin} className="space-y-6 text-left">
          <div>
            <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block mb-2 px-1 leading-none">Correo Electrónico</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full bg-zinc-50 border-2 border-zinc-100 rounded-2xl p-4 text-sm focus:outline-none focus:border-zinc-900 transition-all text-zinc-700 outline-none" placeholder="admin@winneros.com"/>
          </div>
          <div>
            <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block mb-2 px-1 leading-none">Contraseña</label>
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full bg-zinc-50 border-2 border-zinc-100 rounded-2xl p-4 text-sm focus:outline-none focus:border-zinc-900 transition-all text-zinc-700 outline-none" placeholder="••••••••"/>
          </div>
          {error && <div className="bg-rose-50 border border-rose-100 p-4 rounded-2xl text-rose-600 text-[11px] font-bold uppercase text-center leading-tight">⚠️ {error}</div>}
          <button type="submit" disabled={loading} className="w-full bg-zinc-900 hover:bg-black text-white font-black py-5 rounded-2xl text-xs shadow-2xl transition-all uppercase tracking-[0.2em] active:scale-[0.98] disabled:opacity-50">
            {loading ? 'Validando...' : 'Entrar al Sistema'}
          </button>
        </form>
      </div>
    </div>
  );
}

// --- COMPONENTE PRINCIPAL ---
export default function App() {
  const [activeModule, setActiveModule] = useState('winners');
  const [user, setUser] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('pending');
  const [isCreating, setIsCreating] = useState(false);
  const [newProduct, setNewProduct] = useState(getInitialWinner());
  const [expandedItems, setExpandedItems] = useState({});
  const [notification, setNotification] = useState('');
  const [formError, setFormError] = useState('');

  // NUEVO: Estados para Filtros y Ordenamiento
  const [searchTerm, setSearchTerm] = useState('');
  const [sortOrder, setSortOrder] = useState('recent'); // 'recent', 'roi-desc', 'roi-asc'
  const [supplierFilter, setSupplierFilter] = useState('all');

  // 1. Escuchar Auth
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // 2. Escuchar Firestore
  useEffect(() => {
    if (!user) return;
    const colName = activeModule === 'winners' ? 'products' : 'import_products';
    const q = collection(db, 'artifacts', appId, 'public', 'data', colName);
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const loaded = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      loaded.sort((a, b) => (a.order || 0) - (b.order || 0));
      setProducts(loaded);
    }, (error) => {
      console.error("Firestore Error:", error);
      setNotification(`Error de acceso: No tienes permisos.`);
      setTimeout(() => setNotification(''), 4000);
    });
    return () => unsubscribe();
  }, [user, activeModule]);

  // Obtener lista única de proveedores para el filtro
  const uniqueSuppliers = useMemo(() => {
    const field = activeModule === 'winners' ? 'supplier' : 'chineseSupplier';
    const list = products.map(p => p[field]).filter(Boolean);
    return ['all', ...new Set(list)];
  }, [products, activeModule]);

  // Lógica de Filtrado y Ordenamiento Combinada
  const displayedProducts = useMemo(() => {
    let result = products.filter(p => {
      const matchesTab = p.status === activeTab;
      const matchesSearch = p.name?.toLowerCase().includes(searchTerm.toLowerCase()) || 
                           p.dropiCode?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           p.chineseSupplier?.toLowerCase().includes(searchTerm.toLowerCase());
      
      const supplierField = activeModule === 'winners' ? 'supplier' : 'chineseSupplier';
      const matchesSupplier = supplierFilter === 'all' || p[supplierField] === supplierFilter;

      return matchesTab && matchesSearch && matchesSupplier;
    });

    // Aplicar Ordenamiento
    return [...result].sort((a, b) => {
      if (sortOrder === 'recent') return (b.order || 0) - (a.order || 0);
      
      const valA = activeModule === 'winners' ? calculateWinnerMetrics(a).margin : calculateImportMetrics(a).unitCostColombia;
      const valB = activeModule === 'winners' ? calculateWinnerMetrics(b).margin : calculateImportMetrics(b).unitCostColombia;

      if (sortOrder === 'roi-desc') return valB - valA;
      if (sortOrder === 'roi-asc') return valA - valB;
      return 0;
    });
  }, [products, activeTab, searchTerm, supplierFilter, sortOrder, activeModule]);

  const handleLogout = () => signOut(auth);

  const handleModuleChange = (mod) => {
    setProducts([]); 
    setActiveModule(mod);
    setActiveTab('pending');
    setSearchTerm('');
    setSupplierFilter('all');
    setSortOrder('recent');
    setNewProduct(mod === 'winners' ? getInitialWinner() : getInitialImport());
    setIsCreating(false);
    setFormError('');
  };

  const copyToClipboard = (text) => {
    if (!text) return;
    const textArea = document.createElement("textarea");
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    setNotification(`Copiado: ${text}`);
    setTimeout(() => setNotification(''), 2000);
    document.body.removeChild(textArea);
  };

  const handleSave = async () => {
    setFormError('');

    if (!newProduct.name || newProduct.name.trim() === '') {
      setFormError('⚠️ ERROR: Debes escribir un "Nombre" para el producto.');
      return; 
    }
    
    setIsSaving(true);
    const colName = activeModule === 'winners' ? 'products' : 'import_products';
    const regPrefix = activeModule === 'winners' ? 'WIN' : 'IMP';
    const regNumber = `${regPrefix}-${(products.length + 1).toString().padStart(3, '0')}`;
    
    try {
      if (!auth.currentUser) throw new Error("Debes iniciar sesión para crear registros");

      const payloadRaw = {
        ...newProduct,
        regNumber,
        order: Date.now(),
        createdBy: auth.currentUser.uid
      };

      const cleanPayload = JSON.parse(JSON.stringify(payloadRaw));
      cleanPayload.createdAt = serverTimestamp();

      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', colName), cleanPayload);
      
      setIsCreating(false);
      setNewProduct(activeModule === 'winners' ? getInitialWinner() : getInitialImport());
      setActiveTab('pending'); 
      setFormError('');
      
      setNotification('¡Registro guardado en la Nube! ✨');
      setTimeout(() => setNotification(''), 3000);

    } catch (e) { 
      console.error("Firebase Save Error:", e); 
      setFormError(`⚠️ FALLO DE SERVIDOR: ${e.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const updateDocField = async (id, f, v) => {
    const colName = activeModule === 'winners' ? 'products' : 'import_products';
    try { await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', colName, id), { [f]: v }); } catch (e) { console.error(e); }
  };

  const updateNestedField = async (id, parent, f, v) => {
    const colName = activeModule === 'winners' ? 'products' : 'import_products';
    const item = products.find(x => x.id === id);
    if (!item) return;
    try { await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', colName, id), { [parent]: { ...item[parent], [f]: v } }); } catch (e) { console.error(e); }
  };

  const updateUpsell = async (p, uid, f, v) => {
    const currentUpsells = p.upsells || getInitialWinner().upsells;
    const newUpsells = currentUpsells.map(u => u.id === uid ? { ...u, [f]: v } : u);
    try { await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'products', p.id), { upsells: newUpsells }); } catch (e) { console.error(e); }
  };

  const resetUpsell = async (p, uid) => {
    const currentUpsells = p.upsells || getInitialWinner().upsells;
    const clearedUpsells = currentUpsells.map(u => u.id === uid ? { id: uid, name: '', cost: 0, price: 0, image: null } : u);
    try { await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'products', p.id), { upsells: clearedUpsells }); } catch (e) { console.error(e); }
  };

  const deleteItem = async (id) => {
    if (window.confirm('¿Estás seguro de borrar este registro de la base de datos?')) {
      const colName = activeModule === 'winners' ? 'products' : 'import_products';
      try { await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', colName, id)); } catch (e) { console.error(e); }
    }
  };

  const moveItem = async (id, dir) => {
    const colName = activeModule === 'winners' ? 'products' : 'import_products';
    const list = products.filter(p => p.status === activeTab);
    const idx = list.findIndex(p => p.id === id);
    const targetIdx = idx + dir;
    if (targetIdx >= 0 && targetIdx < list.length) {
      const a = list[idx], b = list[targetIdx];
      try {
          await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', colName, a.id), { order: b.order || Date.now() });
          await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', colName, b.id), { order: a.order || Date.now() - 100 });
      } catch (e) { console.error(e); }
    }
  };

  const handleImage = (e, targetId = null, upsellId = null) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onloadend = async () => {
      let result = reader.result;
      
      if (file.size > 500 * 1024) {
        try { result = await compressImage(reader.result); } catch(err) { console.error("Error comprimiendo:", err); }
      }

      if (!targetId) {
        if (upsellId) {
          const up = (newProduct.upsells || []).map(u => u.id === upsellId ? {...u, image: result} : u);
          setNewProduct({...newProduct, upsells: up});
        } else {
          setNewProduct({...newProduct, image: result});
        }
      } else {
        const colName = activeModule === 'winners' ? 'products' : 'import_products';
        const item = products.find(x => x.id === targetId);
        if (!item) return;
        if (upsellId) {
          const up = (item.upsells || getInitialWinner().upsells).map(u => u.id === upsellId ? {...u, image: result} : u);
          updateDoc(doc(db, 'artifacts', appId, 'public', 'data', colName, targetId), { upsells: up });
        } else {
          updateDoc(doc(db, 'artifacts', appId, 'public', 'data', colName, targetId), { image: result });
        }
      }
    };
    reader.readAsDataURL(file);
  };

  if (loading) return <div className="min-h-screen bg-[#f1f5f9] flex items-center justify-center font-bold text-zinc-400 animate-pulse uppercase tracking-[0.3em]">Cargando Sistema...</div>;
  if (!user) return <LoginScreen setErrorExt={setNotification} />;

  const renderCreationForm = () => {
    if (activeModule === 'winners') {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 text-zinc-900 text-left">
          <div className="space-y-4">
            <div className="aspect-square bg-zinc-50 rounded-xl md:rounded-2xl border-2 border-dashed border-zinc-200 relative flex items-center justify-center overflow-hidden shadow-inner group max-w-sm mx-auto w-full">
              {newProduct.image ? <img src={newProduct.image} className="w-full h-full object-cover" alt="Preview"/> : <span className="text-zinc-300 font-bold text-[10px] uppercase">Foto Winner</span>}
              <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e)=>handleImage(e)}/>
            </div>
            <div className="relative">
                <input value={newProduct.name || ''} onChange={(e)=>setNewProduct({...newProduct, name: e.target.value})} className="w-full border-b-2 border-zinc-200 pb-2 font-bold text-xl md:text-2xl outline-none focus:border-zinc-900 bg-transparent text-zinc-900 placeholder:text-zinc-300" placeholder="* Nombre Comercial (Obligatorio)"/>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[9px] font-black text-zinc-400 uppercase px-1 leading-none">CÓDIGO DROPI</label>
                <input value={newProduct.dropiCode || ''} onChange={(e)=>setNewProduct({...newProduct, dropiCode: e.target.value})} className="bg-zinc-50 border border-zinc-100 rounded-xl p-3 text-xs font-mono w-full text-zinc-800 outline-none" placeholder="ID-000"/>
              </div>
              <div>
                <label className="text-[9px] font-black text-zinc-400 uppercase px-1 leading-none">Proveedor</label>
                <input value={newProduct.supplier || ''} onChange={(e)=>setNewProduct({...newProduct, supplier: e.target.value})} className="bg-zinc-50 border border-zinc-100 rounded-xl p-3 text-xs w-full text-zinc-800 outline-none" placeholder="Nombre..."/>
              </div>
            </div>
            <textarea value={newProduct.description || ''} onChange={(e)=>setNewProduct({...newProduct, description: e.target.value})} rows={3} className="w-full bg-zinc-50 border border-zinc-100 rounded-xl p-4 text-xs resize-none outline-none text-zinc-600" placeholder="Estrategia estratégica..."/>
          </div>
          <div className="space-y-6">
            <div className="bg-zinc-50 p-4 md:p-6 rounded-2xl border border-zinc-100 shadow-sm">
              <h3 className="text-[10px] font-black uppercase text-zinc-400 mb-4 border-b pb-2">Costos Winner (COP)</h3>
              <div className="grid grid-cols-2 gap-3">
                {['base', 'cpa', 'freight', 'fulfillment', 'commission', 'returns', 'fixed'].map(k => (
                  <div key={k}><label className="text-[8px] font-bold text-zinc-500 uppercase block mb-1 leading-none">{k}</label>
                  <input type="number" value={newProduct.costs?.[k] || ''} onChange={(e)=>setNewProduct({...newProduct, costs: {...newProduct.costs, [k]: parseFloat(e.target.value)||0}})} className="w-full bg-white border border-zinc-200 rounded-lg p-2 text-sm font-mono text-zinc-800 outline-none"/></div>
                ))}
              </div>
            </div>
            <div className="bg-zinc-900 p-5 md:p-6 rounded-2xl text-white shadow-xl">
              <label className="text-[9px] font-bold uppercase text-zinc-500 mb-2 block leading-none">PVP Sugerido</label>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold opacity-30">$</span>
                <input type="number" value={newProduct.targetPrice || ''} onChange={(e)=>setNewProduct({...newProduct, targetPrice: parseFloat(e.target.value)||0})} className="w-full bg-transparent border-b border-zinc-700 text-3xl md:text-4xl font-bold outline-none text-white"/>
              </div>
            </div>
          </div>
        </div>
      );
    } else {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 text-zinc-900 text-left">
          <div className="space-y-4">
            <div className="aspect-square bg-zinc-50 rounded-xl md:rounded-2xl border-2 border-dashed border-zinc-200 relative flex items-center justify-center overflow-hidden shadow-inner group max-w-sm mx-auto w-full">
              {newProduct.image ? <img src={newProduct.image} className="w-full h-full object-cover" alt="Preview"/> : <span className="text-zinc-300 font-bold text-[10px] uppercase">Foto Importación</span>}
              <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e)=>handleImage(e)}/>
            </div>
            <div className="relative">
                <input value={newProduct.name || ''} onChange={(e)=>setNewProduct({...newProduct, name: e.target.value})} className="w-full border-b-2 border-zinc-200 pb-2 font-bold text-xl md:text-2xl outline-none focus:border-zinc-900 bg-transparent text-zinc-900 placeholder:text-zinc-300" placeholder="* Nombre Producto (Obligatorio)"/>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="text-left">
                <label className="text-[9px] font-black text-zinc-400 uppercase px-1 leading-none">Proveedor Chino</label>
                <input value={newProduct.chineseSupplier || ''} onChange={(e)=>setNewProduct({...newProduct, chineseSupplier: e.target.value})} className="bg-zinc-50 border border-zinc-100 rounded-xl p-3 text-xs w-full text-zinc-800 outline-none" placeholder="Nombre..."/>
              </div>
              <div className="text-left">
                <label className="text-[9px] font-black text-zinc-400 uppercase px-1 leading-none">Dólar Hoy</label>
                <input type="number" value={newProduct.dollarRate || ''} onChange={(e)=>setNewProduct({...newProduct, dollarRate: parseFloat(e.target.value)||0})} className="bg-zinc-50 border border-zinc-100 rounded-xl p-3 text-xs font-mono w-full text-zinc-800 outline-none" placeholder="0.00"/>
              </div>
            </div>
          </div>
          <div className="space-y-4">
            <div className="bg-zinc-50 p-4 rounded-xl border border-zinc-100 grid grid-cols-2 gap-3 md:gap-4 text-left">
                <div><label className="text-[8px] font-black text-zinc-400 uppercase">Costo USD</label>
                <input type="number" value={newProduct.prodCostUSD || ''} onChange={(e)=>setNewProduct({...newProduct, prodCostUSD: parseFloat(e.target.value)||0})} className="w-full bg-white border border-zinc-200 rounded-lg p-2 text-sm text-zinc-800 outline-none"/></div>
                <div><label className="text-[8px] font-black text-zinc-400 uppercase">Costo CBM</label>
                <input type="number" value={newProduct.cbmCostCOP || ''} onChange={(e)=>setNewProduct({...newProduct, cbmCostCOP: parseFloat(e.target.value)||0})} className="w-full bg-white border border-zinc-200 rounded-lg p-2 text-sm text-zinc-800 outline-none"/></div>
                <div><label className="text-[8px] font-black text-zinc-400 uppercase">Unidades</label>
                <input type="number" value={newProduct.unitsQty || ''} onChange={(e)=>setNewProduct({...newProduct, unitsQty: parseFloat(e.target.value)||0})} className="w-full bg-white border border-zinc-200 rounded-lg p-2 text-sm text-zinc-800 outline-none"/></div>
                <div><label className="text-[8px] font-black text-zinc-400 uppercase">CTN qty</label>
                <input type="number" value={newProduct.ctnQty || ''} onChange={(e)=>setNewProduct({...newProduct, ctnQty: parseFloat(e.target.value)||0})} className="w-full bg-white border border-zinc-200 rounded-lg p-2 text-sm text-zinc-800 outline-none"/></div>
                <div className="col-span-2"><label className="text-[8px] font-black text-zinc-400 uppercase">Flete YIWU (USD)</label>
                <input type="number" value={newProduct.yiwuFreightUSD || ''} onChange={(e)=>setNewProduct({...newProduct, yiwuFreightUSD: parseFloat(e.target.value)||0})} className="w-full bg-white border border-zinc-200 rounded-lg p-2 text-sm text-zinc-800 outline-none"/></div>
            </div>
            <div className="bg-zinc-50 p-4 rounded-xl border border-zinc-100 text-left">
                <h4 className="text-[8px] font-black text-zinc-400 uppercase mb-2 px-1">Medidas CTN (W x H x L cm)</h4>
                <div className="grid grid-cols-3 gap-2 px-1">
                    <input type="number" value={newProduct.measures?.width || ''} placeholder="W" onChange={(e)=>setNewProduct({...newProduct, measures: {...newProduct.measures, width: parseFloat(e.target.value)||0}})} className="bg-white border border-zinc-200 p-2 rounded text-xs w-full text-zinc-800 outline-none"/>
                    <input type="number" value={newProduct.measures?.height || ''} placeholder="H" onChange={(e)=>setNewProduct({...newProduct, measures: {...newProduct.measures, height: parseFloat(e.target.value)||0}})} className="bg-white border border-zinc-200 p-2 rounded text-xs w-full text-zinc-800 outline-none"/>
                    <input type="number" value={newProduct.measures?.length || ''} placeholder="L" onChange={(e)=>setNewProduct({...newProduct, measures: {...newProduct.measures, length: parseFloat(e.target.value)||0}})} className="bg-white border border-zinc-200 p-2 rounded text-xs w-full text-zinc-800 outline-none"/>
                </div>
            </div>
          </div>
        </div>
      );
    }
  };

  return (
    <div className="min-h-screen bg-[#f1f5f9] p-3 md:p-8 font-sans text-zinc-900 overflow-x-hidden">
      
      {notification && (
        <div className="fixed bottom-6 md:bottom-10 left-1/2 transform -translate-x-1/2 bg-zinc-900 text-white px-6 md:px-8 py-3 md:py-4 rounded-xl md:rounded-2xl shadow-2xl z-[200] font-bold text-[10px] md:text-xs uppercase tracking-widest animate-in slide-in-from-bottom-10 w-[90%] md:w-auto text-center leading-tight">
          {notification}
        </div>
      )}

      <div className="max-w-[1400px] mx-auto">
        
        {/* NAVEGACIÓN */}
        <div className="flex flex-col md:flex-row justify-between items-center mb-6 md:mb-8 gap-4">
            <div className="bg-white p-1 rounded-2xl md:rounded-[2rem] shadow-xl border border-zinc-200 flex w-full md:w-auto">
                <button onClick={()=>handleModuleChange('winners')} className={`flex-1 md:flex-none md:px-10 py-2.5 md:py-3 rounded-xl md:rounded-[1.5rem] text-[9px] md:text-[11px] font-black uppercase tracking-wider md:tracking-[0.2em] transition-all duration-500 ${activeModule === 'winners' ? 'bg-zinc-900 text-white shadow-lg scale-105' : 'text-zinc-400'}`}>Winners</button>
                <button onClick={()=>handleModuleChange('imports')} className={`flex-1 md:flex-none md:px-10 py-2.5 md:py-3 rounded-xl md:rounded-[1.5rem] text-[9px] md:text-[11px] font-black uppercase tracking-wider md:tracking-[0.2em] transition-all duration-500 ${activeModule === 'imports' ? 'bg-zinc-900 text-white shadow-lg scale-105' : 'text-zinc-400'}`}>Importación</button>
            </div>
            <button onClick={handleLogout} className="text-zinc-400 hover:text-zinc-900 text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all">SALIR <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
        </div>

        {/* ÁREA DE FILTROS Y BÚSQUEDA */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="md:col-span-2 relative">
                <input 
                    type="text" 
                    placeholder="Buscar por nombre o código..." 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full bg-white border-2 border-zinc-100 rounded-2xl p-4 text-sm focus:border-zinc-900 outline-none transition-all shadow-sm"
                />
                <span className="absolute right-4 top-1/2 transform -translate-y-1/2 opacity-20">🔍</span>
            </div>
            <div>
                <select 
                    value={supplierFilter}
                    onChange={(e) => setSupplierFilter(e.target.value)}
                    className="w-full bg-white border-2 border-zinc-100 rounded-2xl p-4 text-sm font-bold text-zinc-600 outline-none shadow-sm cursor-pointer"
                >
                    <option value="all">TODOS LOS PROVEEDORES</option>
                    {uniqueSuppliers.filter(s => s !== 'all').map(s => (
                        <option key={s} value={s}>{s.toUpperCase()}</option>
                    ))}
                </select>
            </div>
            <div>
                <select 
                    value={sortOrder}
                    onChange={(e) => setSortOrder(e.target.value)}
                    className="w-full bg-white border-2 border-zinc-100 rounded-2xl p-4 text-sm font-bold text-zinc-600 outline-none shadow-sm cursor-pointer"
                >
                    <option value="recent">MÁS RECIENTES</option>
                    <option value="roi-desc">MAYOR MARGEN ROI</option>
                    <option value="roi-asc">MENOR MARGEN ROI</option>
                </select>
            </div>
        </div>

        <header className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4 bg-white p-4 md:p-6 rounded-2xl md:rounded-[2rem] shadow-sm border border-zinc-200/50 relative">
          <div className="flex items-center gap-3 md:gap-5 w-full md:w-auto">
            <div className="w-10 h-10 md:w-14 md:h-14 bg-zinc-900 rounded-xl md:rounded-[1.2rem] flex items-center justify-center text-white text-xl md:text-2xl shadow-xl italic font-black shrink-0">W</div>
            <div className="text-left">
              <h1 className="text-lg md:text-3xl font-black tracking-tighter uppercase italic text-zinc-900 leading-none">{activeModule === 'winners' ? 'Winner OS' : 'Importación'}</h1>
              <p className="text-[8px] md:text-[10px] text-zinc-400 mt-1 uppercase font-black tracking-widest md:tracking-[0.3em]">Sincronizado Cloud</p>
            </div>
          </div>
          <button onClick={() => { setIsCreating(true); setFormError(''); }} className="bg-zinc-900 hover:bg-black text-white w-full md:w-auto px-6 md:px-10 py-3 md:py-4 rounded-xl md:rounded-[1.2rem] shadow-2xl font-black text-[10px] md:text-xs uppercase tracking-widest active:scale-95 transition-all">➕ Crear Registro</button>
        </header>

        <div className="flex gap-2 mb-6 md:mb-10 overflow-x-auto no-scrollbar pb-2">
          {Object.values(activeModule === 'winners' ? WINNER_STATUS : IMPORT_STATUS).map((config) => (
            <button key={config.id} onClick={() => setActiveTab(config.id)} className={`px-5 md:px-8 py-2.5 md:py-3.5 rounded-xl md:rounded-[1.2rem] font-black text-[9px] md:text-[11px] whitespace-nowrap uppercase transition-all tracking-wider md:tracking-widest ${activeTab === config.id ? `${config.activeColor} shadow-xl scale-105` : 'bg-white text-zinc-400 border border-zinc-200/50 shadow-sm'}`}>
              {config.emoji} {config.label} <span className="ml-1 opacity-40">({products.filter(p => p.status === config.id).length})</span>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-6 md:gap-12 pb-20">
          {displayedProducts.map((p, idx) => {
            const isWinner = activeModule === 'winners';
            const mWinner = isWinner ? calculateWinnerMetrics(p) : null;
            const mImport = !isWinner ? calculateImportMetrics(p) : null;
            const stCfg = (isWinner ? WINNER_STATUS[p.status] : IMPORT_STATUS[p.status]) || (isWinner ? WINNER_STATUS.pending : IMPORT_STATUS.pending);

            return (
              <div 
                key={p.id} 
                className={`rounded-[1.5rem] md:rounded-[3rem] shadow-sm border transition-all duration-500 overflow-hidden ${p.isWorking ? 'bg-amber-50 border-amber-500 shadow-amber-100 ring-2 ring-amber-500/20' : 'bg-white border-zinc-200/50'}`}
              >
                
                <div className={`px-4 md:px-10 py-3 md:py-4 flex justify-between items-center border-b ${p.isWorking ? 'bg-amber-100/50 border-amber-200' : 'bg-zinc-50/20'}`}>
                   <div className="flex items-center gap-3 md:gap-6 flex-wrap text-left">
                     <div className="bg-zinc-900 text-white px-2 md:px-4 py-1 rounded-lg text-[9px] md:text-[11px] font-black tracking-widest">{p.regNumber}</div>
                     
                     <div className="flex items-center gap-2 px-3 py-1.5 bg-white rounded-xl border border-zinc-200 shadow-sm cursor-pointer active:scale-95 transition-all" onClick={() => updateDocField(p.id, 'isWorking', !p.isWorking)}>
                        <span className={`text-[9px] font-black uppercase tracking-tighter ${p.isWorking ? 'text-amber-600' : 'text-zinc-400'}`}>EN PROCESO</span>
                        <div className={`w-9 h-5 rounded-full relative transition-colors ${p.isWorking ? 'bg-amber-500' : 'bg-zinc-200'}`}>
                          <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-all ${p.isWorking ? 'left-[1.2rem]' : 'left-0.5'}`} />
                        </div>
                     </div>

                     <span className="font-black text-[9px] md:text-[11px] uppercase tracking-widest text-zinc-500 whitespace-nowrap">{stCfg.emoji} {stCfg.label}</span>
                     <div className="flex items-center bg-white rounded-xl md:rounded-2xl p-0.5 md:p-1 shadow-inner border border-zinc-100">
                        <button onClick={() => moveItem(p.id, -1)} disabled={idx === 0} className="w-7 h-7 md:w-9 md:h-9 flex items-center justify-center hover:bg-zinc-900 hover:text-white rounded-lg md:rounded-xl transition-all disabled:opacity-10"><svg className="w-3 md:w-4 h-3 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3"><path d="M5 15l7-7 7 7"/></svg></button>
                        <span className="text-[8px] md:text-[10px] font-black text-zinc-400 px-1 md:px-3 whitespace-nowrap">#{idx + 1}</span>
                        <button onClick={() => moveItem(p.id, 1)} disabled={idx === displayedProducts.length - 1} className="w-7 h-7 md:w-9 md:h-9 flex items-center justify-center hover:bg-zinc-900 hover:text-white rounded-lg md:rounded-xl transition-all disabled:opacity-10"><svg className="w-3 md:w-4 h-3 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3"><path d="M19 9l-7 7-7-7"/></svg></button>
                     </div>
                   </div>
                   <button onClick={() => deleteItem(p.id)} className="text-zinc-300 hover:text-rose-600 transition-all hover:scale-110 shrink-0"><svg className="w-5 md:w-6 h-5 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
                </div>

                <div className="flex flex-col xl:flex-row">
                   <div className="w-full xl:w-[25%] p-5 md:p-10 border-r border-zinc-100 text-left">
                     <div className="aspect-square bg-white rounded-xl md:rounded-[2.5rem] border border-zinc-200 mb-6 relative overflow-hidden shadow-sm group/img cursor-pointer max-w-[300px] mx-auto w-full text-center">
                       {p.image ? <img src={p.image} className="w-full h-full object-cover" alt="Producto"/> : <span className="text-2xl md:text-4xl opacity-10 font-bold flex items-center justify-center h-full italic">IMG</span>}
                       <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e)=>handleImage(e, p.id)}/>
                     </div>
                     <input value={p.name || ''} onChange={(e)=>updateDocField(p.id, 'name', e.target.value)} className="w-full text-xl md:text-2xl font-black bg-transparent border-b border-transparent hover:border-zinc-200 focus:border-zinc-900 outline-none mb-4 py-1 transition-all text-zinc-900 text-center md:text-left bg-transparent" placeholder="Nombre..."/>
                     
                     <div className="grid grid-cols-2 gap-2 md:gap-3 mb-6 text-left">
                        {isWinner ? (
                          <>
                            <div className="bg-white border border-zinc-100 p-2 md:p-3 rounded-xl md:rounded-2xl shadow-sm cursor-pointer hover:border-blue-300 transition-colors" onClick={()=>copyToClipboard(p.dropiCode)}>
                                <label className="text-[7px] md:text-[8px] font-black text-zinc-400 uppercase tracking-widest block mb-1 leading-none">CÓDIGO DROPI 📋</label>
                                <input value={p.dropiCode || ''} onChange={(e)=>updateDocField(p.id, 'dropiCode', e.target.value)} className="text-[10px] md:text-[11px] font-mono font-bold truncate w-full outline-none bg-transparent text-zinc-800"/>
                            </div>
                            <div className="bg-white border border-zinc-100 p-2 md:p-3 rounded-xl md:rounded-2xl shadow-sm">
                                <label className="text-[7px] md:text-[8px] font-black text-zinc-400 uppercase tracking-widest block mb-1 leading-none text-left">PROVEEDOR</label>
                                <input value={p.supplier || ''} onChange={(e)=>updateDocField(p.id, 'supplier', e.target.value)} className="w-full text-[10px] md:text-[11px] font-bold outline-none bg-transparent text-zinc-800"/>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="bg-white border border-zinc-100 p-2 md:p-3 rounded-xl md:rounded-2xl shadow-sm text-left">
                                <label className="text-[7px] md:text-[8px] font-black text-zinc-400 uppercase tracking-widest block mb-1 leading-none">PROVEEDOR CHINO</label>
                                <input value={p.chineseSupplier || ''} onChange={(e)=>updateDocField(p.id, 'chineseSupplier', e.target.value)} className="w-full text-[10px] md:text-[11px] font-bold outline-none bg-transparent text-zinc-800 truncate"/>
                            </div>
                            <div className="bg-white border border-zinc-100 p-2 md:p-3 rounded-xl md:rounded-2xl shadow-sm text-left">
                                <label className="text-[7px] md:text-[8px] font-black text-zinc-400 uppercase tracking-widest block mb-1 leading-none">TRM HOY</label>
                                <input type="number" value={p.dollarRate || 0} onChange={(e)=>updateDocField(p.id, 'dollarRate', parseFloat(e.target.value)||0)} className="w-full text-[10px] md:text-[11px] font-mono font-bold outline-none bg-transparent text-zinc-800"/>
                            </div>
                          </>
                        )}
                     </div>
                     {isWinner && (
                       <textarea value={p.description || ''} onChange={(e)=>updateDocField(p.id, 'description', e.target.value)} rows={3} className="w-full text-[10px] md:text-xs bg-white p-4 md:p-6 rounded-xl md:rounded-[1.5rem] border border-zinc-100 shadow-inner text-zinc-500 leading-relaxed text-left" placeholder="Estrategia..."/>
                     )}
                   </div>

                   <div className="flex-1 p-5 md:p-10 space-y-6 md:space-y-10 relative text-left">
                      {isWinner ? (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4">
                          {['base', 'cpa', 'freight', 'fulfillment', 'commission', 'returns', 'fixed'].map(k => (
                            <div key={k} className={`p-3 md:p-5 rounded-xl md:rounded-2xl border transition-all hover:bg-white text-left ${p.isWorking ? 'bg-white/70 border-amber-300' : 'bg-zinc-50/50 border-zinc-100'}`}>
                                <label className="text-[8px] md:text-[10px] font-black text-zinc-400 uppercase block mb-1 leading-none">{k}</label>
                                <input type="number" value={p.costs?.[k] || 0} onChange={(e)=>updateNestedField(p.id, 'costs', k, parseFloat(e.target.value)||0)} className="w-full font-mono text-xs md:text-sm font-bold bg-transparent outline-none text-zinc-700"/>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4">
                            {[{k:'prodCostUSD',l:'USD'}, {k:'cbmCostCOP',l:'CBM'}, {k:'unitsQty',l:'Uds'}, {k:'ctnQty',l:'CTN'}, {k:'yiwuFreightUSD',l:'Yiwu'}].map(f=>(
                                <div key={f.k} className={`p-3 md:p-5 rounded-xl md:rounded-2xl border text-left transition-all ${p.isWorking ? 'bg-white/70 border-amber-300' : 'bg-zinc-50/50 border-zinc-100'}`}>
                                    <label className="text-[8px] md:text-[10px] font-black text-zinc-400 uppercase block mb-1 leading-none">{f.l}</label>
                                    <input type="number" value={p[f.k] || 0} onChange={(e)=>updateDocField(p.id, f.k, parseFloat(e.target.value)||0)} className="w-full font-mono text-xs md:text-sm font-bold bg-transparent outline-none text-zinc-800 leading-none"/>
                                </div>
                            ))}
                            <div className={`col-span-2 p-3 md:p-5 rounded-xl md:rounded-2xl border text-left transition-all ${p.isWorking ? 'bg-white/70 border-amber-300' : 'bg-zinc-50/50 border-zinc-100'}`}>
                                <label className="text-[8px] md:text-[10px] font-black text-zinc-400 uppercase block mb-2 px-1 leading-none">Medidas (cm)</label>
                                <div className="grid grid-cols-3 gap-2 px-1">
                                    <input type="number" value={p.measures?.width || 0} onChange={(e)=>updateNestedField(p.id, 'measures', 'width', parseFloat(e.target.value)||0)} className="bg-white border p-1 rounded-lg text-xs font-mono w-full text-zinc-800 outline-none"/>
                                    <input type="number" value={p.measures?.height || 0} onChange={(e)=>updateNestedField(p.id, 'measures', 'height', parseFloat(e.target.value)||0)} className="bg-white border p-1 rounded-lg text-xs font-mono w-full text-zinc-800 outline-none"/>
                                    <input type="number" value={p.measures?.length || 0} onChange={(e)=>updateNestedField(p.id, 'measures', 'length', parseFloat(e.target.value)||0)} className="bg-white border p-1 rounded-lg text-xs font-mono w-full text-zinc-800 outline-none"/>
                                </div>
                            </div>
                        </div>
                      )}

                      <div className="bg-zinc-900 rounded-2xl md:rounded-[3rem] p-5 md:p-10 text-white shadow-2xl relative overflow-hidden">
                         <div className="absolute top-0 right-0 w-48 md:w-80 h-48 md:h-80 bg-indigo-500/10 rounded-full blur-[60px] md:blur-[120px] -mr-24 md:-mr-40 -mt-24 md:-mt-40"></div>
                         
                         {isWinner ? (
                            <div className="relative z-10 space-y-6 md:space-y-8">
                                <div className="flex flex-col md:flex-row justify-between items-start md:items-end border-b border-zinc-800 pb-5 md:pb-8 gap-4 md:gap-8">
                                    <div className="flex-1 w-full text-left">
                                        <label className="text-[9px] md:text-[11px] font-bold text-zinc-500 uppercase tracking-widest mb-2 md:mb-4 block leading-none">PVP Sugerido</label>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xl md:text-3xl font-bold opacity-20">$</span>
                                            <input type="number" value={p.targetPrice || 0} onChange={(e)=>updateDocField(p.id, 'targetPrice', parseFloat(e.target.value)||0)} className="bg-transparent font-black text-3xl md:text-6xl outline-none w-full tracking-tighter focus:text-indigo-400 transition-colors text-white"/>
                                        </div>
                                    </div>
                                    <div className="text-left md:text-right w-full md:w-auto shrink-0">
                                        <p className="text-[9px] md:text-[11px] font-bold text-rose-400 uppercase tracking-widest mb-1 italic leading-none">Costos</p>
                                        <p className="text-xl md:text-3xl font-mono font-bold text-rose-50">{formatCurrency(mWinner.totalCost)}</p>
                                    </div>
                                </div>
                                <div className="flex flex-col md:flex-row justify-between items-center gap-4 md:gap-0">
                                    <div className="bg-white/5 p-4 md:p-6 rounded-xl md:rounded-[1.8rem] border border-white/5 w-full md:flex-1 shadow-inner text-center md:text-left">
                                        <p className="text-[8px] md:text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1 md:mb-2 text-left px-1 leading-none">Utilidad Estimada</p>
                                        <p className={`text-2xl md:text-5xl font-mono font-bold px-1 text-left ${mWinner.profit > 0 ? 'text-emerald-400' : 'text-rose-500'}`}>{formatCurrency(mWinner.profit)}</p>
                                    </div>
                                    <div className="text-center md:text-right md:ml-10">
                                        <p className="text-[8px] md:text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1 md:mb-2 italic leading-none text-right">Margen ROI</p>
                                        <p className="text-4xl md:text-7xl font-black italic tracking-tighter leading-none">{mWinner.margin.toFixed(1)}%</p>
                                    </div>
                                </div>
                            </div>
                         ) : (
                            <div className="relative z-10 space-y-6 md:space-y-8">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-10 border-b border-zinc-800 pb-5 md:pb-8 text-left">
                                    <div className="text-left">
                                        <p className="text-[9px] md:text-[11px] font-black text-zinc-500 uppercase tracking-widest mb-1 md:mb-3 leading-none italic px-1">China (x1.03 factor)</p>
                                        <p className="text-xl md:text-3xl font-bold font-mono tracking-tight px-1">{formatCurrency(mImport.costChinaCOP)}</p>
                                    </div>
                                    <div className="text-left md:text-right">
                                        <p className="text-[9px] md:text-[11px] font-black text-zinc-500 uppercase tracking-widest mb-1 md:mb-3 leading-none italic px-1">Logística ({mImport.totalCbm.toFixed(3)} CBM)</p>
                                        <p className="text-xl md:text-3xl font-bold font-mono tracking-tight px-1">{formatCurrency(mImport.nationalizationCOP)}</p>
                                    </div>
                                </div>
                                <div className="bg-emerald-500/10 p-5 md:p-10 rounded-xl md:rounded-[3rem] border border-emerald-500/20 flex flex-col md:flex-row justify-between items-center gap-6 md:gap-10 transition-all hover:bg-emerald-500/20">
                                    <div className="flex items-center gap-4 md:gap-8 flex-col md:flex-row text-center md:text-left w-full md:w-auto">
                                        <div className="text-4xl md:text-6xl shrink-0">🇨🇴</div>
                                        <div className="text-left">
                                            <p className="text-[10px] md:text-[12px] font-black text-emerald-400 uppercase tracking-[0.1em] mb-1 md:mb-2 leading-none">Costo Producto Colombia</p>
                                            <p className="text-4xl md:text-7xl font-black text-white leading-none tracking-tighter">{formatCurrency(mImport.unitCostColombia)}</p>
                                        </div>
                                    </div>
                                    <div className="text-left md:text-right w-full md:w-auto px-1">
                                        <p className="text-[8px] md:text-[10px] font-bold text-zinc-500 uppercase mb-1 leading-none leading-none">Inversión Total</p>
                                        <p className="text-lg md:text-2xl font-mono opacity-50 italic">{formatCurrency(mImport.totalLandCostCOP)}</p>
                                    </div>
                                </div>
                            </div>
                         )}
                      </div>

                      <div className="flex flex-wrap gap-2 md:gap-3 justify-center md:justify-start pb-2">
                        {Object.values(isWinner ? WINNER_STATUS : IMPORT_STATUS).map(s=>(
                          <button key={s.id} onClick={()=>updateDocField(p.id, 'status', s.id)} className={`px-4 md:px-8 py-2 md:py-3.5 rounded-xl text-[9px] md:text-[11px] font-black border-2 uppercase transition-all whitespace-nowrap active:scale-95 ${p.status===s.id ? `bg-white ${s.activeColor} border-zinc-900 shadow-xl` : 'bg-white border-zinc-100 text-zinc-400'}`}>
                            {s.emoji} {s.label}
                          </button>
                        ))}
                      </div>

                      {!isWinner && p.status === 'approved' && (
                        <div className="pt-6 md:pt-8 border-t border-zinc-100">
                           <button onClick={()=>setExpandedItems({...expandedItems, [p.id]: !expandedItems[p.id]})} className={`w-full p-4 md:p-8 rounded-xl md:rounded-[2.5rem] border-2 transition-all flex justify-between items-center ${expandedItems[p.id] ? 'bg-zinc-900 border-zinc-900 text-white shadow-xl' : 'bg-zinc-50 border-zinc-200 text-zinc-900'}`}>
                                <div className="flex items-center gap-3 md:gap-5 text-left leading-tight"><span className="text-xl md:text-3xl">📋</span><div className="text-left"><p className="text-[10px] md:text-sm font-black uppercase tracking-widest leading-none">Concepto Compra / Logística</p></div></div>
                                <svg className={`w-4 md:w-6 h-4 md:h-6 transition-transform ${expandedItems[p.id] ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7" strokeWidth="4"/></svg>
                           </button>
                           {expandedItems[p.id] && (
                                <div className="mt-4 md:mt-8 p-5 md:p-10 bg-zinc-50 rounded-2xl md:rounded-[3rem] border border-zinc-200 grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-10 animate-in fade-in">
                                    <div className="space-y-4 text-left">
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="flex flex-col gap-1">
                                                <label className="text-[9px] font-bold text-zinc-400 uppercase px-1 leading-none">Fecha Compra</label>
                                                <input type="date" value={p.purchaseDate || ''} onChange={(e)=>updateDocField(p.id, 'purchaseDate', e.target.value)} className="w-full p-3 rounded-xl border text-[10px] md:text-sm font-mono focus:border-zinc-900 outline-none text-zinc-800 leading-none"/>
                                            </div>
                                            <div className="flex flex-col gap-1 text-left">
                                                <label className="text-[9px] font-bold text-zinc-400 uppercase px-1 leading-none">Est. Llegada</label>
                                                <input type="date" value={p.estimatedArrival || ''} onChange={(e)=>updateDocField(p.id, 'estimatedArrival', e.target.value)} className="w-full p-3 rounded-xl border text-[10px] md:text-sm font-mono focus:border-zinc-900 outline-none text-zinc-800 leading-none"/>
                                            </div>
                                        </div>
                                        <div className="flex flex-col gap-1 text-left">
                                            <label className="text-[9px] font-bold text-zinc-400 uppercase px-1 leading-none">Valor Anticipo</label>
                                            <input type="number" value={p.advancePayment || 0} onChange={(e)=>updateDocField(p.id, 'advancePayment', parseFloat(e.target.value)||0)} className="w-full p-3 rounded-xl border text-[10px] md:text-sm font-mono font-bold outline-none text-zinc-800 leading-none"/>
                                        </div>
                                        <div className="flex flex-col gap-1 text-left">
                                            <label className="text-[9px] font-bold text-zinc-400 uppercase px-1 leading-none">Comprador</label>
                                            <input value={p.buyer || ''} onChange={(e)=>updateDocField(p.id, 'buyer', e.target.value)} className="w-full p-3 rounded-xl border text-[10px] md:text-sm font-bold outline-none text-zinc-800 leading-none" placeholder="Nombre..."/>
                                        </div>
                                    </div>
                                    <div className="bg-white p-4 md:p-8 rounded-2xl border shadow-sm text-left">
                                        <h4 className="text-[10px] font-black text-zinc-400 uppercase mb-4 border-b pb-2 px-1 text-left leading-none">Distribución por Color</h4>
                                        <div className="space-y-2 overflow-y-auto max-h-[250px] pr-2 no-scrollbar">
                                            {(p.colors || []).map(c => (
                                                <div key={c.id} className="flex gap-2 md:gap-4 items-center bg-zinc-50/50 p-2 rounded-xl border">
                                                    <input value={c.color || ''} onChange={(e)=>{
                                                        const n = p.colors.map(x=>x.id===c.id?{...x, color: e.target.value}:x);
                                                        updateDocField(p.id, 'colors', n);
                                                    }} className="flex-1 text-[10px] md:text-xs font-black bg-transparent outline-none uppercase text-zinc-800 leading-none" placeholder="Color..."/>
                                                    <input type="number" value={c.qty || 0} onChange={(e)=>{
                                                        const n = p.colors.map(x=>x.id===c.id?{...x, qty: parseInt(e.target.value)||0}:x);
                                                        updateDocField(p.id, 'colors', n);
                                                    }} className="w-16 md:w-24 bg-zinc-900 text-white p-1.5 md:p-2 rounded-lg text-center text-[10px] md:text-xs font-mono shadow-sm leading-none"/>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                           )}
                        </div>
                      )}
                   </div>

                   {/* BUNDLES */}
                   {isWinner && (
                    <div className="w-full xl:w-[32%] bg-[#fcfdfe] p-5 md:p-10 flex flex-col border-l border-zinc-100 shadow-inner">
                        <button onClick={()=>setExpandedItems({...expandedItems, [`u_${p.id}`]: !expandedItems[`u_${p.id}`]})} className={`w-full flex justify-between items-center p-4 md:p-6 rounded-xl md:rounded-[1.5rem] border-2 transition-all duration-500 ${expandedItems[`u_${p.id}`] ? 'bg-zinc-900 text-white border-zinc-900 shadow-xl' : 'bg-white border-zinc-200 text-zinc-900 shadow-sm'}`}>
                           <div className="flex items-center gap-3 md:gap-4 text-left leading-none"><span className="text-xl md:text-2xl">🍱</span><div className="text-left"><p className="text-[10px] md:text-[11px] font-black uppercase tracking-widest leading-none">Bundles</p><p className="text-[8px] font-bold mt-1 opacity-50 uppercase leading-none">{mWinner.activeUpsells} Activos</p></div></div>
                           <svg className={`w-4 md:w-6 h-4 md:h-6 transition-transform ${expandedItems[`u_${p.id}`] ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7" strokeWidth="4"/></svg>
                        </button>
                        <div className={`transition-all duration-700 ease-in-out overflow-hidden ${expandedItems[`u_${p.id}`] ? 'max-h-[1200px] opacity-100 mt-6 md:mt-8' : 'max-h-0 opacity-0 mt-0'}`}>
                           <div className="space-y-4 no-scrollbar text-left px-1">
                               {(p.upsells || getInitialWinner().upsells).map(u=>(
                                   <div key={u.id} className="bg-white p-4 rounded-2xl border border-zinc-200 flex gap-4 relative group border-l-8 border-l-indigo-600 transition-all text-left">
                                       <div className="w-12 h-12 md:w-16 bg-zinc-50 rounded-xl md:rounded-2xl relative shrink-0 flex items-center justify-center border overflow-hidden shadow-inner">
                                           {u.image ? <img src={u.image} className="w-full h-full object-cover" alt="Upsell"/> : <span className="text-lg opacity-20 font-black">+</span>}
                                           <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e)=>handleImage(e, p.id, u.id)}/>
                                       </div>
                                       <div className="flex-1 min-w-0 pr-6 text-left leading-none">
                                           <input value={u.name || ''} onChange={(e)=>updateUpsell(p, u.id, 'name', e.target.value)} className="w-full text-[10px] md:text-xs font-black bg-transparent border-b border-zinc-100 focus:border-indigo-600 mb-2 outline-none truncate text-zinc-800 leading-none" placeholder="Nombre..."/>
                                           <div className="flex gap-2">
                                               <input type="number" value={u.cost || ''} onChange={(e)=>updateUpsell(p, u.id, 'cost', parseFloat(e.target.value)||0)} className="w-1/2 bg-zinc-50 text-[9px] p-1.5 rounded-lg font-mono outline-none border border-transparent shadow-inner text-zinc-700 leading-none" placeholder="Costo"/>
                                               <input type="number" value={u.price || ''} onChange={(e)=>updateUpsell(p, u.id, 'price', parseFloat(e.target.value)||0)} className="w-1/2 bg-indigo-50/50 text-[9px] p-1.5 rounded-lg font-black text-indigo-700 outline-none border border-transparent shadow-inner leading-none" placeholder="Venta"/>
                                           </div>
                                       </div>
                                       <button onClick={() => resetUpsell(p, u.id)} className="text-zinc-300 opacity-100 md:opacity-0 group-hover:opacity-100 transition-all p-1 hover:text-rose-500 absolute right-1 md:right-3 top-1 md:top-3"><svg className="w-4 md:w-5 h-4 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" strokeWidth="2.5"/></svg></button>
                                   </div>
                               ))}
                           </div>
                        </div>
                    </div>
                   )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* MODAL CREACIÓN */}
      {isCreating && (
        <div className="fixed inset-0 bg-zinc-950/90 backdrop-blur-xl flex items-center justify-center z-[300] p-3 animate-in fade-in duration-300">
            <div className="bg-white rounded-2xl md:rounded-[3.5rem] shadow-2xl max-w-5xl w-full max-h-[95vh] overflow-y-auto no-scrollbar animate-in zoom-in-95 duration-300">
                <header className="sticky top-0 bg-white/90 backdrop-blur-md p-6 md:p-8 border-b flex justify-between items-center z-10">
                    <h2 className="text-lg md:text-2xl font-black text-zinc-900 uppercase italic">Registro Cloud</h2>
                    <button onClick={()=>{setIsCreating(false); setFormError('');}} className="bg-zinc-100 p-2 md:p-3 rounded-full hover:bg-zinc-200 shadow-sm text-zinc-600">✕</button>
                </header>
                <div className="p-5 md:p-12">
                    {renderCreationForm()}
                    
                    {/* CAJA DE DIAGNÓSTICO: Muestra el error claramente si algo falla */}
                    {formError && (
                      <div className="w-full bg-rose-100 border-2 border-rose-500 text-rose-700 font-bold p-4 rounded-2xl mt-8 text-center text-sm animate-in fade-in">
                        {formError}
                      </div>
                    )}

                    <button 
                      onClick={handleSave} 
                      disabled={isSaving}
                      className="w-full mt-6 bg-zinc-900 hover:bg-black text-white font-black py-5 md:py-7 rounded-xl md:rounded-[2rem] text-sm md:text-xl shadow-2xl transition-all uppercase tracking-widest md:tracking-[0.4em] active:scale-[0.98] disabled:opacity-50"
                    >
                        {isSaving ? 'Guardando en la Nube...' : 'Confirmar Registro'}
                    </button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
}
