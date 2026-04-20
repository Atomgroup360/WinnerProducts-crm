import React, { useState, useEffect, useMemo } from 'react';
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

// --- ESTADOS INICIALES ---
const INITIAL_WINNER = {
  type: 'winner',
  name: '', dropiCode: '', supplier: '', description: '',
  costs: { base: 0, freight: 0, fulfillment: 0, commission: 0, cpa: 0, returns: 0, fixed: 0 },
  targetPrice: 0, status: 'pending', rejectionReason: '', image: null, order: 0,
  upsells: [
    { id: 1, name: '', cost: 0, price: 0, image: null },
    { id: 2, name: '', cost: 0, price: 0, image: null },
    { id: 3, name: '', cost: 0, price: 0, image: null },
    { id: 4, name: '', cost: 0, price: 0, image: null },
    { id: 5, name: '', cost: 0, price: 0, image: null }
  ]
};

const INITIAL_IMPORT = {
  type: 'import',
  name: '', chineseSupplier: '', dollarRate: 0, prodCostUSD: 0, cbmCostCOP: 0,
  unitsQty: 0, ctnQty: 0, yiwuFreightUSD: 0, status: 'pending', image: null, order: 0,
  measures: { width: 0, height: 0, length: 0 },
  purchaseDate: '', advancePayment: 0, buyer: '', estimatedArrival: '',
  colors: Array(7).fill(0).map((_, i) => ({ id: i+1, color: '', qty: 0 }))
};

// --- AYUDANTES ---
const formatCurrency = (val) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(val || 0);

const calculateWinnerMetrics = (p) => {
  if (!p) return { totalCost: 0, totalPrice: 0, profit: 0, margin: 0, activeUpsells: 0 };
  const c = p.costs || {};
  const baseCost = (parseFloat(c.base)||0) + (parseFloat(c.freight)||0) + (parseFloat(c.fulfillment)||0) +
    (parseFloat(c.commission)||0) + (parseFloat(c.cpa)||0) + (parseFloat(c.returns)||0) + (parseFloat(c.fixed)||0);
  const basePrice = parseFloat(p.targetPrice) || 0;
  const upsells = p.upsells || [];
  const uCost = upsells.reduce((s, u) => s + (parseFloat(u.cost)||0), 0);
  const uPrice = upsells.reduce((s, u) => s + (parseFloat(u.price)||0), 0);
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

export default function App() {
  const [activeModule, setActiveModule] = useState('winners');
  const [user, setUser] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('pending');
  const [isCreating, setIsCreating] = useState(false);
  const [newProduct, setNewProduct] = useState(INITIAL_WINNER);
  const [expandedItems, setExpandedItems] = useState({});
  const [notification, setNotification] = useState('');
  const [rejectModal, setRejectModal] = useState({ isOpen: false, productId: null, reason: '' });

  // 1. Auth Automático
  useEffect(() => {
    signInAnonymously(auth).catch(console.error);
    return onAuthStateChanged(auth, setUser);
  }, []);

  // 2. Escuchar Datos
  useEffect(() => {
    if (!user) return;
    const colName = activeModule === 'winners' ? 'products' : 'import_products';
    const q = collection(db, 'artifacts', 'winnerproduct-crm', 'public', 'data', colName);
    setLoading(true);
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const loaded = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      loaded.sort((a, b) => (a.order || 0) - (b.order || 0));
      setProducts(loaded);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [user, activeModule]);

  const displayedProducts = useMemo(() => {
    return products.filter(p => p.status === activeTab);
  }, [products, activeTab]);

  const handleModuleChange = (mod) => {
    setActiveModule(mod);
    setActiveTab('pending');
    setNewProduct(mod === 'winners' ? INITIAL_WINNER : INITIAL_IMPORT);
    setIsCreating(false);
  };

  const copyToClipboard = (text) => {
    if (!text) return;
    const textArea = document.createElement("textarea");
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      setNotification(`Copiado: ${text}`);
      setTimeout(() => setNotification(''), 2000);
    } catch (err) { console.error(err); }
    document.body.removeChild(textArea);
  };

  const handleSave = async () => {
    if (!newProduct.name) return;
    const col = activeModule === 'winners' ? 'products' : 'import_products';
    const regPrefix = activeModule === 'winners' ? 'WIN' : 'IMP';
    const regNumber = `${regPrefix}-${(products.length + 1).toString().padStart(3, '0')}`;
    
    try {
      await addDoc(collection(db, 'artifacts', 'winnerproduct-crm', 'public', 'data', col), {
        ...newProduct,
        regNumber,
        order: Date.now(),
        createdAt: serverTimestamp(),
        createdBy: user.uid
      });
      setIsCreating(false);
      setNewProduct(activeModule === 'winners' ? INITIAL_WINNER : INITIAL_IMPORT);
    } catch (e) { console.error(e); }
  };

  const updateDocField = async (id, f, v) => {
    const col = activeModule === 'winners' ? 'products' : 'import_products';
    await updateDoc(doc(db, 'artifacts', 'winnerproduct-crm', 'public', 'data', col, id), { [f]: v });
  };

  const updateNestedField = async (id, parent, f, v) => {
    const col = activeModule === 'winners' ? 'products' : 'import_products';
    const item = products.find(x => x.id === id);
    if (!item) return;
    await updateDoc(doc(db, 'artifacts', 'winnerproduct-crm', 'public', 'data', col, id), { 
      [parent]: { ...item[parent], [f]: v } 
    });
  };

  const updateUpsell = async (p, uid, f, v) => {
    const currentUpsells = p.upsells || INITIAL_WINNER.upsells;
    const newUpsells = currentUpsells.map(u => u.id === uid ? { ...u, [f]: v } : u);
    try {
      await updateDoc(doc(db, 'artifacts', 'winnerproduct-crm', 'public', 'data', 'products', p.id), { upsells: newUpsells });
    } catch (e) { console.error(e); }
  };

  const resetUpsell = async (p, uid) => {
    const currentUpsells = p.upsells || INITIAL_WINNER.upsells;
    const clearedUpsells = currentUpsells.map(u => 
      u.id === uid ? { id: uid, name: '', cost: 0, price: 0, image: null } : u
    );
    try {
      await updateDoc(doc(db, 'artifacts', 'winnerproduct-crm', 'public', 'data', 'products', p.id), { upsells: clearedUpsells });
    } catch (e) { console.error(e); }
  };

  const deleteItem = async (id) => {
    if (window.confirm('¿Borrar registro permanentemente?')) {
      const col = activeModule === 'winners' ? 'products' : 'import_products';
      await deleteDoc(doc(db, 'artifacts', 'winnerproduct-crm', 'public', 'data', col, id));
    }
  };

  const moveItem = async (id, dir) => {
    const col = activeModule === 'winners' ? 'products' : 'import_products';
    const list = products.filter(p => p.status === activeTab);
    const idx = list.findIndex(p => p.id === id);
    const targetIdx = idx + dir;
    if (targetIdx >= 0 && targetIdx < list.length) {
      const a = list[idx], b = list[targetIdx];
      await updateDoc(doc(db, 'artifacts', 'winnerproduct-crm', 'public', 'data', col, a.id), { order: b.order || Date.now() });
      await updateDoc(doc(db, 'artifacts', 'winnerproduct-crm', 'public', 'data', col, b.id), { order: a.order || Date.now() - 100 });
    }
  };

  const handleImage = (e, targetId = null, upsellId = null) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      if (!targetId) {
        if (upsellId) {
          const up = newProduct.upsells.map(u => u.id === upsellId ? {...u, image: reader.result} : u);
          setNewProduct({...newProduct, upsells: up});
        } else {
          setNewProduct({...newProduct, image: reader.result});
        }
      } else {
        const col = activeModule === 'winners' ? 'products' : 'import_products';
        const item = products.find(x => x.id === targetId);
        if (!item) return;
        if (upsellId) {
          const currentUpsells = item.upsells || INITIAL_WINNER.upsells;
          const up = currentUpsells.map(u => u.id === upsellId ? {...u, image: reader.result} : u);
          updateDoc(doc(db, 'artifacts', 'winnerproduct-crm', 'public', 'data', col, targetId), { upsells: up });
        } else {
          updateDoc(doc(db, 'artifacts', 'winnerproduct-crm', 'public', 'data', col, targetId), { image: reader.result });
        }
      }
    };
    reader.readAsDataURL(file);
  };

  const confirmRejection = async () => {
    if (!rejectModal.productId) return;
    await updateDoc(doc(db, 'artifacts', 'winnerproduct-crm', 'public', 'data', 'products', rejectModal.productId), {
      status: 'rejected', rejectionReason: rejectModal.reason
    });
    setRejectModal({ isOpen: false, productId: null, reason: '' });
  };

  const renderCreationForm = () => {
    if (activeModule === 'winners') {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 text-zinc-900">
          <div className="space-y-4 md:space-y-5">
            <div className="aspect-square bg-zinc-50 rounded-xl md:rounded-2xl border-2 border-dashed border-zinc-200 relative flex items-center justify-center overflow-hidden shadow-inner group max-w-sm mx-auto w-full">
              {newProduct.image ? <img src={newProduct.image} className="w-full h-full object-cover"/> : <span className="text-zinc-300 font-bold text-[10px] uppercase">Foto Producto</span>}
              <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e)=>handleImage(e)}/>
            </div>
            <input value={newProduct.name} onChange={(e)=>setNewProduct({...newProduct, name: e.target.value})} className="w-full border-b border-zinc-100 pb-2 font-bold text-xl md:text-2xl outline-none focus:border-zinc-900" placeholder="Nombre Comercial..."/>
            <div className="grid grid-cols-2 gap-4">
              <input value={newProduct.dropiCode} onChange={(e)=>setNewProduct({...newProduct, dropiCode: e.target.value})} className="bg-zinc-50 border border-zinc-100 rounded-xl p-3 text-xs font-mono w-full" placeholder="Cod. DROPI"/>
              <input value={newProduct.supplier} onChange={(e)=>setNewProduct({...newProduct, supplier: e.target.value})} className="bg-zinc-50 border border-zinc-100 rounded-xl p-3 text-xs w-full" placeholder="Proveedor"/>
            </div>
            <textarea value={newProduct.description} onChange={(e)=>setNewProduct({...newProduct, description: e.target.value})} rows={3} className="w-full bg-zinc-50 border border-zinc-100 rounded-xl md:rounded-2xl p-4 text-xs resize-none outline-none" placeholder="Estrategia estratégica..."/>
          </div>
          <div className="space-y-6">
            <div className="bg-zinc-50 p-4 md:p-6 rounded-2xl md:rounded-3xl border border-zinc-100 shadow-sm">
              <h3 className="text-[10px] font-black uppercase text-zinc-400 mb-4 border-b pb-2">Costos Winner (COP)</h3>
              <div className="grid grid-cols-2 gap-3">
                {['base', 'cpa', 'freight', 'fulfillment', 'commission', 'returns', 'fixed'].map(k => (
                  <div key={k}><label className="text-[8px] font-bold text-zinc-500 uppercase block mb-1">{k}</label>
                  <input type="number" onChange={(e)=>setNewProduct({...newProduct, costs: {...newProduct.costs, [k]: parseFloat(e.target.value)||0}})} className="w-full bg-white border border-zinc-200 rounded-lg p-2 text-sm font-mono"/></div>
                ))}
              </div>
            </div>
            <div className="bg-zinc-900 p-5 md:p-6 rounded-2xl md:rounded-3xl text-white shadow-xl">
              <label className="text-[9px] font-bold uppercase text-zinc-500 mb-2 block">PVP Sugerido</label>
              <input type="number" onChange={(e)=>setNewProduct({...newProduct, targetPrice: parseFloat(e.target.value)||0})} className="w-full bg-transparent border-b border-zinc-700 text-3xl md:text-4xl font-bold outline-none"/>
            </div>
          </div>
        </div>
      );
    } else {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 text-zinc-900">
          <div className="space-y-4 md:space-y-5">
            <div className="aspect-square bg-zinc-50 rounded-xl md:rounded-2xl border-2 border-dashed border-zinc-200 relative flex items-center justify-center overflow-hidden shadow-inner group max-w-sm mx-auto w-full">
              {newProduct.image ? <img src={newProduct.image} className="w-full h-full object-cover"/> : <span className="text-zinc-300 font-bold text-[10px] uppercase">Foto Importación</span>}
              <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e)=>handleImage(e)}/>
            </div>
            <input value={newProduct.name} onChange={(e)=>setNewProduct({...newProduct, name: e.target.value})} className="w-full border-b border-zinc-100 pb-2 font-bold text-xl md:text-2xl outline-none focus:border-zinc-900" placeholder="Nombre Producto..."/>
            <div className="grid grid-cols-2 gap-4">
              <input value={newProduct.chineseSupplier} onChange={(e)=>setNewProduct({...newProduct, chineseSupplier: e.target.value})} className="bg-zinc-50 border border-zinc-100 rounded-xl p-3 text-xs w-full" placeholder="Prov. Chino"/>
              <input type="number" onChange={(e)=>setNewProduct({...newProduct, dollarRate: parseFloat(e.target.value)||0})} className="bg-zinc-50 border border-zinc-100 rounded-xl p-3 text-xs font-mono w-full" placeholder="Dólar Hoy"/>
            </div>
          </div>
          <div className="space-y-4">
            <div className="bg-zinc-50 p-4 md:p-5 rounded-xl md:rounded-2xl border border-zinc-100 grid grid-cols-2 gap-3 md:gap-4">
                <div><label className="text-[8px] font-black text-zinc-400 uppercase">Costo USD</label>
                <input type="number" onChange={(e)=>setNewProduct({...newProduct, prodCostUSD: parseFloat(e.target.value)||0})} className="w-full bg-white border border-zinc-200 rounded-lg p-2 text-sm"/></div>
                <div><label className="text-[8px] font-black text-zinc-400 uppercase">CBM COP</label>
                <input type="number" onChange={(e)=>setNewProduct({...newProduct, cbmCostCOP: parseFloat(e.target.value)||0})} className="w-full bg-white border border-zinc-200 rounded-lg p-2 text-sm"/></div>
                <div><label className="text-[8px] font-black text-zinc-400 uppercase">Unidades</label>
                <input type="number" onChange={(e)=>setNewProduct({...newProduct, unitsQty: parseFloat(e.target.value)||0})} className="w-full bg-white border border-zinc-200 rounded-lg p-2 text-sm"/></div>
                <div><label className="text-[8px] font-black text-zinc-400 uppercase">CTN qty</label>
                <input type="number" onChange={(e)=>setNewProduct({...newProduct, ctnQty: parseFloat(e.target.value)||0})} className="w-full bg-white border border-zinc-200 rounded-lg p-2 text-sm"/></div>
                <div className="col-span-2"><label className="text-[8px] font-black text-zinc-400 uppercase">Flete YIWU (USD)</label>
                <input type="number" onChange={(e)=>setNewProduct({...newProduct, yiwuFreightUSD: parseFloat(e.target.value)||0})} className="w-full bg-white border border-zinc-200 rounded-lg p-2 text-sm"/></div>
            </div>
            <div className="bg-zinc-50 p-4 md:p-5 rounded-xl md:rounded-2xl border border-zinc-100">
                <h4 className="text-[8px] font-black text-zinc-400 uppercase mb-2">Medidas CTN (cm)</h4>
                <div className="grid grid-cols-3 gap-2">
                    <input type="number" placeholder="W" onChange={(e)=>setNewProduct({...newProduct, measures: {...newProduct.measures, width: parseFloat(e.target.value)||0}})} className="bg-white border p-2 rounded text-xs w-full"/>
                    <input type="number" placeholder="H" onChange={(e)=>setNewProduct({...newProduct, measures: {...newProduct.measures, height: parseFloat(e.target.value)||0}})} className="bg-white border p-2 rounded text-xs w-full"/>
                    <input type="number" placeholder="L" onChange={(e)=>setNewProduct({...newProduct, measures: {...newProduct.measures, length: parseFloat(e.target.value)||0}})} className="bg-white border p-2 rounded text-xs w-full"/>
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
        <div className="fixed bottom-6 md:bottom-10 left-1/2 transform -translate-x-1/2 bg-zinc-900 text-white px-6 md:px-8 py-3 md:py-4 rounded-xl md:rounded-2xl shadow-2xl z-[200] font-bold text-[10px] md:text-xs uppercase tracking-widest animate-in slide-in-from-bottom-10 w-[90%] md:w-auto text-center">
          ✨ {notification}
        </div>
      )}

      <div className="max-w-[1400px] mx-auto">
        
        {/* NAVEGACIÓN */}
        <div className="flex justify-center mb-6 md:mb-8">
            <div className="bg-white p-1 rounded-2xl md:rounded-[2rem] shadow-xl border border-zinc-200 flex w-full md:w-auto">
                <button onClick={()=>handleModuleChange('winners')} className={`flex-1 md:flex-none md:px-10 py-2.5 md:py-3 rounded-xl md:rounded-[1.5rem] text-[9px] md:text-[11px] font-black uppercase tracking-wider md:tracking-[0.2em] transition-all duration-500 ${activeModule === 'winners' ? 'bg-zinc-900 text-white shadow-lg' : 'text-zinc-400'}`}>Winners</button>
                <button onClick={()=>handleModuleChange('imports')} className={`flex-1 md:flex-none md:px-10 py-2.5 md:py-3 rounded-xl md:rounded-[1.5rem] text-[9px] md:text-[11px] font-black uppercase tracking-wider md:tracking-[0.2em] transition-all duration-500 ${activeModule === 'imports' ? 'bg-zinc-900 text-white shadow-lg' : 'text-zinc-400'}`}>Importación</button>
            </div>
        </div>

        <header className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4 bg-white p-4 md:p-6 rounded-2xl md:rounded-[2rem] shadow-sm border border-zinc-200/50 relative">
          <div className="flex items-center gap-3 md:gap-5 w-full md:w-auto">
            <div className="w-10 h-10 md:w-14 md:h-14 bg-zinc-900 rounded-xl md:rounded-[1.2rem] flex items-center justify-center text-white text-xl md:text-2xl shadow-xl italic font-black shrink-0">W</div>
            <div>
              <h1 className="text-lg md:text-3xl font-black tracking-tighter uppercase italic text-zinc-900 leading-none">
                {activeModule === 'winners' ? 'Winner OS' : 'Importación'}
              </h1>
              <p className="text-[8px] md:text-[10px] text-zinc-400 mt-1 uppercase font-black tracking-widest md:tracking-[0.3em]">{loading ? 'Cargando...' : 'Sistema Cloud V14.5'}</p>
            </div>
          </div>
          <button onClick={() => setIsCreating(true)} className="bg-zinc-900 hover:bg-black text-white w-full md:w-auto px-6 md:px-10 py-3 md:py-4 rounded-xl md:rounded-[1.2rem] shadow-2xl font-black text-[10px] md:text-xs uppercase tracking-widest active:scale-95 transition-all">
            ➕ Crear Registro
          </button>
        </header>

        {/* TABS */}
        <div className="flex gap-2 mb-6 md:mb-10 overflow-x-auto no-scrollbar pb-2">
          {Object.values(activeModule === 'winners' ? WINNER_STATUS : IMPORT_STATUS).map((config) => (
            <button key={config.id} onClick={() => setActiveTab(config.id)} className={`px-5 md:px-8 py-2.5 md:py-3.5 rounded-xl md:rounded-[1.2rem] font-black text-[9px] md:text-[11px] whitespace-nowrap uppercase transition-all tracking-wider md:tracking-widest ${activeTab === config.id ? `${config.activeColor} shadow-xl scale-105` : 'bg-white text-zinc-400 border border-zinc-200/50 shadow-sm'}`}>
              {config.emoji} {config.label} <span className="ml-1 opacity-40">({products.filter(p => p.status === config.id).length})</span>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-6 md:gap-12">
          {displayedProducts.map((p, idx) => {
            const isWinner = activeModule === 'winners';
            const mWinner = isWinner ? calculateWinnerMetrics(p) : null;
            const mImport = !isWinner ? calculateImportMetrics(p) : null;
            const stCfg = (isWinner ? WINNER_STATUS[p.status] : IMPORT_STATUS[p.status]) || (isWinner ? WINNER_STATUS.pending : IMPORT_STATUS.pending);

            return (
              <div key={p.id} className="bg-white rounded-[1.5rem] md:rounded-[3rem] shadow-sm border border-zinc-200/50 overflow-hidden transition-all hover:shadow-xl animate-in slide-in-from-bottom-6 duration-700">
                
                <div className={`px-4 md:px-10 py-3 md:py-4 flex justify-between items-center border-b bg-zinc-50/20`}>
                   <div className="flex items-center gap-3 md:gap-6 flex-wrap">
                     <div className="bg-zinc-900 text-white px-2 md:px-4 py-1 rounded-lg text-[9px] md:text-[11px] font-black tracking-widest">{p.regNumber}</div>
                     <span className="font-black text-[9px] md:text-[11px] uppercase tracking-widest text-zinc-500 whitespace-nowrap">{stCfg.emoji} {stCfg.label}</span>
                     <div className="flex items-center bg-white rounded-xl md:rounded-2xl p-0.5 md:p-1 shadow-inner border border-zinc-100">
                        <button onClick={() => moveItem(p.id, -1)} disabled={idx === 0} className="w-7 h-7 md:w-9 md:h-9 flex items-center justify-center hover:bg-zinc-900 hover:text-white rounded-lg md:rounded-xl transition-all disabled:opacity-10"><svg className="w-3 md:w-4 h-3 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3"><path d="M5 15l7-7 7 7"/></svg></button>
                        <span className="text-[8px] md:text-[10px] font-black text-zinc-400 px-1 md:px-3 whitespace-nowrap">#{idx + 1}</span>
                        <button onClick={() => moveItem(p.id, 1)} disabled={idx === displayedProducts.length-1} className="w-7 h-7 md:w-9 md:h-9 flex items-center justify-center hover:bg-zinc-900 hover:text-white rounded-lg md:rounded-xl transition-all disabled:opacity-10"><svg className="w-3 md:w-4 h-3 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3"><path d="M19 9l-7 7-7-7"/></svg></button>
                     </div>
                   </div>
                   <button onClick={() => deleteItem(p.id)} className="text-zinc-300 hover:text-rose-600 transition-all hover:scale-110 shrink-0"><svg className="w-5 md:w-6 h-5 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
                </div>

                <div className="flex flex-col xl:flex-row">
                   
                   <div className="w-full xl:w-[25%] p-5 md:p-10 border-r border-zinc-100 bg-zinc-50/10">
                     <div className="aspect-square bg-white rounded-xl md:rounded-[2.5rem] border border-zinc-200 mb-6 relative overflow-hidden shadow-sm group/img cursor-pointer max-w-[300px] mx-auto w-full">
                       {p.image ? <img src={p.image} className="w-full h-full object-cover" alt="Producto"/> : <span className="text-2xl md:text-4xl opacity-10 font-bold flex items-center justify-center h-full italic">PREVIEW</span>}
                       <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e)=>handleImage(e, p.id)}/>
                     </div>
                     <input value={p.name || ''} onChange={(e)=>updateDocField(p.id, 'name', e.target.value)} className="w-full text-xl md:text-2xl font-black bg-transparent border-b border-transparent hover:border-zinc-200 focus:border-zinc-900 outline-none mb-4 py-1 transition-all text-zinc-900 text-center md:text-left" placeholder="Nombre..."/>
                     
                     <div className="grid grid-cols-2 gap-2 md:gap-3 mb-6">
                        <div className="bg-white border border-zinc-100 p-2 md:p-3 rounded-xl md:rounded-2xl shadow-sm cursor-pointer hover:border-blue-300 transition-colors" onClick={()=>copyToClipboard(isWinner ? p.dropiCode : p.chineseSupplier)}>
                            <label className="text-[7px] md:text-[8px] font-black text-zinc-400 uppercase tracking-widest block mb-1">ID 📋</label>
                            <input value={(isWinner ? p.dropiCode : p.chineseSupplier) || ''} onChange={(e)=>updateDocField(p.id, isWinner ? 'dropiCode' : 'chineseSupplier', e.target.value)} className="text-[10px] md:text-[11px] font-mono font-bold truncate w-full outline-none bg-transparent"/>
                        </div>
                        <div className="bg-white border border-zinc-100 p-2 md:p-3 rounded-xl md:rounded-2xl shadow-sm">
                            <label className="text-[7px] md:text-[8px] font-black text-zinc-400 uppercase tracking-widest block mb-1">PROV</label>
                            <input value={(isWinner ? p.supplier : p.dollarRate) || ''} onChange={(e)=>updateDocField(p.id, isWinner ? 'supplier' : 'dollarRate', isWinner ? e.target.value : parseFloat(e.target.value)||0)} className="w-full text-[10px] md:text-[11px] font-bold outline-none bg-transparent"/>
                        </div>
                     </div>
                     <textarea value={p.description || ''} onChange={(e)=>updateDocField(p.id, 'description', e.target.value)} rows={3} className="w-full text-[10px] md:text-xs bg-white p-4 md:p-6 rounded-xl md:rounded-[1.5rem] border border-zinc-100 shadow-inner text-zinc-500" placeholder="Estrategia..."/>
                   </div>

                   <div className="flex-1 p-5 md:p-10 space-y-6 md:space-y-10 bg-white relative">
                      {isWinner ? (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4">
                          {['base', 'cpa', 'freight', 'fulfillment', 'commission', 'returns', 'fixed'].map(k => (
                            <div key={k} className="bg-zinc-50/50 p-3 md:p-5 rounded-xl md:rounded-2xl border border-zinc-100 transition-all hover:bg-white">
                                <label className="text-[8px] md:text-[10px] font-black text-zinc-400 uppercase block mb-1">{k}</label>
                                <input type="number" value={p.costs?.[k] || 0} onChange={(e)=>updateNestedField(p.id, 'costs', k, parseFloat(e.target.value)||0)} className="w-full font-mono text-xs md:text-sm font-bold bg-transparent outline-none text-zinc-700"/>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4">
                            {[{k:'prodCostUSD',l:'USD'}, {k:'cbmCostCOP',l:'CBM'}, {k:'unitsQty',l:'Uds'}, {k:'ctnQty',l:'CTN'}, {k:'yiwuFreightUSD',l:'Yiwu'}].map(f=>(
                                <div key={f.k} className="bg-zinc-50/50 p-3 md:p-5 rounded-xl md:rounded-2xl border border-zinc-100">
                                    <label className="text-[8px] md:text-[10px] font-black text-zinc-400 uppercase block mb-1">{f.l}</label>
                                    <input type="number" value={p[f.k] || 0} onChange={(e)=>updateDocField(p.id, f.k, parseFloat(e.target.value)||0)} className="w-full font-mono text-xs md:text-sm font-bold bg-transparent outline-none"/>
                                </div>
                            ))}
                            <div className="col-span-2 bg-zinc-50 p-3 md:p-5 rounded-xl md:rounded-2xl border border-zinc-100">
                                <label className="text-[8px] md:text-[10px] font-black text-zinc-400 uppercase block mb-2">Medidas (cm)</label>
                                <div className="grid grid-cols-3 gap-2">
                                    <input type="number" value={p.measures?.width || 0} onChange={(e)=>updateNestedField(p.id, 'measures', 'width', parseFloat(e.target.value)||0)} className="bg-white border p-1 rounded-lg text-xs font-mono w-full"/>
                                    <input type="number" value={p.measures?.height || 0} onChange={(e)=>updateNestedField(p.id, 'measures', 'height', parseFloat(e.target.value)||0)} className="bg-white border p-1 rounded-lg text-xs font-mono w-full"/>
                                    <input type="number" value={p.measures?.length || 0} onChange={(e)=>updateNestedField(p.id, 'measures', 'length', parseFloat(e.target.value)||0)} className="bg-white border p-1 rounded-lg text-xs font-mono w-full"/>
                                </div>
                            </div>
                        </div>
                      )}

                      <div className="bg-zinc-900 rounded-2xl md:rounded-[3rem] p-5 md:p-10 text-white shadow-2xl relative overflow-hidden">
                         <div className="absolute top-0 right-0 w-48 md:w-80 h-48 md:h-80 bg-indigo-500/10 rounded-full blur-[60px] md:blur-[120px] -mr-24 md:-mr-40 -mt-24 md:-mt-40"></div>
                         
                         {isWinner ? (
                            <div className="relative z-10 space-y-6 md:space-y-8">
                                <div className="flex flex-col md:flex-row justify-between items-start md:items-end border-b border-zinc-800 pb-5 md:pb-8 gap-4 md:gap-8">
                                    <div className="flex-1 w-full">
                                        <label className="text-[9px] md:text-[11px] font-bold text-zinc-500 uppercase tracking-widest mb-2 md:mb-4 block">PVP Total Sugerido</label>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xl md:text-3xl font-bold opacity-20">$</span>
                                            <input type="number" value={p.targetPrice || 0} onChange={(e)=>updateDocField(p.id, 'targetPrice', parseFloat(e.target.value)||0)} className="bg-transparent font-black text-3xl md:text-6xl outline-none w-full tracking-tighter focus:text-indigo-400 transition-colors"/>
                                        </div>
                                    </div>
                                    <div className="text-left md:text-right w-full md:w-auto shrink-0">
                                        <p className="text-[9px] md:text-[11px] font-bold text-rose-400 uppercase tracking-widest mb-1 italic">Costos</p>
                                        <p className="text-xl md:text-3xl font-mono font-bold text-rose-50">{formatCurrency(mWinner.totalCost)}</p>
                                    </div>
                                </div>
                                <div className="flex flex-col md:flex-row justify-between items-center gap-4 md:gap-0">
                                    <div className="bg-white/5 p-4 md:p-6 rounded-xl md:rounded-[1.8rem] border border-white/5 w-full md:flex-1 shadow-inner text-center md:text-left">
                                        <p className="text-[8px] md:text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1 md:mb-2">Utilidad Estimada</p>
                                        <p className={`text-2xl md:text-5xl font-mono font-bold ${mWinner.profit > 0 ? 'text-emerald-400' : 'text-rose-500'}`}>{formatCurrency(mWinner.profit)}</p>
                                    </div>
                                    <div className="text-center md:text-right md:ml-10">
                                        <p className="text-[8px] md:text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1 md:mb-2 italic">Margen ROI</p>
                                        <p className="text-4xl md:text-7xl font-black italic tracking-tighter leading-none">{mWinner.margin.toFixed(1)}%</p>
                                    </div>
                                </div>
                            </div>
                         ) : (
                            <div className="relative z-10 space-y-6 md:space-y-8">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-10 border-b border-zinc-800 pb-5 md:pb-8">
                                    <div className="text-center md:text-left">
                                        <p className="text-[9px] md:text-[11px] font-black text-zinc-500 uppercase tracking-widest mb-1 md:mb-3">China (x1.03 factor)</p>
                                        <p className="text-xl md:text-3xl font-bold font-mono tracking-tight">{formatCurrency(mImport.costChinaCOP)}</p>
                                    </div>
                                    <div className="text-center md:text-right">
                                        <p className="text-[9px] md:text-[11px] font-black text-zinc-500 uppercase tracking-widest mb-1 md:mb-3">Logística ({mImport.totalCbm.toFixed(2)} CBM)</p>
                                        <p className="text-xl md:text-3xl font-bold font-mono tracking-tight">{formatCurrency(mImport.nationalizationCOP)}</p>
                                    </div>
                                </div>
                                <div className="bg-emerald-500/10 p-5 md:p-10 rounded-xl md:rounded-[3rem] border border-emerald-500/20 flex flex-col md:flex-row justify-between items-center gap-6 md:gap-10 transition-all hover:bg-emerald-500/20">
                                    <div className="flex items-center gap-4 md:gap-8 flex-col md:flex-row text-center md:text-left">
                                        <div className="text-4xl md:text-6xl shrink-0">🇨🇴</div>
                                        <div>
                                            <p className="text-[10px] md:text-[12px] font-black text-emerald-400 uppercase tracking-widest mb-1 md:mb-2">Producto en Colombia</p>
                                            <p className="text-4xl md:text-7xl font-black text-white">{formatCurrency(mImport.unitCostColombia)}</p>
                                        </div>
                                    </div>
                                    <div className="text-center md:text-right w-full md:w-auto">
                                        <p className="text-[8px] md:text-[10px] font-bold text-zinc-500 uppercase mb-1">Total</p>
                                        <p className="text-lg md:text-2xl font-mono opacity-50 italic">{formatCurrency(mImport.totalLandCostCOP)}</p>
                                    </div>
                                </div>
                            </div>
                         )}
                      </div>

                      <div className="flex flex-wrap gap-2 md:gap-3 justify-center md:justify-start">
                        {Object.values(isWinner ? WINNER_STATUS : IMPORT_STATUS).map(s=>(
                          <button key={s.id} onClick={()=>updateDocField(p.id, 'status', s.id)} className={`px-4 md:px-8 py-2 md:py-3.5 rounded-xl text-[9px] md:text-[11px] font-black border-2 uppercase transition-all whitespace-nowrap ${p.status===s.id ? `bg-white ${s.activeColor} border-zinc-900 shadow-xl` : 'bg-white border-zinc-100 text-zinc-400'}`}>
                            {s.emoji} {s.label}
                          </button>
                        ))}
                      </div>

                      {!isWinner && p.status === 'approved' && (
                        <div className="pt-6 md:pt-8 border-t border-zinc-100">
                           <button onClick={()=>setExpandedItems({...expandedItems, [p.id]: !expandedItems[p.id]})} className={`w-full p-4 md:p-8 rounded-xl md:rounded-[2.5rem] border-2 transition-all flex justify-between items-center ${expandedItems[p.id] ? 'bg-zinc-900 border-zinc-900 text-white shadow-xl' : 'bg-zinc-50 border-zinc-200 text-zinc-900'}`}>
                                <div className="flex items-center gap-3 md:gap-5"><span className="text-xl md:text-3xl">📋</span><div className="text-left"><p className="text-[10px] md:text-sm font-black uppercase tracking-widest">Logística y Colores</p></div></div>
                                <svg className={`w-4 md:w-6 h-4 md:h-6 transition-transform ${expandedItems[p.id] ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7" strokeWidth="4"/></svg>
                           </button>
                           {expandedItems[p.id] && (
                                <div className="mt-4 md:mt-8 p-5 md:p-10 bg-zinc-50 rounded-2xl md:rounded-[3rem] border border-zinc-200 grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-10 animate-in fade-in">
                                    <div className="space-y-4 md:space-y-6">
                                        <div className="grid grid-cols-2 gap-4">
                                            <input type="date" value={p.purchaseDate || ''} onChange={(e)=>updateDocField(p.id, 'purchaseDate', e.target.value)} className="w-full p-3 md:p-4 rounded-xl md:rounded-2xl border text-[10px] md:text-sm font-mono"/>
                                            <input type="date" value={p.estimatedArrival || ''} onChange={(e)=>updateDocField(p.id, 'estimatedArrival', e.target.value)} className="w-full p-3 md:p-4 rounded-xl md:rounded-2xl border text-[10px] md:text-sm font-mono"/>
                                        </div>
                                        <input type="number" value={p.advancePayment || 0} onChange={(e)=>updateDocField(p.id, 'advancePayment', parseFloat(e.target.value)||0)} className="w-full p-3 md:p-4 rounded-xl md:rounded-2xl border text-[10px] md:text-sm font-mono font-bold" placeholder="Anticipo..."/>
                                        <input value={p.buyer || ''} onChange={(e)=>updateDocField(p.id, 'buyer', e.target.value)} className="w-full p-3 md:p-4 rounded-xl md:rounded-2xl border text-[10px] md:text-sm font-bold" placeholder="Comprador..."/>
                                    </div>
                                    <div className="bg-white p-4 md:p-8 rounded-2xl md:rounded-[2.5rem] border shadow-sm">
                                        <h4 className="text-[10px] font-black text-zinc-400 uppercase mb-4 border-b pb-2">Distribución</h4>
                                        <div className="space-y-2 overflow-y-auto max-h-[250px] pr-2 no-scrollbar">
                                            {(p.colors || []).map(c => (
                                                <div key={c.id} className="flex gap-2 md:gap-4 items-center bg-zinc-50/50 p-2 md:p-3 rounded-xl border">
                                                    <input value={c.color || ''} onChange={(e)=>{
                                                        const n = p.colors.map(x=>x.id===c.id?{...x, color: e.target.value}:x);
                                                        updateDocField(p.id, 'colors', n);
                                                    }} className="flex-1 text-[10px] md:text-xs font-black bg-transparent outline-none uppercase" placeholder="Color..."/>
                                                    <input type="number" value={c.qty || 0} onChange={(e)=>{
                                                        const n = p.colors.map(x=>x.id===c.id?{...x, qty: parseInt(e.target.value)||0}:x);
                                                        updateDocField(p.id, 'colors', n);
                                                    }} className="w-16 md:w-24 bg-zinc-900 text-white p-1.5 md:p-2 rounded-lg text-center text-[10px] md:text-xs font-mono shadow-sm"/>
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
                           <div className="flex items-center gap-3 md:gap-4"><span className="text-xl md:text-2xl">🍱</span><div className="text-left"><p className="text-[10px] md:text-[11px] font-black uppercase tracking-widest leading-none">Bundles</p><p className="text-[8px] font-bold mt-1 opacity-50">{mWinner.activeUpsells} Activos</p></div></div>
                           <svg className={`w-5 md:w-6 h-5 md:h-6 transition-transform ${expandedItems[`u_${p.id}`] ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7" strokeWidth="4"/></svg>
                        </button>
                        <div className={`transition-all duration-700 ease-in-out overflow-hidden ${expandedItems[`u_${p.id}`] ? 'max-h-[1200px] opacity-100 mt-6 md:mt-8' : 'max-h-0 opacity-0 mt-0'}`}>
                           <div className="space-y-4 md:space-y-5 no-scrollbar">
                               {(p.upsells || INITIAL_WINNER.upsells).map(u=>(
                                   <div key={u.id} className="bg-white p-4 md:p-5 rounded-2xl md:rounded-[2rem] border border-zinc-200 flex gap-4 md:gap-5 relative group border-l-8 border-l-indigo-600 transition-all">
                                       <div className="w-12 h-12 md:w-16 md:h-16 bg-zinc-50 rounded-xl md:rounded-2xl relative shrink-0 flex items-center justify-center border overflow-hidden">
                                           {u.image ? <img src={u.image} className="w-full h-full object-cover" alt="Upsell"/> : <span className="text-lg opacity-20 font-black">+</span>}
                                           <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e)=>handleImage(e, p.id, u.id)}/>
                                       </div>
                                       <div className="flex-1 min-w-0 pr-6 md:pr-8">
                                           <input value={u.name || ''} onChange={(e)=>updateUpsell(p, u.id, 'name', e.target.value)} className="w-full text-[10px] md:text-xs font-black bg-transparent border-b border-zinc-100 focus:border-indigo-600 mb-2 outline-none truncate" placeholder="Nombre..."/>
                                           <div className="flex gap-2">
                                               <input type="number" value={u.cost || ''} onChange={(e)=>updateUpsell(p, u.id, 'cost', parseFloat(e.target.value)||0)} className="w-1/2 bg-zinc-50 text-[9px] p-1.5 rounded-lg font-mono outline-none border border-transparent" placeholder="Costo"/>
                                               <input type="number" value={u.price || ''} onChange={(e)=>updateUpsell(p, u.id, 'price', parseFloat(e.target.value)||0)} className="w-1/2 bg-indigo-50/50 text-[9px] p-1.5 rounded-lg font-black text-indigo-700 outline-none border border-transparent" placeholder="Venta"/>
                                           </div>
                                       </div>
                                       <button onClick={() => resetUpsell(p, u.id)} className="text-zinc-300 opacity-100 md:opacity-0 group-hover:opacity-100 transition-all p-1 hover:text-rose-500 absolute right-2 md:right-3 top-2 md:top-3"><svg className="w-4 md:w-5 h-4 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" strokeWidth="2.5"/></svg></button>
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
        <div className="fixed inset-0 bg-zinc-950/90 backdrop-blur-xl flex items-center justify-center z-[300] p-3 md:p-4">
            <div className="bg-white rounded-2xl md:rounded-[3.5rem] shadow-2xl max-w-5xl w-full max-h-[95vh] overflow-y-auto no-scrollbar animate-in zoom-in-95 duration-300">
                <header className="sticky top-0 bg-white/90 backdrop-blur-md p-6 md:p-8 border-b flex justify-between items-center z-10">
                    <h2 className="text-lg md:text-2xl font-black text-zinc-900 uppercase italic">Registro Cloud</h2>
                    <button onClick={()=>setIsCreating(false)} className="bg-zinc-100 p-2 md:p-3 rounded-full hover:bg-zinc-200">✕</button>
                </header>
                <div className="p-5 md:p-12">
                    {renderCreationForm()}
                    <button onClick={handleSave} className="w-full mt-8 md:mt-12 bg-zinc-900 hover:bg-black text-white font-black py-5 md:py-7 rounded-xl md:rounded-[2rem] text-sm md:text-xl shadow-2xl transition-all uppercase tracking-widest md:tracking-[0.4em] active:scale-[0.98]">Confirmar Registro</button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
}
