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
const appId = typeof __app_id !== 'undefined' ? __app_id : 'winnerproduct-crm';

// --- CONSTANTES DE ESTADO ---
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
  type: 'winner', name: '', dropiCode: '', supplier: '', description: '',
  costs: { base: 0, freight: 0, fulfillment: 0, commission: 0, cpa: 0, returns: 0, fixed: 0 },
  targetPrice: 0, status: 'pending', image: null, order: 0, isWorking: false,
  upsells: Array(5).fill(0).map((_, i) => ({ id: i + 1, name: '', cost: 0, price: 0, image: null }))
});

const getInitialImport = () => ({
  type: 'import', name: '', chineseSupplier: '', dollarRate: 0, prodCostUSD: 0, cbmCostCOP: 0,
  unitsQty: 0, ctnQty: 0, yiwuFreightUSD: 0, status: 'pending', image: null, order: 0,
  isWorking: false, measures: { width: 0, height: 0, length: 0 },
  colors: Array(7).fill(0).map((_, i) => ({ id: i + 1, color: '', qty: 0 }))
});

const getInitialProjection = () => ({
  name: '', price: '', productCost: '', freight: '', fulfillment: '', commission: '',
  adSpend: '', cpm: '', ctr: '', loadSpeed: '', conversionRate: '',
  effectiveness: '', returnRate: '', fixedExpenses: '', activeCampaigns: 1
});

const getInitialSalesConfig = () => ({
  vendedora: '', productName: '', targetProfit: '', productCost: '', freight: '', 
  commission: '', returnRate: '', effectiveness: '', fulfillment: '', fixedCosts: '', 
  fixedAdSpend: false, dailyAdSpend: ''
});

const getInitialSaleRecord = () => ({
  date: new Date().toISOString().split('T')[0], configId: '', orders: '', units: '', revenue: '', adSpend: ''
});

// --- AYUDANTES ---
const formatCurrency = (val) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(val || 0);

// --- COMPONENTES INPUT/OUTPUT (Aislados para evitar pérdida de foco) ---
const InputP = ({ label, value, onChange, type="number", prefix="", suffix="", disabled=false }) => {
  let displayVal = value;
  if (type === 'currency') displayVal = value ? new Intl.NumberFormat('es-CO').format(value) : '';
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
        <input type={type === 'currency' ? 'text' : type} value={displayVal} onChange={handleInput} disabled={disabled} className="w-full bg-transparent text-sm md:text-base font-bold text-emerald-950 outline-none font-mono placeholder:text-emerald-300" placeholder="0" />
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
    <div className={`p-3 md:p-4 rounded-xl md:rounded-2xl border text-left flex flex-col justify-center ${baseBg}`}>
      <label className={`text-[8px] md:text-[10px] font-black uppercase block mb-1 md:mb-2 ${labelText}`}>{label}</label>
      <div className={`font-mono text-sm md:text-lg font-black truncate ${baseText}`}>{displayValue}</div>
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
    try { await signInWithEmailAndPassword(auth, email, password); } 
    catch (err) { setError('Credenciales inválidas.'); setErrorExt('Error de acceso.'); } 
    finally { setLoading(false); }
  };
  return (
    <div className="min-h-screen bg-[#f1f5f9] flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-[2.5rem] shadow-2xl p-8 md:p-12 border border-zinc-200/50 text-center animate-in zoom-in-95 duration-300">
        <div className="w-20 h-20 bg-zinc-900 rounded-[1.5rem] flex items-center justify-center text-white text-4xl shadow-xl italic font-black mx-auto mb-6">W</div>
        <h1 className="text-3xl font-black tracking-tighter uppercase italic text-zinc-900 leading-none">Winner OS</h1>
        <p className="text-zinc-400 text-[10px] font-bold mt-2 tracking-widest uppercase mb-10">Cloud Management System</p>
        <form onSubmit={handleLogin} className="space-y-6 text-left">
          <div><label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block mb-2 px-1">Correo Electrónico</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full bg-zinc-50 border-2 border-zinc-100 rounded-2xl p-4 text-base focus:outline-none focus:border-zinc-900 transition-all text-zinc-700 outline-none" placeholder="admin@winneros.com"/></div>
          <div><label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block mb-2 px-1">Contraseña</label>
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full bg-zinc-50 border-2 border-zinc-100 rounded-2xl p-4 text-base focus:outline-none focus:border-zinc-900 transition-all text-zinc-700 outline-none" placeholder="••••••••"/></div>
          {error && <div className="bg-rose-50 border border-rose-100 p-4 rounded-2xl text-rose-600 text-[11px] font-bold uppercase text-center leading-tight">⚠️ {error}</div>}
          <button type="submit" disabled={loading} className="w-full bg-zinc-900 hover:bg-black text-white font-black py-5 rounded-2xl text-xs shadow-2xl transition-all uppercase tracking-[0.2em] active:scale-[0.98] disabled:opacity-50">{loading ? 'Validando...' : 'Entrar al Sistema'}</button>
        </form>
      </div>
    </div>
  );
}

// --- COMPONENTE PRINCIPAL ---
export default function App() {
  const [activeModule, setActiveModule] = useState('winners');
  const [user, setUser] = useState(null);
  
  // Datos Generales
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('pending');
  const [isCreating, setIsCreating] = useState(false);
  const [newProduct, setNewProduct] = useState(getInitialWinner());
  const [expandedItems, setExpandedItems] = useState({});
  const [notification, setNotification] = useState('');
  const [formError, setFormError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortOrder, setSortOrder] = useState('manual');
  const [supplierFilter, setSupplierFilter] = useState('all');

  // Módulo Rendimiento
  const [proj, setProj] = useState(getInitialProjection());
  const [salesConfigs, setSalesConfigs] = useState([]);
  const [salesMonths, setSalesMonths] = useState([]);
  const [salesTab, setSalesTab] = useState('dashboard');
  const [isCreatingSalesConfig, setIsCreatingSalesConfig] = useState(false);
  const [newSalesConfig, setNewSalesConfig] = useState(getInitialSalesConfig());
  const [newSaleRecord, setNewSaleRecord] = useState(getInitialSaleRecord());
  const [salesFilter, setSalesFilter] = useState({
     startDate: new Date(new Date().setDate(1)).toISOString().split('T')[0],
     endDate: new Date().toISOString().split('T')[0]
  });
  const [vendedoraFilter, setVendedoraFilter] = useState('all');
  const [productoFilter, setProductoFilter] = useState('all');

  // 1. Escuchar Auth
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => { setUser(currentUser); setLoading(false); });
    return () => unsubscribe();
  }, []);

  // 2. Escuchar Firestore (Enrutamiento Dinámico)
  useEffect(() => {
    if (!user) return;
    if (activeModule === 'winners' || activeModule === 'imports') {
      const colName = activeModule === 'winners' ? 'products' : 'import_products';
      return onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', colName), (snap) => {
        setProducts(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      });
    }
    if (activeModule === 'sales') {
      const u1 = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'sales_configs'), (snap) => setSalesConfigs(snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))));
      const u2 = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'sales_months'), (snap) => setSalesMonths(snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))));
      return () => { u1(); u2(); };
    }
  }, [user, activeModule]);

  // --- LÓGICA MÓDULOS WINNER E IMPORT ---
  const displayedProducts = useMemo(() => {
    if (activeModule === 'projection' || activeModule === 'sales') return [];
    let res = products.filter(p => p.status === activeTab && (p.name?.toLowerCase().includes(searchTerm.toLowerCase()) || p.dropiCode?.toLowerCase().includes(searchTerm.toLowerCase())) && (supplierFilter === 'all' || p[activeModule === 'winners' ? 'supplier' : 'chineseSupplier'] === supplierFilter));
    return [...res].sort((a, b) => (a.isWorking && !b.isWorking ? -1 : !a.isWorking && b.isWorking ? 1 : sortOrder === 'manual' ? (a.order || 0) - (b.order || 0) : 0));
  }, [products, activeTab, searchTerm, supplierFilter, sortOrder, activeModule]);

  const updateDocField = async (id, f, v) => { try { await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', activeModule === 'winners' ? 'products' : 'import_products', id), { [f]: v }); } catch (e) {} };
  const updateNestedField = async (id, parent, f, v) => { const item = products.find(x => x.id === id); if (item) try { await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', activeModule === 'winners' ? 'products' : 'import_products', id), { [parent]: { ...item[parent], [f]: v } }); } catch (e) {} };
  const deleteItem = async (id) => { if (window.confirm('¿Borrar registro?')) try { await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', activeModule === 'winners' ? 'products' : 'import_products', id)); } catch (e) {} };
  
  const handleSave = async () => {
    if (!newProduct.name) return setFormError('⚠️ ERROR: Faltan campos.');
    setIsSaving(true);
    const colName = activeModule === 'winners' ? 'products' : 'import_products';
    const regPrefix = activeModule === 'winners' ? 'WIN' : 'IMP';
    const regNumber = `${regPrefix}-${(products.length + 1).toString().padStart(3, '0')}`;
    try {
      const cleanPayload = JSON.parse(JSON.stringify({...newProduct, regNumber, order: Date.now(), createdAt: Date.now()}));
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', colName), cleanPayload);
      setIsCreating(false); setNotification('Registro guardado! ✨');
    } catch (e) { setFormError(e.message); } finally { setIsSaving(false); setTimeout(() => setNotification(''), 3000); }
  };

  const handleImage = (e, targetId = null, upsellId = null) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onloadend = async () => {
      let res = reader.result;
      if (file.size > 500 * 1024) { const img = new Image(); img.src = res; await new Promise(r => img.onload = r); const cv = document.createElement('canvas'); cv.width = 800; cv.height = 800; cv.getContext('2d').drawImage(img,0,0,800,800); res = cv.toDataURL('image/jpeg', 0.7); }
      if (!targetId) { if (upsellId) setNewProduct({...newProduct, upsells: newProduct.upsells.map(u => u.id === upsellId ? {...u, image: res} : u)}); else setNewProduct({...newProduct, image: res}); }
      else { const it = products.find(x => x.id === targetId); if (upsellId) updateDoc(doc(db, 'artifacts', appId, 'public', 'data', activeModule === 'winners' ? 'products' : 'import_products', targetId), { upsells: it.upsells.map(u => u.id === upsellId ? {...u, image: res} : u) }); else updateDoc(doc(db, 'artifacts', appId, 'public', 'data', activeModule === 'winners' ? 'products' : 'import_products', targetId), { image: res }); }
    }; reader.readAsDataURL(file);
  };

  // --- LÓGICA ERP RENDIMIENTO (VENTAS) ---
  const groupedSalesConfigs = useMemo(() => salesConfigs.reduce((acc, c) => { if (!acc[c.vendedora]) acc[c.vendedora] = []; acc[c.vendedora].push(c); return acc; }, {}), [salesConfigs]);
  const allSalesRecords = useMemo(() => salesMonths.flatMap(m => m.records || []), [salesMonths]);
  
  const dashboardData = useMemo(() => {
    const filtered = allSalesRecords.filter(r => {
      const d = new Date(r.date); const start = new Date(salesFilter.startDate); const end = new Date(salesFilter.endDate); end.setHours(23,59,59);
      const conf = salesConfigs.find(c => c.id === r.configId);
      return d >= start && d <= end && conf && (vendedoraFilter === 'all' || conf.vendedora === vendedoraFilter) && (productoFilter === 'all' || r.configId === productoFilter);
    });
    let tGrossRev = 0, tAd = 0, tOrd = 0, tUni = 0, tProdCost = 0, tLog = 0, tComm = 0, tFixed = 0, tEffDeliveries = 0, tRealRev = 0;
    filtered.forEach(r => {
      const c = salesConfigs.find(conf => conf.id === r.configId); if (!c) return;
      const rev = parseFloat(r.revenue)||0, ad = parseFloat(r.adSpend)||0, ord = parseFloat(r.orders)||0, uni = parseFloat(r.units)||0;
      // ÍNDICE EFECTIVO REAL SEGÚN TU FÓRMULA (Efectividad - Devolución)
      const effIndex = (parseFloat(c.effectiveness)||0 - parseFloat(c.returnRate)||0) / 100;
      const realRev = rev * effIndex, effOrd = ord * effIndex, effUni = uni * effIndex;
      tRealRev += realRev; tGrossRev += rev; tAd += ad; tOrd += ord; tUni += uni; tEffDeliveries += effOrd;
      tProdCost += (effUni * (parseFloat(c.productCost)||0));
      // Logística: Cobramos flete e ida de todos los pedidos despachados (brutos)
      tLog += (ord * ((parseFloat(c.freight)||0) + (parseFloat(c.fulfillment)||0)));
      tComm += (effOrd * (parseFloat(c.commission)||0));
      tFixed += (effOrd * (parseFloat(c.fixedCosts)||0));
    });
    const tCosts = tProdCost + tLog + tComm + tFixed;
    const netProfit = tRealRev - tCosts - tAd;
    const activeDays = new Set(filtered.map(r => r.date)).size || 1;
    return { tGrossRev, tRealRev, tAd, tOrd, tUni, tCosts, netProfit, roas: tAd > 0 ? tRealRev / tAd : 0, cpaReal: tEffDeliveries > 0 ? tAd / tEffDeliveries : 0, margin: tRealRev > 0 ? (netProfit / tRealRev) * 100 : 0, projMonthly: (tRealRev / activeDays) * 30, tEffDeliveries };
  }, [allSalesRecords, salesFilter, vendedoraFilter, productoFilter, salesConfigs]);

  const handleRecordConfigSelect = (configId) => {
    const conf = salesConfigs.find(c => c.id === configId);
    setNewSaleRecord({...newSaleRecord, configId, adSpend: conf?.fixedAdSpend ? (parseFloat(conf.dailyAdSpend)||0) : ''});
  };

  const handleSaveSalesConfig = async () => {
    if (!newSalesConfig.vendedora || !newSalesConfig.productName) return setFormError('⚠️ Faltan campos');
    setIsSaving(true);
    try {
      if (newSalesConfig.id) await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'sales_configs', newSalesConfig.id), JSON.parse(JSON.stringify(newSalesConfig)));
      else await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'sales_configs'), JSON.parse(JSON.stringify({...newSalesConfig, createdAt: Date.now()})));
      setIsCreatingSalesConfig(false); setNewSalesConfig(getInitialSalesConfig()); setNotification('Configuración guardada!');
    } catch (e) { setFormError(e.message); } finally { setIsSaving(false); setTimeout(() => setNotification(''), 3000); }
  };

  const deleteSalesConfig = async (id) => { if (window.confirm('¿Borrar producto/vendedora?')) await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'sales_configs', id)); };

  const handleSaveSaleRecord = async () => {
    if (!newSaleRecord.configId) return setFormError('⚠️ Selecciona configuración.');
    setIsSaving(true);
    try {
      const mid = newSaleRecord.date.substring(0, 7); const ref = doc(db, 'artifacts', appId, 'public', 'data', 'sales_months', mid);
      const rec = { ...newSaleRecord, id: Date.now().toString() };
      const exist = salesMonths.find(m => m.id === mid);
      if (exist) await updateDoc(ref, { records: [...exist.records, rec] }); else await setDoc(ref, { records: [rec] });
      setNewSaleRecord(getInitialSaleRecord()); setNotification('Cierre diario guardado!');
    } catch (e) { setFormError(e.message); } finally { setIsSaving(false); setTimeout(() => setNotification(''), 3000); }
  };

  const deleteSaleRecord = async (date, recordId) => {
    const mid = date.substring(0, 7); const exist = salesMonths.find(m => m.id === mid);
    if(exist && window.confirm('¿Eliminar?')) await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'sales_months', mid), { records: exist.records.filter(r => r.id !== recordId) });
  };

  // --- RENDERIZADORES DE MÓDULOS ---

  const renderProjectionModule = () => {
    const val = (k) => parseFloat(proj[k]) || 0;
    const handleChange = (k) => (v) => setProj({...proj, [k]: v});
    const impressions = val('cpm') > 0 ? (val('adSpend') / val('cpm')) * 1000 : 0;
    const linkClicks = impressions * (val('ctr') / 100);
    const pageVisits = linkClicks * (val('loadSpeed') / 100);
    const salesCol1 = pageVisits * (val('conversionRate') / 100);
    const realRevenue = (salesCol1 * (val('effectiveness')/100 - val('returnRate')/100)) * val('price');
    const totalCosts = (val('productCost') * (salesCol1 * (val('effectiveness')/100 - val('returnRate')/100))) + (val('freight') * salesCol1) + (val('fulfillment') * salesCol1) + (val('commission') * (salesCol1 * (val('effectiveness')/100 - val('returnRate')/100)));
    const grossProfit = realRevenue - totalCosts - val('adSpend');
    return (
      <div className="space-y-6 md:space-y-10 pb-20 animate-in fade-in text-left">
        <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-white rounded-[2rem] p-5 shadow-sm border">
            <div className="w-full md:flex-1"><label className="text-[11px] font-black text-zinc-400 uppercase tracking-widest block mb-2 px-1">Análisis Proyección Producto</label>
            <input type="text" value={proj.name} onChange={(e)=>setProj({...proj, name: e.target.value})} className="w-full bg-zinc-50 border-2 rounded-xl p-3 text-sm font-bold focus:border-emerald-400 outline-none" placeholder="Nombre..." /></div>
            <button onClick={()=>setProj(getInitialProjection())} className="bg-rose-50 text-rose-600 px-6 py-3 rounded-xl font-black text-xs uppercase border border-rose-100 shrink-0">Limpiar Todo</button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white rounded-[2rem] p-5 shadow-sm border space-y-4">
            <h2 className="text-lg font-black uppercase italic mb-2 border-b pb-3 text-zinc-900">Configuración Costos</h2>
            <div className="grid grid-cols-2 gap-3">
              <InputP label="Precio Venta" value={proj.price} onChange={handleChange('price')} type="currency" prefix="$" />
              <InputP label="Costo Producto" value={proj.productCost} onChange={handleChange('productCost')} type="currency" prefix="$" />
              <InputP label="Flete" value={proj.freight} onChange={handleChange('freight')} type="currency" prefix="$" />
              <InputP label="Fulfillment" value={proj.fulfillment} onChange={handleChange('fulfillment')} type="currency" prefix="$" />
              <InputP label="Comisión" value={proj.commission} onChange={handleChange('commission')} type="currency" prefix="$" />
            </div>
          </div>
          <div className="bg-white rounded-[2rem] p-5 shadow-sm border space-y-4">
            <h2 className="text-lg font-black uppercase italic mb-2 border-b pb-3 text-zinc-900">Métricas Meta Ads</h2>
            <div className="grid grid-cols-2 gap-3">
              <InputP label="Inversión" value={proj.adSpend} onChange={handleChange('adSpend')} type="currency" prefix="$" />
              <InputP label="CPM" value={proj.cpm} onChange={handleChange('cpm')} type="currency" prefix="$" />
              <InputP label="CTR" value={proj.ctr} onChange={handleChange('ctr')} suffix="%" />
              <InputP label="Conversión" value={proj.conversionRate} onChange={handleChange('conversionRate')} suffix="%" />
              <InputP label="Efectividad" value={proj.effectiveness} onChange={handleChange('effectiveness')} suffix="%" />
              <InputP label="Devolución" value={proj.returnRate} onChange={handleChange('returnRate')} suffix="%" />
            </div>
          </div>
        </div>
        <div className="bg-zinc-900 rounded-[2.5rem] p-8 md:p-12 text-white shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-[100px]"></div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative z-10">
            <div><p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2 leading-none">Ganancia Bruta Estimada</p><p className={`text-4xl md:text-6xl font-black font-mono tracking-tighter ${grossProfit < 0 ? 'text-rose-500' : 'text-emerald-400'}`}>{formatCurrency(grossProfit)}</p></div>
            <div><p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2 leading-none">ROAS Real ⭐</p><p className="text-3xl md:text-5xl font-black italic">{roasReal.toFixed(2)}</p></div>
            <div><p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2 leading-none">CPA Real</p><p className="text-3xl md:text-5xl font-black italic text-indigo-400">{formatCurrency(val('adSpend') / (salesCol1 * (val('effectiveness')/100 - val('returnRate')/100)) || 0)}</p></div>
          </div>
        </div>
      </div>
    );
  };

  const renderSalesModule = () => (
    <div className="space-y-6 md:space-y-8 pb-20 text-left animate-in fade-in">
        <div className="bg-white p-2 rounded-2xl shadow-sm border border-zinc-200 inline-flex overflow-x-auto max-w-full no-scrollbar">
            <button onClick={()=>setSalesTab('dashboard')} className={`px-6 py-3 rounded-xl text-[10px] md:text-xs font-black uppercase tracking-widest transition-all ${salesTab === 'dashboard' ? 'bg-emerald-600 text-white shadow-md' : 'text-zinc-500 hover:bg-zinc-50'}`}>📊 Dashboard</button>
            <button onClick={()=>setSalesTab('records')} className={`px-6 py-3 rounded-xl text-[10px] md:text-xs font-black uppercase tracking-widest transition-all ${salesTab === 'records' ? 'bg-emerald-600 text-white shadow-md' : 'text-zinc-500 hover:bg-zinc-50'}`}>📝 Cierre Diario</button>
            <button onClick={()=>setSalesTab('config')} className={`px-6 py-3 rounded-xl text-[10px] md:text-xs font-black uppercase tracking-widest transition-all ${salesTab === 'config' ? 'bg-emerald-600 text-white shadow-md' : 'text-zinc-500 hover:bg-zinc-50'}`}>⚙️ Configuración</button>
        </div>

        {salesTab === 'dashboard' && (
           <div className="space-y-6">
              <div className="bg-white rounded-[2rem] p-5 border shadow-sm grid grid-cols-1 lg:grid-cols-4 gap-4 items-end">
                <div><label className="text-[9px] font-black text-zinc-400 uppercase mb-1 block px-1">Desde</label>
                <input type="date" value={salesFilter.startDate} onChange={e=>setSalesFilter({...salesFilter, startDate: e.target.value})} className="w-full p-3 rounded-xl border text-sm font-bold focus:border-emerald-400 outline-none" /></div>
                <div><label className="text-[9px] font-black text-zinc-400 uppercase mb-1 block px-1">Hasta</label>
                <input type="date" value={salesFilter.endDate} onChange={e=>setSalesFilter({...salesFilter, endDate: e.target.value})} className="w-full p-3 rounded-xl border text-sm font-bold focus:border-emerald-400 outline-none" /></div>
                <div><label className="text-[9px] font-black text-zinc-400 uppercase mb-1 block px-1">Vendedora</label>
                <select value={vendedoraFilter} onChange={e=>{setVendedoraFilter(e.target.value); setProductoFilter('all');}} className="w-full p-3 rounded-xl border text-sm font-bold focus:border-emerald-400 outline-none">
                  <option value="all">TODAS</option>
                  {Object.keys(groupedSalesConfigs).map(v => <option key={v} value={v}>{v.toUpperCase()}</option>)}
                </select></div>
                <div><label className="text-[9px] font-black text-zinc-400 uppercase mb-1 block px-1">Producto</label>
                <select value={productoFilter} onChange={e=>setProductoFilter(e.target.value)} disabled={vendedoraFilter==='all'} className="w-full p-3 rounded-xl border text-sm font-bold focus:border-emerald-400 outline-none disabled:opacity-30">
                  <option value="all">TODOS</option>
                  {vendedoraFilter!=='all' && groupedSalesConfigs[vendedoraFilter]?.map(c => <option key={c.id} value={c.id}>{c.productName.toUpperCase()}</option>)}
                </select></div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                 <div className="bg-white p-5 rounded-[2rem] border shadow-sm"><p className="text-[10px] font-black text-zinc-400 uppercase mb-1">Facturación Real</p><p className="text-xl md:text-3xl font-black font-mono text-zinc-900">{formatCurrency(dashboardData.tRealRev)}</p></div>
                 <div className="bg-white p-5 rounded-[2rem] border shadow-sm"><p className="text-[10px] font-black text-zinc-400 uppercase mb-1">Inversión Meta</p><p className="text-xl md:text-3xl font-black font-mono text-zinc-900">{formatCurrency(dashboardData.tAd)}</p></div>
                 <div className="bg-emerald-600 p-5 rounded-[2rem] shadow-xl text-white"><p className="text-[10px] font-black text-emerald-200 uppercase mb-1">ROAS Global</p><p className="text-3xl md:text-5xl font-black italic">{dashboardData.roas.toFixed(2)}</p></div>
                 <div className={`p-5 rounded-[2rem] shadow-xl text-white ${dashboardData.netProfit < 0 ? 'bg-rose-600' : 'bg-zinc-900'}`}><p className="text-[10px] font-black uppercase mb-1 opacity-80">Profit Neto</p><p className="text-xl md:text-3xl font-black font-mono">{formatCurrency(dashboardData.netProfit)}</p></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white rounded-3xl p-6 border shadow-sm space-y-4">
                  <h3 className="text-[11px] font-black uppercase tracking-widest border-b pb-2">📦 Rendimiento</h3>
                  <OutputP label="Facturación Bruta" value={dashboardData.tGrossRev} customBg="bg-zinc-50" />
                  <OutputP label="Pedidos Brutos" value={dashboardData.tOrd} type="number" decimals={0} customBg="bg-zinc-50" />
                  <OutputP label="Entregas Efectivas (Neto)" value={dashboardData.tEffDeliveries} type="number" decimals={1} customBg="bg-emerald-50" customText="text-emerald-900" />
                  <OutputP label="CPA Real Promedio" value={dashboardData.cpaReal} highlight />
                </div>
                <div className="bg-white rounded-3xl p-6 border shadow-sm space-y-4">
                  <h3 className="text-[11px] font-black text-rose-500 uppercase tracking-widest border-b pb-2">💳 Costos Totales</h3>
                  <OutputP label="Costo Producto (Real)" value={dashboardData.tProdCost} customBg="bg-rose-50" customText="text-rose-900" />
                  <OutputP label="Fletes de Ida (Bruto)" value={dashboardData.tLog} customBg="bg-rose-50" customText="text-rose-900" />
                  <OutputP label="Comisiones Pagadas" value={dashboardData.tComm} customBg="bg-rose-50" customText="text-rose-900" />
                  <OutputP label="Total Costos Operativos" value={dashboardData.tCosts} highlight />
                </div>
                <div className="bg-zinc-900 rounded-3xl p-6 shadow-2xl space-y-4 text-white">
                  <h3 className="text-[11px] font-black text-zinc-400 uppercase tracking-widest border-b border-zinc-800 pb-2">🚀 Proyección de Cierre</h3>
                  <p className="text-[10px] font-bold text-zinc-500 uppercase">Proyección Mensual (Ingresos)</p>
                  <p className="text-2xl font-mono font-black mb-4 text-emerald-400">{formatCurrency(dashboardData.projMonthly)}</p>
                  <p className="text-[10px] font-bold text-zinc-500 uppercase">Margen Neto Operativo</p>
                  <p className={`text-4xl font-black italic ${dashboardData.margin > 0 ? 'text-emerald-400' : 'text-rose-500'}`}>{dashboardData.margin.toFixed(2)}%</p>
                </div>
              </div>
           </div>
        )}

        {salesTab === 'records' && (
           <div className="space-y-6">
              <div className="bg-zinc-900 rounded-[2rem] p-6 shadow-2xl border border-zinc-800 text-white grid grid-cols-1 md:grid-cols-6 gap-4">
                  <div className="md:col-span-1"><label className="text-[9px] font-black text-emerald-400 uppercase mb-1 block px-1">Fecha</label><input type="date" value={newSaleRecord.date} onChange={e=>setNewSaleRecord({...newSaleRecord, date: e.target.value})} className="w-full bg-white/10 border border-white/20 rounded-xl p-3 text-sm focus:border-emerald-400 outline-none" /></div>
                  <div className="md:col-span-2"><label className="text-[9px] font-black text-emerald-400 uppercase mb-1 block px-1">Vendedora / Producto</label>
                  <select value={newSaleRecord.configId} onChange={e=>handleRecordConfigSelect(e.target.value)} className="w-full bg-white/10 border border-white/20 rounded-xl p-3 text-[11px] md:text-sm font-bold focus:border-emerald-400 outline-none [&>optgroup]:text-zinc-900 [&>option]:text-zinc-900">
                      <option value="" disabled>SELECCIONAR...</option>
                      {Object.entries(groupedSalesConfigs).map(([v, ps]) => <optgroup key={v} label={v.toUpperCase()}>{ps.map(c => <option key={c.id} value={c.id}>{c.productName}</option>)}</optgroup>)}
                  </select></div>
                  <div><label className="text-[9px] font-black text-emerald-400 uppercase mb-1 block px-1">Inv. FB</label><input type="number" value={newSaleRecord.adSpend} onChange={e=>setNewSaleRecord({...newSaleRecord, adSpend: e.target.value})} disabled={salesConfigs.find(c=>c.id===newSaleRecord.configId)?.fixedAdSpend} className="w-full bg-white/10 border border-white/20 rounded-xl p-3 text-sm font-mono focus:border-emerald-400 outline-none disabled:opacity-30" placeholder="0" /></div>
                  <div><label className="text-[9px] font-black text-emerald-400 uppercase mb-1 block px-1">Pedidos Desp.</label><input type="number" value={newSaleRecord.orders} onChange={e=>setNewSaleRecord({...newSaleRecord, orders: e.target.value})} className="w-full bg-white/10 border border-white/20 rounded-xl p-3 text-sm font-mono focus:border-emerald-400 outline-none" placeholder="0" /></div>
                  <div><label className="text-[9px] font-black text-emerald-400 uppercase mb-1 block px-1">Unidades Tot.</label><input type="number" value={newSaleRecord.units} onChange={e=>setNewSaleRecord({...newSaleRecord, units: e.target.value})} className="w-full bg-white/10 border border-white/20 rounded-xl p-3 text-sm font-mono focus:border-emerald-400 outline-none" placeholder="0" /></div>
                  <div className="md:col-span-2 md:col-start-4"><label className="text-[9px] font-black text-emerald-400 uppercase mb-1 block px-1">Facturación Bruta (día)</label>
                  <div className="flex items-center gap-2 bg-white/10 border border-white/20 rounded-xl px-3 focus-within:border-emerald-400 transition-colors"><span className="font-bold text-emerald-400">$</span><input type="text" value={newSaleRecord.revenue ? new Intl.NumberFormat('es-CO').format(newSaleRecord.revenue) : ''} onChange={e=>{const v = e.target.value.replace(/\D/g,''); setNewSaleRecord({...newSaleRecord, revenue: v!==''?parseFloat(v):''});}} className="w-full bg-transparent p-3 pl-0 text-sm font-mono font-bold outline-none" placeholder="0" /></div></div>
                  <div className="md:col-span-1 md:col-start-6 flex items-end"><button onClick={handleSaveSaleRecord} disabled={isSaving} className="w-full bg-emerald-500 text-white font-black py-4 rounded-xl text-[10px] uppercase shadow-xl active:scale-95 transition-all">Guardar Cierre</button></div>
              </div>
              <div className="bg-white rounded-3xl border shadow-sm overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-left border-collapse"><thead><tr className="bg-zinc-50 text-[9px] uppercase tracking-widest text-zinc-400 border-b"><th className="p-4">Fecha</th><th className="p-4">Vendedora / Prod</th><th className="p-4">FB</th><th className="p-4">Pedidos</th><th className="p-4">Unds</th><th className="p-4">Fact. Bruta</th><th className="p-4 text-center">Acción</th></tr></thead><tbody>{allSalesRecords.slice(0, 50).sort((a,b)=>new Date(b.date)-new Date(a.date)).map(r => { const c = salesConfigs.find(conf=>conf.id===r.configId); return <tr key={r.id} className="border-b last:border-0 hover:bg-zinc-50 text-[11px] md:text-sm font-bold text-zinc-700"><td className="p-4 font-mono">{r.date}</td><td className="p-4">{c ? `${c.vendedora} - ${c.productName}` : 'Desc.'}</td><td className="p-4 font-mono">{formatCurrency(r.adSpend)}</td><td className="p-4 font-mono text-zinc-500">{r.orders}</td><td className="p-4 font-mono text-indigo-600">{r.units}</td><td className="p-4 font-mono text-zinc-900">{formatCurrency(r.revenue)}</td><td className="p-4 text-center"><button onClick={()=>deleteSaleRecord(r.date, r.id)} className="text-zinc-300 hover:text-rose-500 transition-colors p-1"><svg className="w-4 h-4 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button></td></tr>; })}</tbody></table></div></div>
           </div>
        )}

        {salesTab === 'config' && (
           <div className="space-y-8">
              <div className="flex justify-between items-center"><h2 className="text-lg md:text-2xl font-black text-zinc-900 uppercase italic">Gestión de Equipos</h2>
              <button onClick={() => {setIsCreatingSalesConfig(true); setFormError(''); setNewSalesConfig(getInitialSalesConfig());}} className="bg-zinc-900 text-white px-6 py-3 rounded-xl text-[10px] md:text-xs font-black uppercase tracking-widest shadow-xl active:scale-95 transition-all">➕ Añadir Vendedora/Prod.</button></div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                 {Object.entries(groupedSalesConfigs).map(([v, ps]) => (
                    <div key={v} className="bg-white rounded-3xl border shadow-sm overflow-hidden"><div className="bg-zinc-900 text-white p-5 flex justify-between items-center"><h3 className="font-black text-lg md:text-xl uppercase tracking-widest truncate mr-4">{v}</h3><button onClick={()=>{setNewSalesConfig({...getInitialSalesConfig(), vendedora: v}); setIsCreatingSalesConfig(true);}} className="text-[9px] font-black bg-white text-zinc-900 px-4 py-2 rounded-xl hover:bg-zinc-200 transition-colors shadow-md">➕ Producto</button></div><div className="p-0">{ps.map(c => (
                      <div key={c.id} className="border-b last:border-0 p-5 hover:bg-zinc-50 transition-colors"><div className="flex justify-between items-start mb-4"><h4 className="font-black text-emerald-600 uppercase text-sm">{c.productName}</h4><div className="flex gap-2"><button onClick={()=>{setNewSalesConfig(c); setIsCreatingSalesConfig(true);}} className="text-[9px] font-black text-zinc-500 hover:text-emerald-600 border border-zinc-200 rounded-lg px-2 py-1">✏️</button><button onClick={()=>deleteSalesConfig(c.id)} className="text-[9px] font-black text-rose-500 hover:bg-rose-50 border border-rose-100 rounded-lg px-2 py-1">🗑️</button></div></div><div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-[10px] font-bold text-zinc-600"><div><span className="block text-[8px] text-zinc-400 uppercase">Costo Prod</span>{formatCurrency(c.productCost)}</div><div><span className="block text-[8px] text-zinc-400 uppercase">Flete Base</span>{formatCurrency(c.freight)}</div><div><span className="block text-[8px] text-zinc-400 uppercase">Efectiv.</span><span className="text-emerald-600">{c.effectiveness}%</span></div><div><span className="block text-[8px] text-zinc-400 uppercase">Devolu.</span><span className="text-rose-500">{c.returnRate}%</span></div></div></div>
                    ))}</div></div>
                 ))}
                 {Object.keys(groupedSalesConfigs).length === 0 && <div className="col-span-full py-20 text-center text-zinc-400 font-bold uppercase tracking-widest text-sm">No hay Vendedoras registradas.</div>}
              </div>
           </div>
        )}

        {isCreatingSalesConfig && (
            <div className="fixed inset-0 bg-zinc-950/90 backdrop-blur-xl flex items-center justify-center z-[300] p-3 animate-in fade-in duration-300">
                <div className="bg-white rounded-[3rem] shadow-2xl max-w-4xl w-full max-h-[95vh] overflow-y-auto no-scrollbar animate-in zoom-in-95 duration-300">
                    <header className="sticky top-0 bg-white/90 backdrop-blur-md p-6 border-b flex justify-between items-center z-10"><h2 className="text-sm md:text-2xl font-black text-zinc-900 uppercase italic">Ajustes Producto & Vendedora</h2><button onClick={()=>{setIsCreatingSalesConfig(false); setFormError('');}} className="bg-zinc-100 p-2 rounded-full hover:bg-zinc-200 shadow-sm text-zinc-600">✕</button></header>
                    <div className="p-10 space-y-6"><div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-b border-zinc-100 pb-6">
                    <div><label className="text-[9px] font-black text-zinc-400 uppercase px-1 block mb-1">Nombre Vendedora</label><input type="text" value={newSalesConfig.vendedora} onChange={e=>handleConfInput('vendedora')(e.target.value)} className="w-full border-2 border-zinc-200 rounded-xl p-3 text-sm font-bold text-zinc-800 outline-none focus:border-emerald-400" /></div>
                    <div><label className="text-[9px] font-black text-zinc-400 uppercase px-1 block mb-1">Nombre Producto</label><input type="text" value={newSalesConfig.productName} onChange={e=>handleConfInput('productName')(e.target.value)} className="w-full border-2 border-zinc-200 rounded-xl p-3 text-sm font-bold text-zinc-800 outline-none focus:border-emerald-400" /></div></div>
                    <div className="bg-emerald-50/50 p-5 rounded-2xl border border-emerald-100"><div className="flex items-center justify-between mb-4"><div><h4 className="text-[11px] font-black text-emerald-900 uppercase tracking-widest">Inversión Facebook Fija</h4><p className="text-[9px] font-bold text-emerald-600 mt-1">Activa para usar el mismo ppto. diario automáticamente.</p></div><button onClick={()=>handleConfInput('fixedAdSpend')(!newSalesConfig.fixedAdSpend)} className={`w-12 h-6 rounded-full relative transition-colors ${newSalesConfig.fixedAdSpend ? 'bg-emerald-600' : 'bg-zinc-300'}`}><div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${newSalesConfig.fixedAdSpend ? 'left-7' : 'left-1'}`} /></button></div>{newSalesConfig.fixedAdSpend && <InputP label="Presupuesto Diario Fijo" value={newSalesConfig.dailyAdSpend} onChange={handleConfInput('dailyAdSpend')} type="currency" prefix="$" /> }</div>
                    <h4 className="text-[11px] font-black text-zinc-900 uppercase tracking-widest pt-4 border-t border-zinc-100">Costos Unitarios Operativos</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <InputP label="Meta Profit" value={newSalesConfig.targetProfit} onChange={handleConfInput('targetProfit')} type="currency" prefix="$" />
                        <InputP label="Costo Prod" value={newSalesConfig.productCost} onChange={handleConfInput('productCost')} type="currency" prefix="$" />
                        <InputP label="Flete de Envío" value={newSalesConfig.freight} onChange={handleConfInput('freight')} type="currency" prefix="$" />
                        <InputP label="Fulfillment" value={newSalesConfig.fulfillment} onChange={handleConfInput('fulfillment')} type="currency" prefix="$" />
                        <InputP label="Comisión" value={newSalesConfig.commission} onChange={handleConfInput('commission')} type="currency" prefix="$" />
                        <InputP label="Costos Fijos" value={newSalesConfig.fixedCosts} onChange={handleConfInput('fixedCosts')} type="currency" prefix="$" />
                        <InputP label="Efectividad" value={newSalesConfig.effectiveness} onChange={handleConfInput('effectiveness')} suffix="%" />
                        <InputP label="Devolución" value={newSalesConfig.returnRate} onChange={handleConfInput('returnRate')} suffix="%" />
                    </div>
                    {formError && <div className="bg-rose-100 border border-rose-400 text-rose-700 font-bold p-3 rounded-xl text-center text-xs">{formError}</div>}
                    <button onClick={handleSaveSalesConfig} disabled={isSaving} className="w-full bg-zinc-900 text-white hover:bg-black font-black py-4 rounded-2xl text-sm uppercase tracking-widest shadow-xl active:scale-95 transition-all mt-6">{isSaving ? 'Guardando...' : 'Guardar Configuración'}</button></div>
                </div>
            </div>
        )}
    </div>
  );

  // --- RENDER PRINCIPAL ---
  if (!user) return <LoginScreen setErrorExt={setNotification} />;

  return (
    <div className="min-h-screen bg-[#f1f5f9] p-2 md:p-8 font-sans text-zinc-900 overflow-x-hidden">
      {notification && <div className="fixed bottom-6 md:bottom-10 left-1/2 transform -translate-x-1/2 bg-zinc-900 text-white px-8 py-4 rounded-2xl shadow-2xl z-[400] font-bold text-xs uppercase tracking-widest animate-in slide-in-from-bottom-10 text-center leading-none">{notification}</div>}
      
      <div className="max-w-[1400px] mx-auto">
        {/* NAVEGACIÓN MODULAR */}
        <div className="flex flex-col md:flex-row justify-between items-center mb-4 md:mb-8 gap-3 md:gap-4">
            <div className="bg-white p-1 rounded-2xl md:rounded-[2rem] shadow-xl border border-zinc-200 flex flex-wrap md:flex-nowrap w-full md:w-auto overflow-hidden">
                <button onClick={()=>handleModuleChange('winners')} className={`flex-1 md:flex-none md:px-8 py-2.5 md:py-3 text-[9px] md:text-[11px] font-black uppercase tracking-wider transition-all duration-500 ${activeModule === 'winners' ? 'bg-zinc-900 text-white shadow-lg rounded-xl md:rounded-[1.5rem]' : 'text-zinc-400'}`}>Winners</button>
                <button onClick={()=>handleModuleChange('imports')} className={`flex-1 md:flex-none md:px-8 py-2.5 md:py-3 text-[9px] md:text-[11px] font-black uppercase tracking-wider transition-all duration-500 ${activeModule === 'imports' ? 'bg-zinc-900 text-white shadow-lg rounded-xl md:rounded-[1.5rem]' : 'text-zinc-400'}`}>Importación</button>
                <button onClick={()=>handleModuleChange('projection')} className={`flex-1 md:flex-none md:px-8 py-2.5 md:py-3 text-[9px] md:text-[11px] font-black uppercase tracking-wider transition-all duration-500 ${activeModule === 'projection' ? 'bg-indigo-600 text-white shadow-lg rounded-xl md:rounded-[1.5rem]' : 'text-zinc-400 hover:text-indigo-600'}`}>P&G</button>
                <button onClick={()=>handleModuleChange('sales')} className={`flex-1 md:flex-none md:px-8 py-2.5 md:py-3 text-[9px] md:text-[11px] font-black uppercase tracking-wider transition-all duration-500 ${activeModule === 'sales' ? 'bg-emerald-600 text-white shadow-lg rounded-xl md:rounded-[1.5rem]' : 'text-zinc-400 hover:text-emerald-600'}`}>Rendimiento</button>
            </div>
            <button onClick={handleLogout} className="text-zinc-400 hover:text-zinc-900 text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all">SALIR <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
        </div>

        {/* CONTENIDO DE MÓDULOS */}
        {activeModule === 'winners' || activeModule === 'imports' ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2 md:gap-4 mb-4 md:mb-6 animate-in fade-in">
                <div className="md:col-span-2 relative"><input type="text" placeholder="Buscar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full bg-white border-2 border-zinc-100 rounded-xl md:rounded-2xl p-3 md:p-4 text-sm focus:border-zinc-900 outline-none transition-all shadow-sm"/><span className="absolute right-4 top-1/2 transform -translate-y-1/2 opacity-20">🔍</span></div>
                <div className="grid grid-cols-2 md:grid-cols-1 gap-2 md:contents"><select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)} className="w-full bg-white border-2 border-zinc-100 rounded-xl md:rounded-2xl p-3 md:p-4 text-[11px] md:text-base font-bold text-zinc-600 outline-none shadow-sm cursor-pointer"><option value="all">TODOS PROV.</option>{uniqueSuppliers.filter(s => s !== 'all').map(s => (<option key={s} value={s}>{s.toUpperCase()}</option>))}</select><select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} className="w-full bg-white border-2 border-zinc-100 rounded-xl md:rounded-2xl p-3 md:p-4 text-[11px] md:text-base font-bold text-zinc-600 outline-none shadow-sm cursor-pointer"><option value="manual">ORDEN MANUAL</option><option value="roi-desc">ROI ↑</option><option value="roi-asc">ROI ↓</option><option value="recent">RECIENTES</option></select></div>
            </div>
            <header className="flex flex-col md:flex-row justify-between items-center mb-4 md:mb-6 gap-3 md:gap-4 bg-white p-3 md:p-6 rounded-xl md:rounded-[2rem] shadow-sm border border-zinc-200/50 relative animate-in fade-in"><div className="flex items-center gap-3 md:gap-5 w-full md:w-auto"><div className="w-10 h-10 md:w-14 md:h-14 bg-zinc-900 rounded-xl md:rounded-[1.2rem] flex items-center justify-center text-white text-xl md:text-2xl shadow-xl italic font-black shrink-0">W</div><div className="text-left"><h1 className="text-lg md:text-3xl font-black tracking-tighter uppercase italic text-zinc-900 leading-none">{activeModule === 'winners' ? 'Winner OS' : 'Importación'}</h1><p className="text-[7px] md:text-[10px] text-zinc-400 mt-1 uppercase font-black tracking-widest md:tracking-[0.3em]">Sincronizado Cloud</p></div></div><button onClick={() => { setIsCreating(true); setFormError(''); }} className="bg-zinc-900 hover:bg-black text-white w-full md:w-auto px-6 md:px-10 py-3 md:py-4 rounded-xl md:rounded-[1.2rem] shadow-2xl font-black text-[10px] md:text-xs uppercase tracking-widest active:scale-95 transition-all">➕ Crear Registro</button></header>
            <div className="flex md:justify-center gap-1.5 md:gap-2 mb-4 md:mb-10 overflow-x-auto no-scrollbar pb-2 animate-in fade-in">{Object.values(activeModule === 'winners' ? WINNER_STATUS : IMPORT_STATUS).map((config) => (<button key={config.id} onClick={() => setActiveTab(config.id)} className={`px-3 md:px-6 py-2 md:py-3.5 rounded-lg md:rounded-[1.2rem] font-black text-[10px] md:text-[11px] whitespace-nowrap uppercase transition-all tracking-wider md:tracking-widest ${activeTab === config.id ? `${config.activeColor} shadow-xl scale-105` : 'bg-white text-zinc-400 border border-zinc-200/50 shadow-sm'}`}>{config.emoji} {config.label} <span className="ml-1 opacity-40">({products.filter(p => p.status === config.id).length})</span></button>))}</div>
            <div className="grid grid-cols-1 gap-4 md:gap-12 pb-20 animate-in slide-in-from-bottom-8">
              {displayedProducts.map((p, idx) => {
                const isW = activeModule === 'winners'; const mW = isW ? calculateWinnerMetrics(p) : null; const mI = !isW ? calculateImportMetrics(p) : null; const stCfg = (isW ? WINNER_STATUS[p.status] : IMPORT_STATUS[p.status]) || (isW ? WINNER_STATUS.pending : IMPORT_STATUS.pending);
                return (<div key={p.id} className={`rounded-2xl md:rounded-[3rem] shadow-sm border transition-all duration-500 overflow-hidden ${p.isWorking ? 'bg-amber-50 border-amber-400 shadow-amber-100 ring-2 ring-amber-500/20' : 'bg-white border-zinc-200/50'}`}><div className={`px-3 md:px-10 py-2 md:py-4 flex justify-between items-center border-b ${p.isWorking ? 'bg-amber-100/50 border-amber-200' : 'bg-zinc-50/20'}`}><div className="flex items-center gap-2 md:gap-6 flex-wrap text-left"><div className="bg-zinc-900 text-white px-2 py-1 rounded-lg text-[8px] md:text-[11px] font-black tracking-widest">{p.regNumber}</div><div className="flex items-center gap-2 px-2 py-1 bg-white rounded-lg border border-zinc-200 shadow-sm cursor-pointer active:scale-95 transition-all" onClick={() => updateDocField(p.id, 'isWorking', !p.isWorking)}><span className={`text-[8px] md:text-[10px] font-black uppercase tracking-tighter ${p.isWorking ? 'text-amber-600' : 'text-zinc-400'}`}>EN PROCESO</span><div className={`w-7 h-4 md:w-9 md:h-5 rounded-full relative transition-colors ${p.isWorking ? 'bg-amber-500' : 'bg-zinc-200'}`}><div className={`absolute top-0.5 w-3 h-3 md:w-4 md:h-4 bg-white rounded-full shadow-sm transition-all ${p.isWorking ? 'left-[0.9rem] md:left-[1.2rem]' : 'left-0.5'}`} /></div></div><span className="font-black text-[8px] md:text-[11px] uppercase tracking-widest text-zinc-500 whitespace-nowrap">{stCfg.emoji} {stCfg.label}</span><div className={`flex items-center bg-white rounded-lg md:rounded-2xl p-0.5 md:p-1 shadow-inner border border-zinc-100 transition-opacity ${sortOrder === 'manual' ? 'opacity-100' : 'opacity-20 pointer-events-none'}`}><button onClick={() => updateDocField(p.id, 'order', (p.order||0)-1)} className="w-6 h-6 hover:bg-zinc-900 hover:text-white rounded-md transition-all"><svg className="w-2 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="4"><path d="M5 15l7-7 7 7"/></svg></button><span className="text-[7px] md:text-[10px] font-black text-zinc-400 px-1 whitespace-nowrap">#{idx+1}</span><button onClick={() => updateDocField(p.id, 'order', (p.order||0)+1)} className="w-6 h-6 hover:bg-zinc-900 hover:text-white rounded-md transition-all"><svg className="w-2 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="4"><path d="M19 9l-7 7-7-7"/></svg></button></div></div><button onClick={() => deleteItem(p.id)} className="text-zinc-300 hover:text-rose-600 transition-all hover:scale-110 shrink-0"><svg className="w-4 h-4 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></button></div><div className="flex flex-col xl:flex-row"><div className="w-full xl:w-[35%] p-3 md:p-10 border-r border-zinc-100 bg-zinc-50/10 text-left"><div className="flex flex-col items-center"><div className="w-20 h-20 md:w-64 md:h-64 aspect-square bg-white rounded-xl md:rounded-[2.5rem] border border-zinc-200 md:mb-6 relative overflow-hidden shadow-sm group/img cursor-pointer shrink-0">{p.image ? <img src={p.image} className="w-full h-full object-cover" alt="Prod"/> : <span className="text-xs md:text-4xl opacity-10 font-bold flex items-center justify-center h-full italic">IMG</span>}<input type="file" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e)=>handleImage(e, p.id)}/></div><div className="w-full text-center md:text-left mt-3 md:mt-0"><input value={p.name || ''} onChange={(e)=>updateDocField(p.id, 'name', e.target.value)} className="w-full text-sm md:text-xl font-black bg-transparent border-b border-transparent hover:border-zinc-200 focus:border-zinc-900 outline-none md:mb-4 py-1 transition-all text-zinc-900 truncate" placeholder="Nombre..."/><div className="grid grid-cols-2 gap-2 mt-2 md:mt-0 md:mb-6">{isW ? (<><div className="bg-white border p-1.5 md:p-3 rounded-lg shadow-sm cursor-pointer" onClick={()=>copyToClipboard(p.dropiCode)}><label className="text-[6px] md:text-[8px] font-black text-zinc-400 uppercase tracking-widest block mb-0.5 leading-none">DROPI 📋</label><input value={p.dropiCode || ''} onChange={(e)=>updateDocField(p.id, 'dropiCode', e.target.value)} className="text-[11px] md:text-sm font-mono font-bold truncate w-full outline-none bg-transparent text-zinc-800"/></div><div className="bg-white border p-1.5 md:p-3 rounded-lg shadow-sm"><label className="text-[6px] md:text-[8px] font-black text-zinc-400 uppercase tracking-widest block mb-0.5 text-left">PROV.</label><input value={p.supplier || ''} onChange={(e)=>updateDocField(p.id, 'supplier', e.target.value)} className="w-full text-[11px] md:text-sm font-bold outline-none bg-transparent text-zinc-800"/></div></>) : (<><div className="bg-white border p-1.5 md:p-3 rounded-lg shadow-sm text-left"><label className="text-[6px] md:text-[8px] font-black text-zinc-400 uppercase tracking-widest block mb-0.5">CH-PROV</label><input value={p.chineseSupplier || ''} onChange={(e)=>updateDocField(p.id, 'chineseSupplier', e.target.value)} className="w-full text-[11px] md:text-sm font-bold outline-none bg-transparent text-zinc-800 truncate"/></div><div className="bg-white border p-1.5 md:p-3 rounded-lg shadow-sm text-left"><label className="text-[6px] md:text-[8px] font-black text-zinc-400 uppercase tracking-widest block mb-0.5">TRM</label><input type="number" value={p.dollarRate || 0} onChange={(e)=>updateDocField(p.id, 'dollarRate', parseFloat(e.target.value)||0)} className="w-full text-[11px] md:text-sm font-mono font-bold outline-none bg-transparent text-zinc-800"/></div></>)}</div></div></div>{isW && (<div className="mt-3"><button onClick={() => setExpandedItems({...expandedItems, [`desc_${p.id}`]: !expandedItems[`desc_${p.id}`]})} className="w-full flex justify-between items-center px-3 py-2 bg-white border border-zinc-200 rounded-lg text-[9px] font-black text-zinc-500 uppercase tracking-widest shadow-sm"><span>Ver Estrategia</span><svg className={`w-3 h-3 transition-transform ${expandedItems[`desc_${p.id}`] ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7" strokeWidth="4"/></svg></button>{expandedItems[`desc_${p.id}`] && (<textarea value={p.description || ''} onChange={(e)=>updateDocField(p.id, 'description', e.target.value)} rows={3} className="w-full mt-2 text-[12px] bg-white p-3 rounded-xl border text-zinc-500 animate-in fade-in" placeholder="Escribir estrategia..."/>)}</div>)}</div><div className="flex-1 p-3 md:p-10 space-y-4 md:space-y-10 relative text-left">{isW ? (<div className="grid grid-cols-4 gap-2 md:gap-4">{['base', 'cpa', 'freight', 'fulfillment', 'commission', 'returns', 'fixed'].map(k => (<div key={k} className={`p-2 md:p-5 rounded-lg border transition-all hover:bg-white text-left ${p.isWorking ? 'bg-white/70 border-amber-300' : 'bg-zinc-50/50 border-zinc-100'}`}><label className="text-[6px] md:text-[10px] font-black text-zinc-400 uppercase block mb-0.5 leading-none">{k}</label><input type="number" value={p.costs?.[k] || 0} onChange={(e)=>updateNestedField(p.id, 'costs', k, parseFloat(e.target.value)||0)} className="w-full font-mono text-[11px] md:text-base font-bold bg-transparent outline-none text-zinc-700"/></div>))}</div>) : (<div className="grid grid-cols-4 gap-2 md:gap-4">{[{k:'prodCostUSD',l:'USD'}, {k:'cbmCostCOP',l:'CBM'}, {k:'unitsQty',l:'Uds'}, {k:'ctnQty',l:'CTN'}, {k:'yiwuFreightUSD',l:'Yiwu'}].map(f=>(<div key={f.k} className={`p-2 md:p-5 rounded-lg border text-left transition-all ${p.isWorking ? 'bg-white/70 border-amber-300' : 'bg-zinc-50/50 border-zinc-100'}`}><label className="text-[6px] md:text-[10px] font-black text-zinc-400 uppercase block mb-0.5 leading-none">{f.l}</label><input type="number" value={p[f.k] || 0} onChange={(e)=>updateDocField(p.id, f.k, parseFloat(e.target.value)||0)} className="w-full font-mono text-[11px] font-bold bg-transparent outline-none text-zinc-800"/></div>))}<div className={`col-span-2 p-2 md:p-5 rounded-lg border text-left transition-all ${p.isWorking ? 'bg-white/70 border-amber-300' : 'bg-zinc-50/50 border-zinc-100'}`}><label className="text-[6px] md:text-[10px] font-black text-zinc-400 uppercase block mb-1 leading-none">Medidas (cm)</label><div className="grid grid-cols-3 gap-1"><input type="number" value={p.measures?.width || 0} onChange={(e)=>updateNestedField(p.id, 'measures', 'width', parseFloat(e.target.value)||0)} className="bg-white border p-1 rounded text-sm w-full outline-none"/><input type="number" value={p.measures?.height || 0} onChange={(e)=>updateNestedField(p.id, 'measures', 'height', parseFloat(e.target.value)||0)} className="bg-white border p-1 rounded text-sm w-full outline-none"/><input type="number" value={p.measures?.length || 0} onChange={(e)=>updateNestedField(p.id, 'measures', 'length', parseFloat(e.target.value)||0)} className="bg-white border p-1 rounded text-sm w-full outline-none"/></div></div><div className={`col-span-2 md:col-span-1 p-2 md:p-5 rounded-lg md:rounded-2xl border text-left transition-all flex flex-col justify-center ${p.isWorking ? 'bg-white/70 border-amber-300' : 'bg-indigo-50/50 border-indigo-100'}`}><label className="text-[6px] md:text-[10px] font-black text-indigo-500 uppercase block mb-1 leading-none">TOTAL CBM</label><div className="w-full font-mono text-[11px] md:text-base font-black text-indigo-700 leading-none">{calculateImportMetrics(p).totalCbm.toFixed(3)}</div></div></div>)}<div className="bg-zinc-900 rounded-xl md:rounded-[3rem] p-5 md:p-10 text-white shadow-2xl relative overflow-hidden"><div className="absolute top-0 right-0 w-32 md:w-80 h-32 md:h-80 bg-indigo-500/10 rounded-full blur-[60px] md:blur-[120px] -mr-16 -mt-16"></div>{isW ? (<div className="relative z-10 space-y-6 md:space-y-8"><div className="flex justify-between items-end border-b border-zinc-800 pb-4 md:pb-8 gap-4 text-left"><div className="flex-1"><label className="text-[9px] md:text-[11px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5 block leading-none">PVP Sugerido</label><div className="flex items-center gap-1"><span className="text-xl md:text-3xl font-bold opacity-20">$</span><input type="number" value={p.targetPrice || 0} onChange={(e)=>updateDocField(p.id, 'targetPrice', parseFloat(e.target.value)||0)} className="bg-transparent font-black text-2xl md:text-6xl outline-none w-full tracking-tighter text-white focus:text-emerald-400 transition-colors"/></div></div><div className="text-right shrink-0"><p className="text-[10px] font-bold text-rose-400 uppercase mb-1 italic leading-none">Costos</p><p className="text-lg md:text-3xl font-mono font-bold text-rose-50">{formatCurrency(mW.totalCost)}</p></div></div><div className="flex justify-between items-center gap-4"><div className="bg-white/5 p-4 rounded-xl border border-white/5 flex-1 shadow-inner text-left"><p className="text-[9px] font-bold text-zinc-500 uppercase mb-1.5 leading-none px-1">Utilidad Neta</p><p className={`text-2xl md:text-5xl font-mono font-bold px-1 ${mW.profit > 0 ? 'text-emerald-400' : 'text-rose-500'}`}>{formatCurrency(mW.profit)}</p></div><div className="text-right shrink-0"><p className="text-[10px] font-bold text-zinc-500 uppercase mb-1 italic leading-none">ROI</p><p className="text-4xl md:text-7xl font-black italic tracking-tighter leading-none">{mW.margin.toFixed(1)}%</p></div></div></div>) : (<div className="relative z-10 space-y-5 md:space-y-8"><div className="grid grid-cols-2 gap-6 border-b border-zinc-800 pb-4 text-left"><div><p className="text-[9px] font-black text-zinc-500 uppercase mb-1.5 italic leading-none">China (1.03x)</p><p className="text-lg md:text-3xl font-bold font-mono">{formatCurrency(mI.costChinaCOP)}</p></div><div className="text-right"><p className="text-[9px] font-black text-zinc-400 uppercase mb-1.5 italic leading-none">Logística</p><p className="text-lg md:text-3xl font-bold font-mono">{formatCurrency(mI.nationalizationCOP)}</p></div></div><div className="bg-emerald-500/10 p-4 md:p-10 rounded-xl border border-emerald-500/20 flex flex-col md:flex-row justify-between items-center gap-3"><div className="text-left w-full"><p className="text-[9px] md:text-[12px] font-black text-emerald-400 uppercase mb-1.5 leading-none">Costo Prod. Colombia</p><p className="text-3xl md:text-7xl font-black text-white tracking-tighter leading-none">{formatCurrency(mI.unitCostColombia)}</p></div><div className="text-left md:text-right w-full md:w-auto"><p className="text-[8px] font-bold text-zinc-500 uppercase mb-1 leading-none">Inversión Total</p><p className="text-sm md:text-2xl font-mono opacity-50 italic">{formatCurrency(mI.totalLandCostCOP)}</p></div></div></div>)}</div><div className="flex flex-wrap gap-2.5 justify-center md:justify-start">{Object.values(isW ? WINNER_STATUS : IMPORT_STATUS).map(s=>(<button key={s.id} onClick={()=>updateDocField(p.id, 'status', s.id)} className={`px-4 md:px-8 py-3 rounded-xl text-[10px] font-black border-2 uppercase transition-all whitespace-nowrap active:scale-95 ${p.status===s.id ? `bg-white ${s.activeColor} border-zinc-900 shadow-xl` : 'bg-white border-zinc-100 text-zinc-400'}`}>{s.emoji} {s.label}</button>))}</div></div></div></div>);
              })}
            </div>
          </>
        ) : activeModule === 'projection' ? (
          renderProjectionModule()
        ) : activeModule === 'sales' ? (
          renderSalesModule()
        ) : null}
      </div>

      {/* MODAL CREACIÓN (COMÚN) */}
      {isCreating && (
        <div className="fixed inset-0 bg-zinc-950/90 backdrop-blur-xl flex items-center justify-center z-[300] p-3 animate-in fade-in duration-300">
            <div className="bg-white rounded-[3.5rem] shadow-2xl max-w-5xl w-full max-h-[95vh] overflow-y-auto no-scrollbar animate-in zoom-in-95 duration-300">
                <header className="sticky top-0 bg-white/90 backdrop-blur-md p-4 md:p-8 border-b flex justify-between items-center z-10"><h2 className="text-sm md:text-2xl font-black text-zinc-900 uppercase italic">Registro Cloud</h2><button onClick={()=>{setIsCreating(false); setFormError('');}} className="bg-zinc-100 p-2 md:p-3 rounded-full hover:bg-zinc-200">✕</button></header>
                <div className="p-4 md:p-12">
                   {activeModule === 'winners' ? (
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-left">
                       <div className="space-y-4"><div className="aspect-square bg-zinc-50 rounded-2xl border-2 border-dashed border-zinc-200 relative flex items-center justify-center overflow-hidden">{newProduct.image ? <img src={newProduct.image} className="w-full h-full object-cover"/> : <span className="text-4xl opacity-10 font-bold italic">IMG</span>}<input type="file" className="absolute inset-0 opacity-0" onChange={(e)=>handleImage(e)}/></div><input value={newProduct.name} onChange={(e)=>setNewProduct({...newProduct, name: e.target.value})} className="w-full border-b-2 border-zinc-200 pb-2 font-bold text-2xl outline-none" placeholder="* Nombre Comercial"/></div>
                       <div className="space-y-6"><div className="bg-zinc-50 p-6 rounded-2xl border"><h3 className="text-[10px] font-black uppercase text-zinc-400 mb-4 border-b pb-2">Costos</h3><div className="grid grid-cols-2 gap-3">{['base','cpa','freight','fulfillment','commission','returns','fixed'].map(k=>(<div key={k}><label className="text-[8px] font-bold text-zinc-500 uppercase">{k}</label><input type="number" value={newProduct.costs?.[k]||''} onChange={(e)=>setNewProduct({...newProduct, costs:{...newProduct.costs, [k]:parseFloat(e.target.value)||0}})} className="w-full bg-white border p-2 rounded-lg font-mono"/></div>))}</div></div><div className="bg-zinc-900 p-6 rounded-2xl text-white shadow-xl"><label className="text-[9px] font-bold uppercase text-zinc-500 mb-2 block">PVP Sugerido</label><div className="flex items-center gap-2"><span className="text-2xl opacity-30">$</span><input type="number" value={newProduct.targetPrice||''} onChange={(e)=>setNewProduct({...newProduct, targetPrice:parseFloat(e.target.value)||0})} className="w-full bg-transparent border-b border-zinc-700 text-4xl font-bold outline-none"/></div></div></div>
                     </div>
                   ) : (
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-left">
                        <div className="space-y-4"><div className="aspect-square bg-zinc-50 rounded-2xl border-2 border-dashed border-zinc-200 relative flex items-center justify-center overflow-hidden">{newProduct.image ? <img src={newProduct.image} className="w-full h-full object-cover"/> : <span className="text-4xl opacity-10 font-bold italic">IMG</span>}<input type="file" className="absolute inset-0 opacity-0" onChange={(e)=>handleImage(e)}/></div><input value={newProduct.name} onChange={(e)=>setNewProduct({...newProduct, name: e.target.value})} className="w-full border-b-2 border-zinc-200 pb-2 font-bold text-2xl outline-none" placeholder="* Nombre Producto"/></div>
                        <div className="space-y-4"><div className="bg-zinc-50 p-4 rounded-xl grid grid-cols-2 gap-3">{[{k:'prodCostUSD',l:'Costo USD'},{k:'cbmCostCOP',l:'Costo CBM'},{k:'unitsQty',l:'Unidades'},{k:'ctnQty',l:'CTN Qty'},{k:'yiwuFreightUSD',l:'Flete YIWU'}].map(f=>(<div key={f.k}><label className="text-[8px] font-black text-zinc-400 uppercase">{f.l}</label><input type="number" value={newProduct[f.k]||''} onChange={(e)=>setNewProduct({...newProduct, [f.k]:parseFloat(e.target.value)||0})} className="w-full border p-2 rounded-lg"/></div>))}</div></div>
                     </div>
                   )}
                   {formError && <div className="bg-rose-100 border-2 border-rose-500 text-rose-700 font-bold p-3 rounded-xl mt-6 text-center text-sm">{formError}</div>}
                   <button onClick={handleSave} disabled={isSaving} className="w-full mt-6 bg-zinc-900 text-white font-black py-5 rounded-xl text-xl shadow-2xl transition-all uppercase tracking-widest active:scale-95 disabled:opacity-50">{isSaving ? 'Guardando...' : 'Confirmar Registro'}</button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
}
