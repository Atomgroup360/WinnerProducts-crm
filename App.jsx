import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, collection, addDoc, setDoc, updateDoc, deleteDoc, doc, 
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

const getInitialProjection = () => ({
  name: '', 
  price: '', productCost: '', freight: '', fulfillment: '', commission: '',
  adSpend: '', cpm: '', ctr: '', loadSpeed: '', conversionRate: '',
  effectiveness: '', returnRate: '', fixedExpenses: '', activeCampaigns: 1
});

const getInitialSalesConfig = () => ({
  vendedora: '', productName: '', targetProfit: '', productCost: '', freight: '', 
  commission: '', returnRate: '', effectiveness: '', fulfillment: '', fixedCosts: '', 
  fixedAdSpend: false, dailyAdSpend: ''
});

const getInitialSaleRecord = () => ({
  date: new Date().toISOString().split('T')[0], configId: '', 
  orders: '', units: '', revenue: '', adSpend: ''
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

// --- COMPONENTES INPUT/OUTPUT REUTILIZABLES ---
const InputP = ({ label, value, onChange, type="number", prefix="", suffix="", disabled=false }) => {
  let displayVal = value;
  
  if (type === 'currency') {
     displayVal = value ? new Intl.NumberFormat('es-CO').format(value) : '';
  }

  const handleInput = (e) => {
     if (type === 'currency') {
        const numericString = e.target.value.replace(/\D/g, '');
        onChange(numericString !== '' ? parseFloat(numericString) : '');
     } else {
        onChange(e.target.value !== '' ? parseFloat(e.target.value) : '');
     }
  };

  return (
    <div className={`bg-emerald-50/70 p-3 md:p-4 rounded-xl md:rounded-2xl border-2 border-emerald-100 transition-colors shadow-sm ${!disabled ? 'focus-within:border-emerald-400' : 'opacity-70 grayscale'}`}>
      <label className="text-[9px] md:text-[11px] font-black text-emerald-700 uppercase block mb-1 md:mb-2">{label} {disabled ? '🔒' : '✎'}</label>
      <div className="flex items-center gap-1">
        {prefix && <span className="text-emerald-600 font-bold">{prefix}</span>}
        <input 
          type={type === 'currency' ? 'text' : type} 
          value={displayVal} 
          onChange={handleInput}
          disabled={disabled}
          className="w-full bg-transparent text-sm md:text-base font-bold text-emerald-950 outline-none font-mono placeholder:text-emerald-300 disabled:text-emerald-800"
          placeholder="0"
        />
        {suffix && <span className="text-emerald-600 font-bold">{suffix}</span>}
      </div>
    </div>
  );
};

const OutputP = ({ label, value, type="currency", decimals=2, highlight=false, customBg, customText }) => {
  let displayValue = 0;
  const numValue = parseFloat(value) || 0;
  if (type === "currency") displayValue = formatCurrency(numValue);
  else if (type === "number") displayValue = numValue.toFixed(decimals);
  else if (type === "percent") displayValue = `${numValue.toFixed(decimals)}%`;

  let baseBg = customBg || (highlight ? 'bg-zinc-900 border-zinc-900 shadow-xl' : 'bg-zinc-50 border-zinc-200 shadow-inner');
  let baseText = customText || (highlight ? 'text-white' : 'text-zinc-800');
  let labelText = customText ? 'text-white/80' : (highlight ? 'text-zinc-400' : 'text-zinc-500');

  return (
    <div className={`p-3 md:p-4 rounded-xl md:rounded-2xl border text-left ${baseBg}`}>
      <label className={`text-[8px] md:text-[10px] font-black uppercase block mb-1 md:mb-2 ${labelText}`}>{label}</label>
      <div className={`font-mono text-sm md:text-lg font-black truncate ${baseText}`}>
        {displayValue}
      </div>
    </div>
  );
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
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full bg-zinc-50 border-2 border-zinc-100 rounded-2xl p-4 text-base focus:outline-none focus:border-zinc-900 transition-all text-zinc-700 outline-none" placeholder="admin@winneros.com"/>
          </div>
          <div>
            <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block mb-2 px-1 leading-none">Contraseña</label>
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full bg-zinc-50 border-2 border-zinc-100 rounded-2xl p-4 text-base focus:outline-none focus:border-zinc-900 transition-all text-zinc-700 outline-none" placeholder="••••••••"/>
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
  const [activeModule, setActiveModule] = useState('winners'); // 'winners', 'imports', 'projection', 'sales'
  const [user, setUser] = useState(null);
  
  // Datos Generales
  const [products, setProducts] = useState([]);
  
  // Datos Módulo Ventas/Rendimiento
  const [salesConfigs, setSalesConfigs] = useState([]); 
  const [salesMonths, setSalesMonths] = useState([]);
  
  // UI States
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('pending');
  const [isCreating, setIsCreating] = useState(false);
  const [expandedItems, setExpandedItems] = useState({});
  const [notification, setNotification] = useState('');
  const [formError, setFormError] = useState('');

  // Formularios
  const [newProduct, setNewProduct] = useState(getInitialWinner());
  const [proj, setProj] = useState(getInitialProjection()); 
  
  // Sub-estados Módulo Ventas
  const [salesTab, setSalesTab] = useState('dashboard'); // 'dashboard', 'records', 'config'
  const [isCreatingSalesConfig, setIsCreatingSalesConfig] = useState(false);
  const [newSalesConfig, setNewSalesConfig] = useState(getInitialSalesConfig());
  const [newSaleRecord, setNewSaleRecord] = useState(getInitialSaleRecord());
  const [salesFilter, setSalesFilter] = useState({
     startDate: new Date(new Date().setDate(1)).toISOString().split('T')[0], // Inicio de mes por defecto
     endDate: new Date().toISOString().split('T')[0], // Hoy
     configId: 'all'
  });

  // Filtros Main
  const [searchTerm, setSearchTerm] = useState('');
  const [sortOrder, setSortOrder] = useState('manual');
  const [supplierFilter, setSupplierFilter] = useState('all');

  // 1. Escuchar Auth
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // 2. Escuchar Firestore (Productos)
  useEffect(() => {
    if (!user || (activeModule !== 'winners' && activeModule !== 'imports')) return; 
    const colName = activeModule === 'winners' ? 'products' : 'import_products';
    const q = collection(db, 'artifacts', appId, 'public', 'data', colName);
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const loaded = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setProducts(loaded);
    }, (error) => {
      console.error("Firestore Error:", error);
      setNotification(`Error de acceso: No tienes permisos.`);
      setTimeout(() => setNotification(''), 4000);
    });
    return () => unsubscribe();
  }, [user, activeModule]);

  // 3. Escuchar Firestore (Módulo Rendimiento / Ventas)
  useEffect(() => {
    if (!user || activeModule !== 'sales') return; 
    
    // Escuchar Configuraciones (Fase 1)
    const qConfigs = collection(db, 'artifacts', appId, 'public', 'data', 'sales_configs');
    const unsubConfigs = onSnapshot(qConfigs, (snapshot) => {
      setSalesConfigs(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    // Escuchar Carpetas Mensuales de Registros (Fase 2 y 3 - Estructura Ahorro de Datos)
    const qMonths = collection(db, 'artifacts', appId, 'public', 'data', 'sales_months');
    const unsubMonths = onSnapshot(qMonths, (snapshot) => {
      setSalesMonths(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    return () => { unsubConfigs(); unsubMonths(); };
  }, [user, activeModule]);

  // -- Helpers Main Modules --
  const uniqueSuppliers = useMemo(() => {
    if(activeModule === 'projection' || activeModule === 'sales') return [];
    const field = activeModule === 'winners' ? 'supplier' : 'chineseSupplier';
    const list = products.map(p => p[field]).filter(Boolean);
    return ['all', ...new Set(list)];
  }, [products, activeModule]);

  const displayedProducts = useMemo(() => {
    if(activeModule === 'projection' || activeModule === 'sales') return [];
    let result = products.filter(p => {
      const matchesTab = p.status === activeTab;
      const matchesSearch = p.name?.toLowerCase().includes(searchTerm.toLowerCase()) || 
                           p.dropiCode?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           p.chineseSupplier?.toLowerCase().includes(searchTerm.toLowerCase());
      
      const supplierField = activeModule === 'winners' ? 'supplier' : 'chineseSupplier';
      const matchesSupplier = supplierFilter === 'all' || p[supplierField] === supplierFilter;

      return matchesTab && matchesSearch && matchesSupplier;
    });

    return [...result].sort((a, b) => {
      if (a.isWorking && !b.isWorking) return -1;
      if (!a.isWorking && b.isWorking) return 1;

      if (sortOrder === 'manual' || sortOrder === 'recent') return (a.order || 0) - (b.order || 0);
      
      const valA = activeModule === 'winners' ? calculateWinnerMetrics(a).margin : calculateImportMetrics(a).unitCostColombia;
      const valB = activeModule === 'winners' ? calculateWinnerMetrics(b).margin : calculateImportMetrics(b).unitCostColombia;

      if (sortOrder === 'roi-desc') return valB - valA;
      if (sortOrder === 'roi-asc') return valA - valB;
      return 0;
    });
  }, [products, activeTab, searchTerm, supplierFilter, sortOrder, activeModule]);

  const handleLogout = () => signOut(auth);

  const handleModuleChange = (mod) => {
    if (mod === 'winners' || mod === 'imports') setProducts([]); 
    setActiveModule(mod);
    setActiveTab('pending');
    setSearchTerm('');
    setSupplierFilter('all');
    setSortOrder('manual');
    if (mod === 'winners') setNewProduct(getInitialWinner());
    if (mod === 'imports') setNewProduct(getInitialImport());
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

  // --- Guardado Main Modules ---
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
      if (!auth.currentUser) throw new Error("Debes iniciar sesión");
      const cleanPayload = JSON.parse(JSON.stringify({...newProduct, regNumber, order: Date.now(), createdBy: auth.currentUser.uid}));
      cleanPayload.createdAt = serverTimestamp();
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', colName), cleanPayload);
      
      setIsCreating(false);
      setNewProduct(activeModule === 'winners' ? getInitialWinner() : getInitialImport());
      setNotification('¡Registro guardado en la Nube! ✨');
      setTimeout(() => setNotification(''), 3000);
    } catch (e) { 
      setFormError(`⚠️ FALLO DE SERVIDOR: ${e.message}`);
    } finally { setIsSaving(false); }
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
    try { await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'products', p.id), { upsells: currentUpsells.map(u => u.id === uid ? { ...u, [f]: v } : u) }); } catch (e) { console.error(e); }
  };

  const resetUpsell = async (p, uid) => {
    const currentUpsells = p.upsells || getInitialWinner().upsells;
    try { await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'products', p.id), { upsells: currentUpsells.map(u => u.id === uid ? { id: uid, name: '', cost: 0, price: 0, image: null } : u) }); } catch (e) { console.error(e); }
  };

  const deleteItem = async (id) => {
    if (window.confirm('¿Estás seguro de borrar este registro de la base de datos?')) {
      const colName = activeModule === 'winners' ? 'products' : 'import_products';
      try { await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', colName, id)); } catch (e) { console.error(e); }
    }
  };

  const moveItem = async (id, dir) => {
    const colName = activeModule === 'winners' ? 'products' : 'import_products';
    const list = displayedProducts;
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
      if (file.size > 500 * 1024) try { result = await compressImage(reader.result); } catch(err) { console.error("Error comprimiendo:", err); }
      if (!targetId) {
        if (upsellId) setNewProduct({...newProduct, upsells: (newProduct.upsells || []).map(u => u.id === upsellId ? {...u, image: result} : u)});
        else setNewProduct({...newProduct, image: result});
      } else {
        const colName = activeModule === 'winners' ? 'products' : 'import_products';
        const item = products.find(x => x.id === targetId);
        if (!item) return;
        if (upsellId) updateDoc(doc(db, 'artifacts', appId, 'public', 'data', colName, targetId), { upsells: (item.upsells || getInitialWinner().upsells).map(u => u.id === upsellId ? {...u, image: result} : u) });
        else updateDoc(doc(db, 'artifacts', appId, 'public', 'data', colName, targetId), { image: result });
      }
    };
    reader.readAsDataURL(file);
  };


  // --- MÓDULO: RENDIMIENTO DE VENTAS (FASES 1, 2 Y 3) ---

  // Fase 1: Guardar Configuración Vendedora/Producto
  const handleSaveSalesConfig = async () => {
    setFormError('');
    if (!newSalesConfig.vendedora || !newSalesConfig.productName) {
      setFormError('⚠️ ERROR: Ingresa nombre de Vendedora y Producto.');
      return; 
    }
    setIsSaving(true);
    try {
      if (newSalesConfig.id) {
         // Edición
         const cleanPayload = JSON.parse(JSON.stringify(newSalesConfig));
         await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'sales_configs', newSalesConfig.id), cleanPayload);
      } else {
         // Creación
         const cleanPayload = JSON.parse(JSON.stringify({...newSalesConfig, createdAt: Date.now()}));
         await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'sales_configs'), cleanPayload);
      }
      setIsCreatingSalesConfig(false);
      setNewSalesConfig(getInitialSalesConfig());
      setNotification('Configuración guardada en la nube.');
      setTimeout(() => setNotification(''), 3000);
    } catch (e) { 
      setFormError(`⚠️ Error: ${e.message}`);
    } finally { setIsSaving(false); }
  };

  const deleteSalesConfig = async (id) => {
    if (window.confirm('¿Borrar configuración? Se perderá el enlace con los registros antiguos.')) {
      try { await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'sales_configs', id)); } catch (e) { console.error(e); }
    }
  };

  // Fase 2: Consolidación Mensual de Registros (Ahorro Extremo en Firestore)
  // Convertimos las carpetas mensuales en un array plano en memoria para que sea fácil trabajar
  const allSalesRecords = useMemo(() => {
     return salesMonths.flatMap(monthDoc => monthDoc.records || []);
  }, [salesMonths]);

  // Al cambiar la configuración en el Form de Cierre Diario, autocompletamos la Inversión FB si es fija
  const handleRecordConfigSelect = (configId) => {
      const conf = salesConfigs.find(c => c.id === configId);
      if (conf && conf.fixedAdSpend) {
          setNewSaleRecord({...newSaleRecord, configId, adSpend: parseFloat(conf.dailyAdSpend) || 0});
      } else {
          setNewSaleRecord({...newSaleRecord, configId, adSpend: ''});
      }
  };

  const handleSaveSaleRecord = async () => {
    setFormError('');
    if (!newSaleRecord.configId) {
      setFormError('⚠️ Selecciona una Vendedora/Producto primero.');
      return;
    }
    setIsSaving(true);
    try {
      const monthId = newSaleRecord.date.substring(0, 7); // Genera 'YYYY-MM' de la fecha 'YYYY-MM-DD'
      const monthRef = doc(db, 'artifacts', appId, 'public', 'data', 'sales_months', monthId);
      const recordToSave = { ...newSaleRecord, id: Date.now().toString() };
      
      const existingMonth = salesMonths.find(m => m.id === monthId);
      
      if (existingMonth) {
          // Agregar al array mensual existente
          await updateDoc(monthRef, { records: [...existingMonth.records, recordToSave] });
      } else {
          // Crear la carpeta del mes por primera vez
          await setDoc(monthRef, { records: [recordToSave] });
      }
      
      setNewSaleRecord(getInitialSaleRecord());
      setNotification('Cierre diario consolidado.');
      setTimeout(() => setNotification(''), 3000);
    } catch (e) { 
      setFormError(`⚠️ Error: ${e.message}`);
    } finally { setIsSaving(false); }
  };

  const deleteSaleRecord = async (date, recordId) => {
    if (window.confirm('¿Eliminar este registro diario?')) {
        const monthId = date.substring(0, 7);
        const existingMonth = salesMonths.find(m => m.id === monthId);
        if(existingMonth) {
            const updatedRecords = existingMonth.records.filter(r => r.id !== recordId);
            try { await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'sales_months', monthId), { records: updatedRecords }); } 
            catch(e) { console.error(e); }
        }
    }
  };

  // Fase 3: Dashboard de Rendimiento (Lógica Dinámica en Memoria)
  const dashboardData = useMemo(() => {
      // 1. Filtrar registros por Fecha y Vendedora
      const filtered = allSalesRecords.filter(r => {
          const rDate = new Date(r.date);
          const start = new Date(salesFilter.startDate);
          const end = new Date(salesFilter.endDate);
          end.setHours(23, 59, 59, 999); // Incluir todo el último día
          const dateMatch = rDate >= start && rDate <= end;
          
          const configMatch = salesFilter.configId === 'all' || r.configId === salesFilter.configId;
          return dateMatch && configMatch;
      });

      // 2. Sumatoria y Matemáticas (Usando Facturación y Unidades como pediste)
      let totalRevenue = 0, totalAdSpend = 0, totalOrders = 0, totalUnits = 0;
      let totalProductCost = 0, totalLogistics = 0, totalCommissions = 0, totalReturnsCost = 0, totalFixed = 0;
      let effectiveDeliveriesAccumulator = 0;

      filtered.forEach(record => {
          const conf = salesConfigs.find(c => c.id === record.configId);
          if (!conf) return;

          const rRev = parseFloat(record.revenue) || 0;
          const rAd = parseFloat(record.adSpend) || 0;
          const rOrd = parseFloat(record.orders) || 0;
          const rUni = parseFloat(record.units) || 0;

          // Acumulados Base
          totalRevenue += rRev;
          totalAdSpend += rAd;
          totalOrders += rOrd;
          totalUnits += rUni;

          // Costos Directos
          totalProductCost += (rUni * (parseFloat(conf.productCost) || 0));
          totalLogistics += (rOrd * ((parseFloat(conf.freight) || 0) + (parseFloat(conf.fulfillment) || 0)));
          totalCommissions += (rOrd * (parseFloat(conf.commission) || 0));
          totalFixed += (rOrd * (parseFloat(conf.fixedCosts) || 0)); // Costo fijo por pedido

          // Devolución: Pérdida logística = Pedidos * % Devolución * (Flete * 2 - ida y vuelta)
          const pDev = (parseFloat(conf.returnRate) || 0) / 100;
          totalReturnsCost += (rOrd * pDev * ((parseFloat(conf.freight) || 0) * 2));

          // Entregas Efectivas: Pedidos * % Efectividad (Para CPA Real)
          const pEff = (parseFloat(conf.effectiveness) || 0) / 100;
          effectiveDeliveriesAccumulator += (rOrd * pEff);
      });

      const totalCosts = totalProductCost + totalLogistics + totalCommissions + totalReturnsCost + totalFixed;
      const netProfit = totalRevenue - totalCosts - totalAdSpend;
      const roas = totalAdSpend > 0 ? totalRevenue / totalAdSpend : 0;
      const cpaReal = effectiveDeliveriesAccumulator > 0 ? totalAdSpend / effectiveDeliveriesAccumulator : 0;
      
      // Meta y Promedios
      const activeDays = new Set(filtered.map(r => r.date)).size || 1;
      const avgDailyRevenue = totalRevenue / activeDays;
      const projectedMonthlyRevenue = avgDailyRevenue * 30;
      const margin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

      return {
          recordsCount: filtered.length,
          totalRevenue, totalAdSpend, totalOrders, totalUnits,
          totalProductCost, totalLogistics, totalCommissions, totalReturnsCost, totalFixed, totalCosts,
          netProfit, roas, cpaReal, margin, projectedMonthlyRevenue, effectiveDeliveriesAccumulator
      };
  }, [allSalesRecords, salesFilter, salesConfigs]);


  // RENDERIZADOR: MÓDULO RENDIMIENTO (ERP DE VENTAS)
  const renderSalesModule = () => {
    
    // UI Helpers internos para el Módulo Sales
    const handleConfInput = (k) => (v) => setNewSalesConfig({...newSalesConfig, [k]: v});
    const handleRecInput = (k) => (v) => setNewSaleRecord({...newSaleRecord, [k]: v});

    return (
      <div className="space-y-6 md:space-y-8 animate-in fade-in duration-500 pb-20">
        
        {/* SUB-NAVEGACIÓN INTERNA */}
        <div className="bg-white p-2 rounded-2xl shadow-sm border border-zinc-200 inline-flex overflow-x-auto max-w-full no-scrollbar">
            <button onClick={()=>setSalesTab('dashboard')} className={`px-6 py-3 rounded-xl text-[10px] md:text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap ${salesTab === 'dashboard' ? 'bg-indigo-600 text-white shadow-md' : 'text-zinc-500 hover:bg-zinc-50'}`}>📊 Dashboard</button>
            <button onClick={()=>setSalesTab('records')} className={`px-6 py-3 rounded-xl text-[10px] md:text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap ${salesTab === 'records' ? 'bg-indigo-600 text-white shadow-md' : 'text-zinc-500 hover:bg-zinc-50'}`}>📝 Cierre Diario</button>
            <button onClick={()=>setSalesTab('config')} className={`px-6 py-3 rounded-xl text-[10px] md:text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap ${salesTab === 'config' ? 'bg-indigo-600 text-white shadow-md' : 'text-zinc-500 hover:bg-zinc-50'}`}>⚙️ Configuración</button>
        </div>

        {/* === SUB-TAB: DASHBOARD DE RENDIMIENTO === */}
        {salesTab === 'dashboard' && (
           <div className="space-y-6">
              {/* FILTROS DASHBOARD */}
              <div className="bg-white rounded-[2rem] p-5 shadow-sm border border-zinc-200/50 flex flex-col md:flex-row gap-4 items-end">
                  <div className="flex-1 w-full flex flex-col sm:flex-row gap-4">
                      <div className="w-full">
                          <label className="text-[9px] font-black text-zinc-400 uppercase px-1 mb-1 block">Desde</label>
                          <input type="date" value={salesFilter.startDate} onChange={e => setSalesFilter({...salesFilter, startDate: e.target.value})} className="w-full p-3 rounded-xl border border-zinc-200 text-sm font-bold text-zinc-700 outline-none focus:border-indigo-400" />
                      </div>
                      <div className="w-full">
                          <label className="text-[9px] font-black text-zinc-400 uppercase px-1 mb-1 block">Hasta</label>
                          <input type="date" value={salesFilter.endDate} onChange={e => setSalesFilter({...salesFilter, endDate: e.target.value})} className="w-full p-3 rounded-xl border border-zinc-200 text-sm font-bold text-zinc-700 outline-none focus:border-indigo-400" />
                      </div>
                      <div className="w-full">
                          <label className="text-[9px] font-black text-zinc-400 uppercase px-1 mb-1 block">Vendedora / Producto</label>
                          <select value={salesFilter.configId} onChange={e => setSalesFilter({...salesFilter, configId: e.target.value})} className="w-full p-3 rounded-xl border border-zinc-200 text-[11px] md:text-sm font-bold text-zinc-700 outline-none focus:border-indigo-400">
                              <option value="all">TODAS LAS VENDEDORAS</option>
                              {salesConfigs.map(c => <option key={c.id} value={c.id}>{c.vendedora.toUpperCase()} - {c.productName}</option>)}
                          </select>
                      </div>
                  </div>
              </div>

              {/* MÉTRICAS GLOBALES */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                 <div className="bg-white p-5 rounded-2xl md:rounded-[2rem] border border-zinc-200 shadow-sm text-left">
                    <p className="text-[9px] md:text-[11px] font-black text-zinc-400 uppercase tracking-widest mb-1 leading-none">Facturación Real</p>
                    <p className="text-xl md:text-4xl font-black font-mono tracking-tighter text-zinc-900">{formatCurrency(dashboardData.totalRevenue)}</p>
                 </div>
                 <div className="bg-white p-5 rounded-2xl md:rounded-[2rem] border border-zinc-200 shadow-sm text-left">
                    <p className="text-[9px] md:text-[11px] font-black text-zinc-400 uppercase tracking-widest mb-1 leading-none">Inversión FB</p>
                    <p className="text-xl md:text-4xl font-black font-mono tracking-tighter text-zinc-900">{formatCurrency(dashboardData.totalAdSpend)}</p>
                 </div>
                 <div className="bg-indigo-600 p-5 rounded-2xl md:rounded-[2rem] shadow-xl text-left text-white">
                    <p className="text-[9px] md:text-[11px] font-black text-indigo-200 uppercase tracking-widest mb-1 leading-none">ROAS Global</p>
                    <p className="text-3xl md:text-5xl font-black tracking-tighter">{dashboardData.roas.toFixed(2)}</p>
                 </div>
                 <div className={`p-5 rounded-2xl md:rounded-[2rem] shadow-xl text-left text-white ${dashboardData.netProfit < 0 ? 'bg-rose-500' : 'bg-emerald-500'}`}>
                    <p className="text-[9px] md:text-[11px] font-black uppercase tracking-widest mb-1 leading-none opacity-80">Profit Neto Acumulado</p>
                    <p className="text-2xl md:text-4xl font-black font-mono tracking-tighter">{formatCurrency(dashboardData.netProfit)}</p>
                 </div>
              </div>

              {/* DETALLE Y PROYECCIONES */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
                  {/* Operación */}
                  <div className="bg-white rounded-2xl p-6 border border-zinc-200 shadow-sm space-y-4">
                      <h3 className="text-[11px] font-black text-zinc-900 uppercase tracking-widest border-b pb-2">📦 Operación del Período</h3>
                      <OutputP label="Pedidos Generados" value={dashboardData.totalOrders} type="number" decimals={0} customBg="bg-zinc-50 border-zinc-100" />
                      <OutputP label="Unidades Despachadas" value={dashboardData.totalUnits} type="number" decimals={0} customBg="bg-zinc-50 border-zinc-100" />
                      <OutputP label="Entregas Efectivas Estimadas" value={dashboardData.effectiveDeliveriesAccumulator} type="number" decimals={1} customBg="bg-blue-50 border-blue-100" customText="text-blue-900" />
                      <OutputP label="CPA Real Promedio" value={dashboardData.cpaReal} type="currency" customBg="bg-zinc-900 border-zinc-900 shadow-lg" customText="text-white" />
                  </div>

                  {/* Costos Desglosados */}
                  <div className="bg-white rounded-2xl p-6 border border-zinc-200 shadow-sm space-y-4">
                      <h3 className="text-[11px] font-black text-rose-500 uppercase tracking-widest border-b pb-2">💳 Desglose de Costos Totales</h3>
                      <OutputP label="Costo de Productos" value={dashboardData.totalProductCost} type="currency" customBg="bg-rose-50 border-rose-100" customText="text-rose-900" />
                      <OutputP label="Logística (Flete + Fulfill)" value={dashboardData.totalLogistics} type="currency" customBg="bg-rose-50 border-rose-100" customText="text-rose-900" />
                      <OutputP label="Comisiones Pagadas" value={dashboardData.totalCommissions} type="currency" customBg="bg-rose-50 border-rose-100" customText="text-rose-900" />
                      <OutputP label="Pérdidas x Devolución" value={dashboardData.totalReturnsCost} type="currency" customBg="bg-rose-500 border-rose-600 shadow-lg" customText="text-white" />
                  </div>

                  {/* Proyección */}
                  <div className="bg-zinc-900 rounded-2xl p-6 shadow-2xl space-y-4 text-white relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/20 rounded-full blur-[40px] -mr-10 -mt-10"></div>
                      <h3 className="text-[11px] font-black text-zinc-400 uppercase tracking-widest border-b border-zinc-800 pb-2 relative z-10">🚀 Proyección de Cierre</h3>
                      <div className="relative z-10">
                          <p className="text-[10px] font-bold text-zinc-500 uppercase mb-1">Días Operados en Filtro</p>
                          <p className="text-xl font-mono mb-4">{new Set(allSalesRecords.filter(r => new Date(r.date) >= new Date(salesFilter.startDate) && new Date(r.date) <= new Date(salesFilter.endDate)).map(r => r.date)).size || 0} días</p>
                          
                          <p className="text-[10px] font-bold text-zinc-500 uppercase mb-1">Proyección Ingresos Mensuales</p>
                          <p className="text-2xl font-mono font-black mb-4">{formatCurrency(dashboardData.projectedMonthlyRevenue)}</p>
                          
                          <p className="text-[10px] font-bold text-zinc-500 uppercase mb-1">Margen Neto Real</p>
                          <p className={`text-4xl font-black italic ${dashboardData.margin > 0 ? 'text-emerald-400' : 'text-rose-500'}`}>{dashboardData.margin.toFixed(2)}%</p>
                      </div>
                  </div>
              </div>
           </div>
        )}

        {/* === SUB-TAB: REGISTRO DIARIO (Fase 2) === */}
        {salesTab === 'records' && (
           <div className="space-y-6 text-left">
              <div className="bg-indigo-600 rounded-[2rem] p-6 md:p-10 shadow-2xl border border-indigo-500 relative overflow-hidden text-white">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-[80px] -mr-20 -mt-20 pointer-events-none"></div>
                  <h2 className="text-xl md:text-3xl font-black uppercase tracking-tighter italic mb-2 relative z-10">Panel de Cierre Diario</h2>
                  <p className="text-[10px] md:text-xs text-indigo-200 mb-8 max-w-xl font-bold relative z-10">Selecciona la vendedora e ingresa los datos agrupados del día. La plataforma calculará los ingresos, unidades vendidas y todos los costos de forma automática basados en el ticket promedio.</p>
                  
                  {formError && <div className="bg-rose-500/20 border border-rose-400 text-white p-3 rounded-xl mb-6 text-[11px] font-bold relative z-10">⚠ {formError}</div>}

                  <div className="grid grid-cols-1 md:grid-cols-6 gap-4 relative z-10">
                      <div className="md:col-span-1">
                          <label className="text-[9px] font-black text-indigo-200 uppercase px-1 mb-1 block">Fecha</label>
                          <input type="date" value={newSaleRecord.date} onChange={e => setNewSaleRecord({...newSaleRecord, date: e.target.value})} className="w-full bg-white/10 border border-white/20 rounded-xl p-3 text-sm font-bold outline-none focus:border-white transition-colors" />
                      </div>
                      <div className="md:col-span-2">
                          <label className="text-[9px] font-black text-indigo-200 uppercase px-1 mb-1 block">Vendedora / Producto</label>
                          <select value={newSaleRecord.configId} onChange={e => handleRecordConfigSelect(e.target.value)} className="w-full bg-white/10 border border-white/20 rounded-xl p-3 text-[11px] md:text-sm font-bold outline-none focus:border-white transition-colors [&>option]:text-zinc-900">
                              <option value="" disabled>SELECCIONAR...</option>
                              {salesConfigs.map(c => <option key={c.id} value={c.id}>{c.vendedora.toUpperCase()} - {c.productName}</option>)}
                          </select>
                      </div>
                      <div className="md:col-span-1">
                          <label className="text-[9px] font-black text-indigo-200 uppercase px-1 mb-1 block">Inversión FB</label>
                          <input type="number" value={newSaleRecord.adSpend} onChange={e => setNewSaleRecord({...newSaleRecord, adSpend: parseFloat(e.target.value)||0})} disabled={salesConfigs.find(c => c.id === newSaleRecord.configId)?.fixedAdSpend} className="w-full bg-white/10 border border-white/20 rounded-xl p-3 text-sm font-mono font-bold outline-none focus:border-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors" placeholder="0" />
                      </div>
                      <div className="md:col-span-1">
                          <label className="text-[9px] font-black text-indigo-200 uppercase px-1 mb-1 block">Pedidos D.</label>
                          <input type="number" value={newSaleRecord.orders} onChange={e => setNewSaleRecord({...newSaleRecord, orders: parseFloat(e.target.value)||0})} className="w-full bg-white/10 border border-white/20 rounded-xl p-3 text-sm font-mono font-bold outline-none focus:border-white transition-colors" placeholder="0" />
                      </div>
                      <div className="md:col-span-1">
                          <label className="text-[9px] font-black text-indigo-200 uppercase px-1 mb-1 block">Unds. Total</label>
                          <input type="number" value={newSaleRecord.units} onChange={e => setNewSaleRecord({...newSaleRecord, units: parseFloat(e.target.value)||0})} className="w-full bg-white/10 border border-white/20 rounded-xl p-3 text-sm font-mono font-bold outline-none focus:border-white transition-colors" placeholder="0" />
                      </div>
                      <div className="md:col-span-2 md:col-start-4">
                          <label className="text-[9px] font-black text-indigo-200 uppercase px-1 mb-1 block">Facturación Bruta (Ingresos)</label>
                          <div className="flex items-center gap-2 w-full bg-white/10 border border-white/20 rounded-xl px-3 focus-within:border-white transition-colors">
                              <span className="font-bold text-indigo-300">$</span>
                              <input type="text" value={newSaleRecord.revenue ? new Intl.NumberFormat('es-CO').format(newSaleRecord.revenue) : ''} onChange={e => { const val = e.target.value.replace(/\D/g, ''); setNewSaleRecord({...newSaleRecord, revenue: val !== '' ? parseFloat(val) : ''}); }} className="w-full bg-transparent p-3 pl-0 text-sm font-mono font-bold outline-none" placeholder="0" />
                          </div>
                      </div>
                      <div className="md:col-span-1 md:col-start-6 flex items-end">
                          <button onClick={handleSaveSaleRecord} disabled={isSaving} className="w-full bg-white text-indigo-900 hover:bg-zinc-100 p-3 rounded-xl font-black text-[10px] uppercase tracking-widest shadow-xl active:scale-95 transition-all disabled:opacity-50">
                             {isSaving ? '⏳...' : 'Guardar'}
                          </button>
                      </div>
                  </div>
              </div>

              {/* LISTADO DE ÚLTIMOS REGISTROS */}
              <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
                 <div className="p-4 border-b bg-zinc-50 flex justify-between items-center">
                    <h3 className="text-xs font-black uppercase text-zinc-600 tracking-widest">Últimos Cierres Registrados (Consolidado)</h3>
                 </div>
                 <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                       <thead>
                          <tr className="bg-zinc-50 text-[9px] uppercase tracking-widest text-zinc-400 border-b">
                             <th className="p-3">Fecha</th>
                             <th className="p-3">Vendedora / Prod</th>
                             <th className="p-3">Inversión FB</th>
                             <th className="p-3">Pedidos</th>
                             <th className="p-3">Unidades</th>
                             <th className="p-3">Facturado</th>
                             <th className="p-3 text-center">Acción</th>
                          </tr>
                       </thead>
                       <tbody>
                          {allSalesRecords.slice(0, 50).map(r => {
                             const conf = salesConfigs.find(c => c.id === r.configId);
                             return (
                               <tr key={r.id} className="border-b last:border-0 hover:bg-zinc-50 transition-colors text-[11px] md:text-sm font-bold text-zinc-700">
                                  <td className="p-3 font-mono">{r.date}</td>
                                  <td className="p-3">{conf ? `${conf.vendedora} - ${conf.productName}` : 'Desconocido'}</td>
                                  <td className="p-3 font-mono text-zinc-500">{formatCurrency(r.adSpend)}</td>
                                  <td className="p-3 font-mono">{r.orders}</td>
                                  <td className="p-3 font-mono text-indigo-600">{r.units}</td>
                                  <td className="p-3 font-mono text-emerald-600">{formatCurrency(r.revenue)}</td>
                                  <td className="p-3 text-center">
                                     <button onClick={()=>deleteSaleRecord(r.date, r.id)} className="text-zinc-300 hover:text-rose-500 transition-colors p-1"><svg className="w-4 h-4 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                                  </td>
                               </tr>
                             );
                          })}
                          {allSalesRecords.length === 0 && <tr><td colSpan="7" className="p-8 text-center text-zinc-400 font-bold text-xs uppercase tracking-widest">No hay registros este mes</td></tr>}
                       </tbody>
                    </table>
                 </div>
              </div>
           </div>
        )}

        {/* === SUB-TAB: CONFIGURACIÓN (Fase 1) === */}
        {salesTab === 'config' && (
           <div className="space-y-6 text-left">
              <div className="flex justify-between items-center mb-4">
                 <h2 className="text-lg md:text-2xl font-black text-zinc-900 uppercase italic">Vendedoras y Costos</h2>
                 <button onClick={() => {setIsCreatingSalesConfig(true); setFormError(''); setNewSalesConfig(getInitialSalesConfig());}} className="bg-zinc-900 text-white px-6 py-3 rounded-xl text-[10px] md:text-xs font-black uppercase tracking-widest shadow-xl active:scale-95 transition-all">➕ Añadir Config</button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                 {salesConfigs.map(c => (
                    <div key={c.id} className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden relative">
                       <div className="bg-zinc-900 text-white p-4">
                          <h3 className="font-black text-lg uppercase truncate">{c.vendedora}</h3>
                          <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest truncate">{c.productName}</p>
                       </div>
                       <div className="p-4 grid grid-cols-2 gap-y-3 gap-x-2 text-[10px] font-bold text-zinc-600">
                          <div><span className="block text-[8px] text-zinc-400 uppercase tracking-wider">Costo Prod</span><span className="font-mono">{formatCurrency(c.productCost)}</span></div>
                          <div><span className="block text-[8px] text-zinc-400 uppercase tracking-wider">Flete/Fulfill</span><span className="font-mono">{formatCurrency(c.freight)} / {formatCurrency(c.fulfillment)}</span></div>
                          <div><span className="block text-[8px] text-zinc-400 uppercase tracking-wider">Comisión</span><span className="font-mono">{formatCurrency(c.commission)}</span></div>
                          <div><span className="block text-[8px] text-zinc-400 uppercase tracking-wider">Costos Fijos</span><span className="font-mono">{formatCurrency(c.fixedCosts)}</span></div>
                          <div><span className="block text-[8px] text-zinc-400 uppercase tracking-wider">Devolución</span><span className="font-mono">{c.returnRate}%</span></div>
                          <div><span className="block text-[8px] text-zinc-400 uppercase tracking-wider">Efectividad</span><span className="font-mono">{c.effectiveness}%</span></div>
                          <div className="col-span-2 pt-2 border-t mt-1">
                             <span className="block text-[8px] text-indigo-400 uppercase tracking-wider">Inversión FB</span>
                             <span className="font-mono text-sm text-indigo-600">{c.fixedAdSpend ? `Fija: ${formatCurrency(c.dailyAdSpend)}` : 'Variable (Manual cada día)'}</span>
                          </div>
                       </div>
                       <button onClick={()=>deleteSalesConfig(c.id)} className="absolute top-4 right-4 text-zinc-400 hover:text-rose-500 transition-colors"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                       <button onClick={()=>{setNewSalesConfig(c); setIsCreatingSalesConfig(true);}} className="w-full py-3 bg-zinc-50 border-t border-zinc-100 text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 transition-colors">✏️ Editar Costos</button>
                    </div>
                 ))}
                 {salesConfigs.length === 0 && <div className="col-span-full py-20 text-center text-zinc-400 font-bold uppercase tracking-widest text-sm">No hay configuraciones creadas.</div>}
              </div>
           </div>
        )}

        {/* MODAL CONFIGURACIÓN VENDEDORA */}
        {isCreatingSalesConfig && (
            <div className="fixed inset-0 bg-zinc-950/90 backdrop-blur-xl flex items-center justify-center z-[300] p-3 animate-in fade-in duration-300 text-left">
                <div className="bg-white rounded-2xl md:rounded-[3rem] shadow-2xl max-w-4xl w-full max-h-[95vh] overflow-y-auto no-scrollbar animate-in zoom-in-95 duration-300">
                    <header className="sticky top-0 bg-white/90 backdrop-blur-md p-5 md:p-8 border-b flex justify-between items-center z-10">
                        <h2 className="text-sm md:text-2xl font-black text-zinc-900 uppercase italic">Ajustes Vendedora & Costos</h2>
                        <button onClick={()=>{setIsCreatingSalesConfig(false); setFormError('');}} className="bg-zinc-100 p-2 md:p-3 rounded-full hover:bg-zinc-200 shadow-sm text-zinc-600">✕</button>
                    </header>
                    <div className="p-5 md:p-10 space-y-6">
                        
                        {/* Datos Base */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-b border-zinc-100 pb-6">
                            <div>
                                <label className="text-[9px] font-black text-zinc-400 uppercase px-1 mb-1 block">Nombre Vendedora</label>
                                <input type="text" value={newSalesConfig.vendedora} onChange={e=>handleConfInput('vendedora')(e.target.value)} className="w-full border-2 border-zinc-200 rounded-xl p-3 text-sm font-bold text-zinc-800 outline-none focus:border-indigo-400" placeholder="Ej. Maria Lopez" />
                            </div>
                            <div>
                                <label className="text-[9px] font-black text-zinc-400 uppercase px-1 mb-1 block">Producto (Campaña)</label>
                                <input type="text" value={newSalesConfig.productName} onChange={e=>handleConfInput('productName')(e.target.value)} className="w-full border-2 border-zinc-200 rounded-xl p-3 text-sm font-bold text-zinc-800 outline-none focus:border-indigo-400" placeholder="Ej. Smartwatch X" />
                            </div>
                        </div>

                        {/* Inversión Facebook */}
                        <div className="bg-indigo-50/50 p-5 rounded-2xl border border-indigo-100">
                            <div className="flex items-center justify-between mb-4">
                                <div>
                                    <h4 className="text-[11px] font-black text-indigo-900 uppercase tracking-widest">Inversión Facebook Fija</h4>
                                    <p className="text-[9px] font-bold text-indigo-500 mt-1">Activa para usar el mismo ppto. diario automáticamente.</p>
                                </div>
                                <button onClick={()=>handleConfInput('fixedAdSpend')(!newSalesConfig.fixedAdSpend)} className={`w-12 h-6 rounded-full relative transition-colors ${newSalesConfig.fixedAdSpend ? 'bg-indigo-600' : 'bg-zinc-300'}`}>
                                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${newSalesConfig.fixedAdSpend ? 'left-7' : 'left-1'}`} />
                                </button>
                            </div>
                            {newSalesConfig.fixedAdSpend && (
                                <InputP label="Presupuesto Diario Fijo" value={newSalesConfig.dailyAdSpend} onChange={handleConfInput('dailyAdSpend')} type="currency" prefix="$" />
                            )}
                        </div>

                        {/* Costos Unitarios Operativos */}
                        <h4 className="text-[11px] font-black text-zinc-900 uppercase tracking-widest pt-4 border-t border-zinc-100">Costos Operativos Unitarios</h4>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <InputP label="Ganancia Objetivo" value={newSalesConfig.targetProfit} onChange={handleConfInput('targetProfit')} type="currency" prefix="$" />
                            <InputP label="Costo Producto" value={newSalesConfig.productCost} onChange={handleConfInput('productCost')} type="currency" prefix="$" />
                            <InputP label="Flete" value={newSalesConfig.freight} onChange={handleConfInput('freight')} type="currency" prefix="$" />
                            <InputP label="Fulfillment" value={newSalesConfig.fulfillment} onChange={handleConfInput('fulfillment')} type="currency" prefix="$" />
                            <InputP label="Comisión" value={newSalesConfig.commission} onChange={handleConfInput('commission')} type="currency" prefix="$" />
                            <InputP label="Costos Fijos" value={newSalesConfig.fixedCosts} onChange={handleConfInput('fixedCosts')} type="currency" prefix="$" />
                            <InputP label="% Devolución" value={newSalesConfig.returnRate} onChange={handleConfInput('returnRate')} type="number" suffix="%" />
                            <InputP label="% Efectividad" value={newSalesConfig.effectiveness} onChange={handleConfInput('effectiveness')} type="number" suffix="%" />
                        </div>

                        {formError && <div className="w-full bg-rose-100 border border-rose-400 text-rose-700 font-bold p-3 rounded-xl text-center text-xs">{formError}</div>}

                        <button onClick={handleSaveSalesConfig} disabled={isSaving} className="w-full bg-zinc-900 text-white hover:bg-black font-black py-4 rounded-2xl text-xs md:text-sm uppercase tracking-widest shadow-xl active:scale-95 transition-all disabled:opacity-50 mt-6">
                            {isSaving ? 'Guardando...' : 'Guardar Configuración'}
                        </button>
                    </div>
                </div>
            </div>
        )}
      </div>
    );
  };


  return (
    <div className="min-h-screen bg-[#f1f5f9] p-2 md:p-8 font-sans text-zinc-900 overflow-x-hidden">
      
      {notification && (
        <div className="fixed bottom-6 md:bottom-10 left-1/2 transform -translate-x-1/2 bg-zinc-900 text-white px-6 md:px-8 py-3 md:py-4 rounded-xl md:rounded-2xl shadow-2xl z-[200] font-bold text-[10px] md:text-xs uppercase tracking-widest animate-in slide-in-from-bottom-10 w-[90%] md:w-auto text-center leading-tight">
          {notification}
        </div>
      )}

      <div className="max-w-[1400px] mx-auto">
        
        {/* NAVEGACIÓN */}
        <div className="flex flex-col md:flex-row justify-between items-center mb-4 md:mb-8 gap-3 md:gap-4">
            <div className="bg-white p-1 rounded-2xl md:rounded-[2rem] shadow-xl border border-zinc-200 flex flex-wrap md:flex-nowrap w-full md:w-auto overflow-hidden">
                <button onClick={()=>handleModuleChange('winners')} className={`flex-1 md:flex-none md:px-8 py-2.5 md:py-3 text-[9px] md:text-[11px] font-black uppercase tracking-wider md:tracking-[0.2em] transition-all duration-500 ${activeModule === 'winners' ? 'bg-zinc-900 text-white shadow-lg rounded-xl md:rounded-[1.5rem] scale-105' : 'text-zinc-400'}`}>Winners</button>
                <button onClick={()=>handleModuleChange('imports')} className={`flex-1 md:flex-none md:px-8 py-2.5 md:py-3 text-[9px] md:text-[11px] font-black uppercase tracking-wider md:tracking-[0.2em] transition-all duration-500 ${activeModule === 'imports' ? 'bg-zinc-900 text-white shadow-lg rounded-xl md:rounded-[1.5rem] scale-105' : 'text-zinc-400'}`}>Importación</button>
                <button onClick={()=>handleModuleChange('projection')} className={`flex-1 min-w-[120px] md:flex-none md:px-8 py-2.5 md:py-3 text-[9px] md:text-[11px] font-black uppercase tracking-wider md:tracking-[0.2em] transition-all duration-500 ${activeModule === 'projection' ? 'bg-indigo-600 text-white shadow-lg rounded-xl md:rounded-[1.5rem] scale-105' : 'text-indigo-400/50 hover:text-indigo-600'}`}>Proyección P&G</button>
                <button onClick={()=>handleModuleChange('sales')} className={`flex-1 min-w-[120px] md:flex-none md:px-8 py-2.5 md:py-3 text-[9px] md:text-[11px] font-black uppercase tracking-wider md:tracking-[0.2em] transition-all duration-500 ${activeModule === 'sales' ? 'bg-emerald-600 text-white shadow-lg rounded-xl md:rounded-[1.5rem] scale-105' : 'text-emerald-500/50 hover:text-emerald-600'}`}>Rendimiento</button>
            </div>
            <button onClick={handleLogout} className="text-zinc-400 hover:text-zinc-900 text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all">SALIR <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
        </div>

        {/* --- ENRUTADOR PRINCIPAL --- */}
        {activeModule === 'winners' || activeModule === 'imports' ? (
          <>
            {/* ÁREA DE FILTROS Y BÚSQUEDA */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2 md:gap-4 mb-4 md:mb-6 animate-in fade-in">
                <div className="md:col-span-2 relative">
                    <input 
                        type="text" 
                        placeholder="Buscar..." 
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full bg-white border-2 border-zinc-100 rounded-xl md:rounded-2xl p-3 md:p-4 text-sm md:text-base focus:border-zinc-900 outline-none transition-all shadow-sm"
                    />
                    <span className="absolute right-4 top-1/2 transform -translate-y-1/2 opacity-20">🔍</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-1 gap-2 md:contents">
                  <select 
                      value={supplierFilter}
                      onChange={(e) => setSupplierFilter(e.target.value)}
                      className="w-full bg-white border-2 border-zinc-100 rounded-xl md:rounded-2xl p-3 md:p-4 text-[11px] md:text-base font-bold text-zinc-600 outline-none shadow-sm cursor-pointer"
                  >
                      <option value="all">TODOS PROV.</option>
                      {uniqueSuppliers.filter(s => s !== 'all').map(s => (
                          <option key={s} value={s}>{s.toUpperCase()}</option>
                      ))}
                  </select>
                  <select 
                      value={sortOrder}
                      onChange={(e) => setSortOrder(e.target.value)}
                      className="w-full bg-white border-2 border-zinc-100 rounded-xl md:rounded-2xl p-3 md:p-4 text-[11px] md:text-base font-bold text-zinc-600 outline-none shadow-sm cursor-pointer"
                  >
                      <option value="manual">ORDEN MANUAL</option>
                      <option value="roi-desc">ROI ↑</option>
                      <option value="roi-asc">ROI ↓</option>
                      <option value="recent">RECIENTES</option>
                  </select>
                </div>
            </div>

            <header className="flex flex-col md:flex-row justify-between items-center mb-4 md:mb-6 gap-3 md:gap-4 bg-white p-3 md:p-6 rounded-xl md:rounded-[2rem] shadow-sm border border-zinc-200/50 relative animate-in fade-in">
              <div className="flex items-center gap-3 md:gap-5 w-full md:w-auto">
                <div className="w-10 h-10 md:w-14 md:h-14 bg-zinc-900 rounded-xl md:rounded-[1.2rem] flex items-center justify-center text-white text-xl md:text-2xl shadow-xl italic font-black shrink-0">W</div>
                <div className="text-left">
                  <h1 className="text-lg md:text-3xl font-black tracking-tighter uppercase italic text-zinc-900 leading-none">{activeModule === 'winners' ? 'Winner OS' : 'Importación'}</h1>
                  <p className="text-[7px] md:text-[10px] text-zinc-400 mt-1 uppercase font-black tracking-widest md:tracking-[0.3em]">Sincronizado Cloud</p>
                </div>
              </div>
              <button onClick={() => { setIsCreating(true); setFormError(''); }} className="bg-zinc-900 hover:bg-black text-white w-full md:w-auto px-6 md:px-10 py-3 md:py-4 rounded-xl md:rounded-[1.2rem] shadow-2xl font-black text-[10px] md:text-xs uppercase tracking-widest active:scale-95 transition-all">➕ Crear Registro</button>
            </header>

            {/* TABS DE ESTADO */}
            <div className="flex md:justify-center gap-1.5 md:gap-2 mb-4 md:mb-10 overflow-x-auto no-scrollbar pb-2 animate-in fade-in">
              {Object.values(activeModule === 'winners' ? WINNER_STATUS : IMPORT_STATUS).map((config) => (
                <button key={config.id} onClick={() => setActiveTab(config.id)} className={`px-3 md:px-6 py-2 md:py-3.5 rounded-lg md:rounded-[1.2rem] font-black text-[10px] md:text-[11px] whitespace-nowrap uppercase transition-all tracking-wider md:tracking-widest ${activeTab === config.id ? `${config.activeColor} shadow-xl scale-105` : 'bg-white text-zinc-400 border border-zinc-200/50 shadow-sm'}`}>
                  {config.emoji} {config.label} <span className="ml-1 opacity-40">({products.filter(p => p.status === config.id).length})</span>
                </button>
              ))}
            </div>

            {/* LISTADO DE PRODUCTOS */}
            <div className="grid grid-cols-1 gap-4 md:gap-12 pb-20 animate-in slide-in-from-bottom-8">
              {displayedProducts.map((p, idx) => {
                const isWinner = activeModule === 'winners';
                const mWinner = isWinner ? calculateWinnerMetrics(p) : null;
                const mImport = !isWinner ? calculateImportMetrics(p) : null;
                const stCfg = (isWinner ? WINNER_STATUS[p.status] : IMPORT_STATUS[p.status]) || (isWinner ? WINNER_STATUS.pending : IMPORT_STATUS.pending);

                return (
                  <div 
                    key={p.id} 
                    className={`rounded-2xl md:rounded-[3rem] shadow-sm border transition-all duration-500 overflow-hidden ${p.isWorking ? 'bg-amber-50 border-amber-400 shadow-amber-100 ring-2 ring-amber-500/20' : 'bg-white border-zinc-200/50'}`}
                  >
                    
                    <div className={`px-3 md:px-10 py-2 md:py-4 flex justify-between items-center border-b ${p.isWorking ? 'bg-amber-100/50 border-amber-200' : 'bg-zinc-50/20'}`}>
                       <div className="flex items-center gap-2 md:gap-6 flex-wrap text-left">
                         <div className="bg-zinc-900 text-white px-2 py-1 rounded-lg text-[8px] md:text-[11px] font-black tracking-widest">{p.regNumber}</div>
                         
                         <div className="flex items-center gap-2 px-2 py-1 bg-white rounded-lg border border-zinc-200 shadow-sm cursor-pointer active:scale-95 transition-all" onClick={() => updateDocField(p.id, 'isWorking', !p.isWorking)}>
                            <span className={`text-[8px] md:text-[10px] font-black uppercase tracking-tighter ${p.isWorking ? 'text-amber-600' : 'text-zinc-400'}`}>EN PROCESO</span>
                            <div className={`w-7 h-4 md:w-9 md:h-5 rounded-full relative transition-colors ${p.isWorking ? 'bg-amber-500' : 'bg-zinc-200'}`}>
                              <div className={`absolute top-0.5 w-3 h-3 md:w-4 md:h-4 bg-white rounded-full shadow-sm transition-all ${p.isWorking ? 'left-[0.9rem] md:left-[1.2rem]' : 'left-0.5'}`} />
                            </div>
                         </div>

                         <span className="font-black text-[8px] md:text-[11px] uppercase tracking-widest text-zinc-500 whitespace-nowrap">{stCfg.emoji} {stCfg.label}</span>
                         
                         <div className={`flex items-center bg-white rounded-lg md:rounded-2xl p-0.5 md:p-1 shadow-inner border border-zinc-100 transition-opacity ${sortOrder === 'manual' ? 'opacity-100' : 'opacity-20 pointer-events-none'}`}>
                            <button onClick={() => moveItem(p.id, -1)} disabled={idx === 0} className="w-6 h-6 md:w-9 md:h-9 flex items-center justify-center hover:bg-zinc-900 hover:text-white rounded-md md:rounded-xl transition-all disabled:opacity-10"><svg className="w-2 md:w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="4"><path d="M5 15l7-7 7 7"/></svg></button>
                            <span className="text-[7px] md:text-[10px] font-black text-zinc-400 px-1 md:px-3 whitespace-nowrap">#{idx + 1}</span>
                            <button onClick={() => moveItem(p.id, 1)} disabled={idx === displayedProducts.length - 1} className="w-6 h-6 md:w-9 md:h-9 flex items-center justify-center hover:bg-zinc-900 hover:text-white rounded-md md:rounded-xl transition-all disabled:opacity-10"><svg className="w-2 md:w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="4"><path d="M19 9l-7 7-7-7"/></svg></button>
                         </div>
                       </div>
                       <button onClick={() => deleteItem(p.id)} className="text-zinc-300 hover:text-rose-600 transition-all hover:scale-110 shrink-0"><svg className="w-4 h-4 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
                    </div>

                    <div className="flex flex-col xl:flex-row">
                       <div className="w-full xl:w-[35%] p-3 md:p-10 border-r border-zinc-100 bg-zinc-50/10 text-left">
                         <div className="flex flex-col items-center">
                           <div className="w-20 h-20 md:w-64 md:h-64 aspect-square bg-white rounded-xl md:rounded-[2.5rem] border border-zinc-200 md:mb-6 relative overflow-hidden shadow-sm group/img cursor-pointer shrink-0">
                             {p.image ? <img src={p.image} className="w-full h-full object-cover" alt="Producto"/> : <span className="text-xs md:text-4xl opacity-10 font-bold flex items-center justify-center h-full italic">IMG</span>}
                             <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e)=>handleImage(e, p.id)}/>
                           </div>
                           <div className="w-full text-center md:text-left mt-3 md:mt-0">
                             <input value={p.name || ''} onChange={(e)=>updateDocField(p.id, 'name', e.target.value)} className="w-full text-sm md:text-xl font-black bg-transparent border-b border-transparent hover:border-zinc-200 focus:border-zinc-900 outline-none md:mb-4 py-1 transition-all text-zinc-900 truncate" placeholder="Nombre..."/>
                             
                             <div className="grid grid-cols-2 gap-2 mt-2 md:mt-0 md:mb-6">
                                {isWinner ? (
                                  <>
                                    <div className="bg-white border border-zinc-100 p-1.5 md:p-3 rounded-lg md:rounded-2xl shadow-sm cursor-pointer hover:border-blue-300 transition-colors" onClick={()=>copyToClipboard(p.dropiCode)}>
                                        <label className="text-[6px] md:text-[8px] font-black text-zinc-400 uppercase tracking-widest block mb-0.5 leading-none">DROPI 📋</label>
                                        <input value={p.dropiCode || ''} onChange={(e)=>updateDocField(p.id, 'dropiCode', e.target.value)} className="text-[11px] md:text-sm font-mono font-bold truncate w-full outline-none bg-transparent text-zinc-800"/>
                                    </div>
                                    <div className="bg-white border border-zinc-100 p-1.5 md:p-3 rounded-lg md:rounded-2xl shadow-sm">
                                        <label className="text-[6px] md:text-[8px] font-black text-zinc-400 uppercase tracking-widest block mb-0.5 leading-none text-left">PROV.</label>
                                        <input value={p.supplier || ''} onChange={(e)=>updateDocField(p.id, 'supplier', e.target.value)} className="w-full text-[11px] md:text-sm font-bold outline-none bg-transparent text-zinc-800"/>
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <div className="bg-white border border-zinc-100 p-1.5 md:p-3 rounded-lg md:rounded-2xl shadow-sm text-left">
                                        <label className="text-[6px] md:text-[8px] font-black text-zinc-400 uppercase tracking-widest block mb-0.5 leading-none">CH-PROV</label>
                                        <input value={p.chineseSupplier || ''} onChange={(e)=>updateDocField(p.id, 'chineseSupplier', e.target.value)} className="w-full text-[11px] md:text-sm font-bold outline-none bg-transparent text-zinc-800 truncate"/>
                                    </div>
                                    <div className="bg-white border border-zinc-100 p-1.5 md:p-3 rounded-lg md:rounded-2xl shadow-sm text-left">
                                        <label className="text-[6px] md:text-[8px] font-black text-zinc-400 uppercase tracking-widest block mb-0.5 leading-none">TRM</label>
                                        <input type="number" value={p.dollarRate || 0} onChange={(e)=>updateDocField(p.id, 'dollarRate', parseFloat(e.target.value)||0)} className="w-full text-[11px] md:text-sm font-mono font-bold outline-none bg-transparent text-zinc-800"/>
                                    </div>
                                  </>
                                )}
                             </div>
                           </div>
                         </div>

                         {isWinner && (
                           <div className="mt-3">
                             <button 
                               onClick={() => setExpandedItems({...expandedItems, [`desc_${p.id}`]: !expandedItems[`desc_${p.id}`]})}
                               className="w-full flex justify-between items-center px-3 py-2 bg-white border border-zinc-200 rounded-lg text-[9px] font-black text-zinc-500 uppercase tracking-widest shadow-sm hover:bg-zinc-50 transition-colors"
                             >
                               <span>Ver Estrategia</span>
                               <svg className={`w-3 h-3 transition-transform ${expandedItems[`desc_${p.id}`] ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7" strokeWidth="4"/></svg>
                             </button>
                             {expandedItems[`desc_${p.id}`] && (
                               <textarea 
                                 value={p.description || ''} 
                                 onChange={(e)=>updateDocField(p.id, 'description', e.target.value)} 
                                 rows={3} 
                                 className="w-full mt-2 text-[12px] md:text-sm bg-white p-3 md:p-6 rounded-xl border border-zinc-100 shadow-inner text-zinc-500 leading-relaxed text-left animate-in fade-in" 
                                 placeholder="Escribir estrategia..."
                               />
                             )}
                           </div>
                         )}
                       </div>

                       <div className="flex-1 p-3 md:p-10 space-y-4 md:space-y-10 relative text-left">
                          {isWinner ? (
                            <div className="grid grid-cols-4 md:grid-cols-4 gap-2 md:gap-4">
                              {['base', 'cpa', 'freight', 'fulfillment', 'commission', 'returns', 'fixed'].map(k => (
                                <div key={k} className={`p-2 md:p-5 rounded-lg md:rounded-2xl border transition-all hover:bg-white text-left ${p.isWorking ? 'bg-white/70 border-amber-300' : 'bg-zinc-50/50 border-zinc-100'}`}>
                                    <label className="text-[6px] md:text-[10px] font-black text-zinc-400 uppercase block mb-0.5 leading-none">{k}</label>
                                    <input type="number" value={p.costs?.[k] || 0} onChange={(e)=>updateNestedField(p.id, 'costs', k, parseFloat(e.target.value)||0)} className="w-full font-mono text-[11px] md:text-base font-bold bg-transparent outline-none text-zinc-700"/>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="grid grid-cols-4 md:grid-cols-4 gap-2 md:gap-4">
                                {[{k:'prodCostUSD',l:'USD'}, {k:'cbmCostCOP',l:'CBM'}, {k:'unitsQty',l:'Uds'}, {k:'ctnQty',l:'CTN'}, {k:'yiwuFreightUSD',l:'Yiwu'}].map(f=>(
                                    <div key={f.k} className={`p-2 md:p-5 rounded-lg md:rounded-2xl border text-left transition-all ${p.isWorking ? 'bg-white/70 border-amber-300' : 'bg-zinc-50/50 border-zinc-100'}`}>
                                        <label className="text-[6px] md:text-[10px] font-black text-zinc-400 uppercase block mb-0.5 leading-none">{f.l}</label>
                                        <input type="number" value={p[f.k] || 0} onChange={(e)=>updateDocField(p.id, f.k, parseFloat(e.target.value)||0)} className="w-full font-mono text-[11px] md:text-base font-bold bg-transparent outline-none text-zinc-800 leading-none"/>
                                    </div>
                                ))}
                                <div className={`col-span-2 p-2 md:p-5 rounded-lg md:rounded-2xl border text-left transition-all ${p.isWorking ? 'bg-white/70 border-amber-300' : 'bg-zinc-50/50 border-zinc-100'}`}>
                                    <label className="text-[6px] md:text-[10px] font-black text-zinc-400 uppercase block mb-1 leading-none">Medidas (cm)</label>
                                    <div className="grid grid-cols-3 gap-1">
                                        <input type="number" value={p.measures?.width || 0} onChange={(e)=>updateNestedField(p.id, 'measures', 'width', parseFloat(e.target.value)||0)} className="bg-white border p-1 rounded text-sm font-mono w-full text-zinc-800 outline-none"/>
                                        <input type="number" value={p.measures?.height || 0} onChange={(e)=>updateNestedField(p.id, 'measures', 'height', parseFloat(e.target.value)||0)} className="bg-white border p-1 rounded text-sm font-mono w-full text-zinc-800 outline-none"/>
                                        <input type="number" value={p.measures?.length || 0} onChange={(e)=>updateNestedField(p.id, 'measures', 'length', parseFloat(e.target.value)||0)} className="bg-white border p-1 rounded text-sm font-mono w-full text-zinc-800 outline-none"/>
                                    </div>
                                </div>
                                <div className={`col-span-2 md:col-span-1 p-2 md:p-5 rounded-lg md:rounded-2xl border text-left transition-all flex flex-col justify-center ${p.isWorking ? 'bg-white/70 border-amber-300' : 'bg-indigo-50/50 border-indigo-100'}`}>
                                    <label className="text-[6px] md:text-[10px] font-black text-indigo-500 uppercase block mb-1 leading-none">TOTAL CBM</label>
                                    <div className="w-full font-mono text-[11px] md:text-base font-black text-indigo-700 leading-none">{mImport.totalCbm.toFixed(3)}</div>
                                </div>
                            </div>
                          )}

                          {/* DASHBOARD DE RESULTADOS: MAXIMIZADO PARA MÓVIL */}
                          <div className="bg-zinc-900 rounded-xl md:rounded-[3rem] p-5 md:p-10 text-white shadow-2xl relative overflow-hidden">
                             <div className="absolute top-0 right-0 w-32 md:w-80 h-32 md:h-80 bg-indigo-500/10 rounded-full blur-[60px] md:blur-[120px] -mr-16 md:-mr-40 -mt-16 md:-mt-40"></div>
                             
                             {isWinner ? (
                                <div className="relative z-10 space-y-6 md:space-y-8">
                                    <div className="flex justify-between items-end border-b border-zinc-800 pb-4 md:pb-8 gap-4 text-left">
                                        <div className="flex-1">
                                            <label className="text-[9px] md:text-[11px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5 md:mb-4 block leading-none">PVP Sugerido</label>
                                            <div className="flex items-center gap-1 md:gap-2">
                                                <span className="text-xl md:text-3xl font-bold opacity-20">$</span>
                                                <input type="number" value={p.targetPrice || 0} onChange={(e)=>updateDocField(p.id, 'targetPrice', parseFloat(e.target.value)||0)} className="bg-transparent font-black text-2xl md:text-6xl outline-none w-full tracking-tighter focus:text-indigo-400 transition-colors text-white"/>
                                            </div>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <p className="text-[10px] md:text-[11px] font-bold text-rose-400 uppercase tracking-widest mb-1 italic leading-none">Costos</p>
                                            <p className="text-lg md:text-3xl font-mono font-bold text-rose-50">{formatCurrency(mWinner.totalCost)}</p>
                                        </div>
                                    </div>
                                    <div className="flex justify-between items-center gap-4">
                                        <div className="bg-white/5 p-4 md:p-6 rounded-xl md:rounded-[1.8rem] border border-white/5 flex-1 shadow-inner text-left">
                                            <p className="text-[9px] md:text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5 text-left px-1 leading-none">Utilidad Neta</p>
                                            <p className={`text-2xl md:text-5xl font-mono font-bold px-1 text-left ${mWinner.profit > 0 ? 'text-emerald-400' : 'text-rose-500'}`}>{formatCurrency(mWinner.profit)}</p>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <p className="text-[10px] md:text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1 italic leading-none text-right">Margen ROI</p>
                                            <p className="text-4xl md:text-7xl font-black italic tracking-tighter leading-none">{mWinner.margin.toFixed(1)}%</p>
                                        </div>
                                    </div>
                                </div>
                             ) : (
                                <div className="relative z-10 space-y-5 md:space-y-8">
                                    <div className="grid grid-cols-2 gap-6 border-b border-zinc-800 pb-4 md:pb-8 text-left">
                                        <div className="text-left">
                                            <p className="text-[9px] md:text-[11px] font-black text-zinc-500 uppercase tracking-widest mb-1.5 md:mb-3 leading-none italic">China (1.03x)</p>
                                            <p className="text-lg md:text-3xl font-bold font-mono tracking-tight">{formatCurrency(mImport.costChinaCOP)}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-[9px] md:text-[11px] font-black text-zinc-500 uppercase tracking-widest mb-1.5 md:mb-3 leading-none italic">Logística</p>
                                            <p className="text-lg md:text-3xl font-bold font-mono tracking-tight">{formatCurrency(mImport.nationalizationCOP)}</p>
                                        </div>
                                    </div>
                                    <div className="bg-emerald-500/10 p-4 md:p-10 rounded-xl md:rounded-[3rem] border border-emerald-500/20 flex flex-col md:flex-row justify-between items-center gap-3 transition-all hover:bg-emerald-500/20">
                                        <div className="text-left w-full md:w-auto">
                                            <p className="text-[9px] md:text-[12px] font-black text-emerald-400 uppercase tracking-[0.1em] mb-1.5 leading-none">Costo Prod. Colombia</p>
                                            <p className="text-3xl md:text-7xl font-black text-white leading-none tracking-tighter">{formatCurrency(mImport.unitCostColombia)}</p>
                                        </div>
                                        <div className="text-left md:text-right w-full md:w-auto">
                                            <p className="text-[8px] md:text-[10px] font-bold text-zinc-500 uppercase mb-1 leading-none">Inversión Total</p>
                                            <p className="text-sm md:text-2xl font-mono opacity-50 italic">{formatCurrency(mImport.totalLandCostCOP)}</p>
                                        </div>
                                    </div>
                                </div>
                             )}
                          </div>

                          {/* BOTONES DE ESTADO TÁCTILES */}
                          <div className="flex flex-wrap gap-2.5 md:gap-3 justify-center md:justify-start">
                            {Object.values(isWinner ? WINNER_STATUS : IMPORT_STATUS).map(s=>(
                              <button key={s.id} onClick={()=>updateDocField(p.id, 'status', s.id)} className={`px-4 md:px-8 py-3 md:py-3.5 rounded-xl md:rounded-xl text-[10px] md:text-[11px] font-black border-2 uppercase transition-all whitespace-nowrap active:scale-95 ${p.status===s.id ? `bg-white ${s.activeColor} border-zinc-900 shadow-xl` : 'bg-white border-zinc-100 text-zinc-400'}`}>
                                {s.emoji} {s.label}
                              </button>
                            ))}
                          </div>
                       </div>

                       {/* BUNDLES */}
                       {isWinner && (
                        <div className="w-full xl:w-[32%] bg-[#fcfdfe] p-3 md:p-10 flex flex-col border-l border-zinc-100 shadow-inner">
                            <button onClick={()=>setExpandedItems({...expandedItems, [`u_${p.id}`]: !expandedItems[`u_${p.id}`]})} className={`w-full flex justify-between items-center p-3 md:p-6 rounded-xl md:rounded-[1.5rem] border-2 transition-all duration-500 ${expandedItems[`u_${p.id}`] ? 'bg-zinc-900 text-white border-zinc-900 shadow-xl' : 'bg-white border-zinc-200 text-zinc-900 shadow-sm'}`}>
                               <div className="flex items-center gap-2 md:gap-4 text-left leading-none"><span className="text-sm md:text-2xl">🍱</span><div className="text-left"><p className="text-[10px] md:text-[11px] font-black uppercase tracking-widest leading-none">Bundles</p><p className="text-[8px] font-bold mt-1 opacity-50 uppercase leading-none">{mWinner.activeUpsells} Activos</p></div></div>
                               <svg className={`w-3 h-3 md:w-4 md:h-6 transition-transform ${expandedItems[`u_${p.id}`] ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7" strokeWidth="4"/></svg>
                            </button>
                            <div className={`transition-all duration-700 ease-in-out overflow-hidden ${expandedItems[`u_${p.id}`] ? 'max-h-[1200px] opacity-100 mt-4 md:mt-8' : 'max-h-0 opacity-0 mt-0'}`}>
                               <div className="space-y-2 md:space-y-4 no-scrollbar text-left px-1">
                                   {(p.upsells || getInitialWinner().upsells).map(u=>(
                                       <div key={u.id} className="bg-white p-2 md:p-4 rounded-xl md:rounded-2xl border border-zinc-200 flex gap-3 md:gap-4 relative group border-l-4 md:border-l-8 border-l-indigo-600 transition-all text-left">
                                           <div className="w-10 h-10 md:w-16 bg-zinc-50 rounded-lg md:rounded-2xl relative shrink-0 flex items-center justify-center border overflow-hidden shadow-inner">
                                               {u.image ? <img src={u.image} className="w-full h-full object-cover" alt="Upsell"/> : <span className="text-sm opacity-20 font-black">+</span>}
                                               <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e)=>handleImage(e, p.id, u.id)}/>
                                           </div>
                                           <div className="flex-1 min-w-0 pr-6 text-left leading-none">
                                               <input value={u.name || ''} onChange={(e)=>updateUpsell(p, u.id, 'name', e.target.value)} className="w-full text-[11px] md:text-sm font-black bg-transparent border-b border-zinc-100 focus:border-indigo-600 md:mb-2 outline-none truncate text-zinc-800 leading-none" placeholder="Nombre..."/>
                                               <div className="flex gap-2 mt-1">
                                                   <input type="number" value={u.cost || ''} onChange={(e)=>updateUpsell(p, u.id, 'cost', parseFloat(e.target.value)||0)} className="w-1/2 bg-zinc-50 text-[10px] md:text-xs p-1 rounded-lg font-mono outline-none border border-transparent shadow-inner text-zinc-700 leading-none" placeholder="Costo"/>
                                                   <input type="number" value={u.price || ''} onChange={(e)=>updateUpsell(p, u.id, 'price', parseFloat(e.target.value)||0)} className="w-1/2 bg-indigo-50/50 text-[10px] md:text-xs p-1 rounded-lg font-black text-indigo-700 outline-none border border-transparent shadow-inner leading-none" placeholder="Venta"/>
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
          </>
        ) : activeModule === 'projection' ? (
          renderProjectionModule()
        ) : activeModule === 'sales' ? (
          renderSalesModule()
        ) : null}
      </div>

      {/* MODAL CREACIÓN (SOLO PARA WINNERS E IMPORTS) */}
      {isCreating && activeModule !== 'projection' && activeModule !== 'sales' && (
        <div className="fixed inset-0 bg-zinc-950/90 backdrop-blur-xl flex items-center justify-center z-[300] p-3 animate-in fade-in duration-300">
            <div className="bg-white rounded-2xl md:rounded-[3.5rem] shadow-2xl max-w-5xl w-full max-h-[95vh] overflow-y-auto no-scrollbar animate-in zoom-in-95 duration-300">
                <header className="sticky top-0 bg-white/90 backdrop-blur-md p-4 md:p-8 border-b flex justify-between items-center z-10">
                    <h2 className="text-sm md:text-2xl font-black text-zinc-900 uppercase italic">Registro Cloud</h2>
                    <button onClick={()=>{setIsCreating(false); setFormError('');}} className="bg-zinc-100 p-2 md:p-3 rounded-full hover:bg-zinc-200 shadow-sm text-zinc-600">✕</button>
                </header>
                <div className="p-4 md:p-12">
                    {renderCreationForm()}
                    {formError && (
                      <div className="w-full bg-rose-100 border-2 border-rose-500 text-rose-700 font-bold p-3 rounded-xl mt-6 text-center text-[11px] md:text-sm animate-in fade-in">
                        {formError}
                      </div>
                    )}
                    <button 
                      onClick={handleSave} 
                      disabled={isSaving}
                      className="w-full mt-6 bg-zinc-900 hover:bg-black text-white font-black py-5 md:py-7 rounded-xl md:rounded-[2rem] text-sm md:text-xl shadow-2xl transition-all uppercase tracking-widest md:tracking-[0.4em] active:scale-[0.98] disabled:opacity-50"
                    >
                        {isSaving ? 'Guardando...' : 'Confirmar Registro'}
                    </button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
}
