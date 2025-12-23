import React, { useState, useMemo, useEffect } from 'react';
import { 
  FileText, 
  AlertCircle, 
  CheckCircle2, 
  Users, 
  Download, 
  Search, 
  ArrowRightLeft, 
  Settings, 
  XCircle, 
  FileSpreadsheet, 
  Trash2, 
  Plus, 
  ChevronUp, 
  ChevronDown, 
  ArrowDownToLine, 
  CheckSquare, 
  Square, 
  UserPlus, 
  X, 
  Link as LinkIcon, 
  Info, 
  CreditCard, 
  Building2, 
  ShieldOff, 
  RotateCcw, 
  History, 
  User, 
  LogOut,
  Lock,
  ShieldCheck,
  FilterX
} from 'lucide-react';

// --- Persistência Local ---
const STORAGE_KEYS = {
  user: 'conciliador_user',
  data: 'conciliador_data',
  auditLogs: 'conciliador_audit_logs',
  payerOverrides: 'conciliador_payer_overrides',
  matrixExclusions: 'conciliador_matrix_exclusions'
};

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// --- Funções Utilitárias (Hoisted) ---
function normalizeId(val) {
  if (!val) return '';
  return String(val).replace(/\D/g, ''); 
}

function formatTimestamp(ts) {
  if (!ts) return 'Processando...';
  try {
    const date = ts.toDate
      ? ts.toDate()
      : (ts?.seconds ? new Date(ts.seconds * 1000) : new Date(ts));
    return date.toLocaleString('pt-BR');
  } catch (e) { return 'Data inválida'; }
}

function safeString(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') return '';
  return String(val);
}

function exportToCSV(rows, filenameBase = 'export') {
  const headers = [
    'Documento',
    'Empresa',
    'Questor',
    'Sênior',
    'Origem Fat.',
    'Gestta',
    'Diagnóstico',
    'Área Gestta',
    'Área Questor',
    'Confronto'
  ];

  const escapeVal = (val) => {
    const str = safeString(val);
    if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
  };

  const lines = [
    headers.join(','),
    ...rows.map(r => ([
      r.id,
      r.nome,
      r.questor ? 'Sim' : 'Não',
      r.senior ? 'Sim' : 'Não',
      r.seniorOrigem,
      r.gestta,
      r.diagnostico,
      r.areaGestta,
      r.areaQuestor,
      r.confrontoArea
    ]).map(escapeVal).join(','))
  ];

  const csv = '\uFEFF' + lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filenameBase}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function normalizeSpecie(val) {
  return safeString(val)
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getGesttaArea(name) {
  const match = /#\s*(0|1)\s*$/.exec(safeString(name));
  if (!match) return '';
  return match[1] === '0' ? 'In Company' : 'Integrada';
}

function getQuestorArea(especie) {
  const norm = normalizeSpecie(especie);
  if (!norm) return '';
  if (/(IN COMPANY|INCOMPANY)/.test(norm)) return 'In Company';
  if (/(INTEGRADA|INTEGRADO|INTERNO)/.test(norm)) return 'Integrada';
  return '';
}

function loadXLSX() {
  return new Promise((resolve) => {
    if (window.XLSX) return resolve(window.XLSX);
    const script = document.createElement('script');
    script.src = "https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js";
    script.onload = () => resolve(window.XLSX);
    document.head.appendChild(script);
  });
}

const App = () => {
  // 1. Hooks (Ordem Fixa Obrigatória)
  const [userName, setUserName] = useState(() => localStorage.getItem(STORAGE_KEYS.user) || '');
  const [isLogged, setIsLogged] = useState(() => !!localStorage.getItem(STORAGE_KEYS.user));
  const [data, setData] = useState(() => readJson(STORAGE_KEYS.data, { questor: [], senior: [], gestta: [] }));
  const [auditLogs, setAuditLogs] = useState(() => readJson(STORAGE_KEYS.auditLogs, []));
  const [activeTab, setActiveTab] = useState('explorer');
  const [searchTerm, setSearchTerm] = useState('');
  const [isLibraryLoaded, setIsLibraryLoaded] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: 'nome', direction: 'asc' });
  const [isSyncing, setIsSyncing] = useState(false);
  const [loginError, setLoginError] = useState('');

  const [columnFilters, setColumnFilters] = useState({ 
    id: '', 
    nome: '', 
    questor: 'all', 
    senior: 'all', 
    seniorOrigem: 'all', 
    gestta: 'all',
    diagnostico: 'all',
    areaGestta: 'all',
    areaQuestor: 'all',
    confrontoArea: 'all'
  });
  
  const [payerOverrides, setPayerOverrides] = useState(() => readJson(STORAGE_KEYS.payerOverrides, {})); 
  const [matrixExclusions, setMatrixExclusions] = useState(() => new Set(readJson(STORAGE_KEYS.matrixExclusions, [])));
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [isPayerModalOpen, setIsPayerModalOpen] = useState(false);
  const [payerSearch, setPayerSearch] = useState('');

  // 2. Memos de Processamento (Calculados incondicionalmente)
  const allConsolidatedData = useMemo(() => {
    const qMap = new Map(); data.questor.forEach(i => qMap.set(normalizeId(i.INSCRFEDERAL), i));
    const sMap = new Map();
    const seniorBases = new Set();
    data.senior.forEach(i => {
      const id = normalizeId(i.CNPJ); sMap.set(id, i);
      if (id.length >= 8) seniorBases.add(id.substring(0, 8));
    });
    const gMap = new Map(); data.gestta.forEach(i => gMap.set(normalizeId(i.CNPJ || i.cnpj), i));
    const allIds = [...new Set([...qMap.keys(), ...sMap.keys(), ...gMap.keys()])];

    return allIds.map(id => {
      const q = qMap.get(id); const s = sMap.get(id); const g = gMap.get(id);
      const idBase = id.substring(0, 8);
      const pId = payerOverrides[id];
      const isEx = matrixExclusions.has(id);
      
      const hasDirect = !!s;
      const hasGroup = !isEx && id.length >= 8 && seniorBases.has(idBase);
      const hasManual = pId ? (sMap.has(pId) || seniorBases.has(pId.substring(0, 8))) : false;
      
      const seniorStatus = hasDirect || hasGroup || hasManual;
      const gesttaSt = safeString(g?.['Ativo/inativo'] || 'AUSENTE');
      const gAt = gesttaSt.toLowerCase() === 'ativo';
      const qAt = !!q;
      const gesttaNome = safeString(g?.Nome || g?.NOME || g?.nome || '');
      const questorEspecie = safeString(q?.ESPECIEESTAB);
      const areaGestta = getGesttaArea(gesttaNome);
      const areaQuestor = getQuestorArea(questorEspecie);
      let confrontoArea = 'OK';
      if (!areaGestta && !areaQuestor) confrontoArea = 'Falta Gestta/Questor';
      else if (!areaGestta) confrontoArea = 'Falta Gestta';
      else if (!areaQuestor) confrontoArea = 'Falta Questor';
      else if (areaGestta !== areaQuestor) confrontoArea = 'Divergente';

      let diagnostico = "Divergente";
      if ((qAt && seniorStatus && gAt) || (!qAt && !seniorStatus && !gAt)) diagnostico = "Consistente";
      else if (seniorStatus && gAt && !qAt) diagnostico = "Falta Cadastro Questor";
      else if (qAt && !seniorStatus && !gAt) diagnostico = "Cliente Inativo (Baixa)";

      let seniorOrigem = 'Ausente';
      if (hasDirect) seniorOrigem = 'Direto';
      else if (hasManual) seniorOrigem = 'Manual';
      else if (hasGroup) seniorOrigem = 'Matriz';
      else if (isEx) seniorOrigem = 'Ignorado';

      return {
        id: safeString(id), nome: safeString(q?.NOMEEMPRESA || s?.Nome || s?.NOME || g?.Nome || 'N/A'),
        codigoQuestor: safeString(q?.CODIGOEMPRESA), codigoSenior: safeString(s?.Sênior), codigoGestta: safeString(g?.Código),
        questor: qAt, senior: seniorStatus, gestta: gesttaSt, diagnostico, seniorOrigem,
        areaGestta, areaQuestor, confrontoArea,
        payerId: pId ? safeString(pId) : null, isDirectSenior: hasDirect, isExcluded: isEx
      };
    });
  }, [data, payerOverrides, matrixExclusions]);

  const filteredData = useMemo(() => {
    let items = [...allConsolidatedData];
    if (searchTerm) {
        const s = searchTerm.toLowerCase();
        items = items.filter(i => i.nome.toLowerCase().includes(s) || i.id.includes(s));
    }
    if (columnFilters.id) items = items.filter(i => i.id.includes(columnFilters.id));
    if (columnFilters.nome) items = items.filter(i => i.nome.toLowerCase().includes(columnFilters.nome.toLowerCase()));
    if (columnFilters.questor !== 'all') items = items.filter(i => i.questor === (columnFilters.questor === 'sim'));
    if (columnFilters.senior !== 'all') items = items.filter(i => i.senior === (columnFilters.senior === 'sim'));
    if (columnFilters.seniorOrigem !== 'all') items = items.filter(i => i.seniorOrigem === columnFilters.seniorOrigem);
    if (columnFilters.gestta !== 'all') items = items.filter(i => i.gestta.toLowerCase() === columnFilters.gestta);
    if (columnFilters.diagnostico !== 'all') items = items.filter(i => i.diagnostico === columnFilters.diagnostico);
    if (columnFilters.areaGestta !== 'all') items = items.filter(i => i.areaGestta === columnFilters.areaGestta);
    if (columnFilters.areaQuestor !== 'all') items = items.filter(i => i.areaQuestor === columnFilters.areaQuestor);
    if (columnFilters.confrontoArea !== 'all') items = items.filter(i => i.confrontoArea === columnFilters.confrontoArea);
    
    if (sortConfig.key) {
      items.sort((a, b) => {
        let aV = a[sortConfig.key]; let bV = b[sortConfig.key];
        if (typeof aV === 'boolean') { aV = aV ? 1 : 0; bV = bV ? 1 : 0; }
        const comp = String(aV).localeCompare(String(bV), undefined, { numeric: true, sensitivity: 'base' });
        return sortConfig.direction === 'asc' ? comp : -comp;
      });
    }
    return items;
  }, [allConsolidatedData, searchTerm, sortConfig, columnFilters]);

  // 3. Effects
  useEffect(() => {
    loadXLSX().then(() => setIsLibraryLoaded(true));
  }, []);

  useEffect(() => {
    writeJson(STORAGE_KEYS.data, data);
  }, [data]);

  useEffect(() => {
    const sortedLogs = [...auditLogs].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    if (sortedLogs.length !== auditLogs.length || sortedLogs.some((l, i) => l.id !== auditLogs[i]?.id)) {
      setAuditLogs(sortedLogs);
      return;
    }
    writeJson(STORAGE_KEYS.auditLogs, auditLogs);
  }, [auditLogs]);

  useEffect(() => {
    writeJson(STORAGE_KEYS.payerOverrides, payerOverrides);
  }, [payerOverrides]);

  useEffect(() => {
    writeJson(STORAGE_KEYS.matrixExclusions, Array.from(matrixExclusions));
  }, [matrixExclusions]);

  // --- Funções de Operação ---
  const registerLog = async (action, details, forcedUser = null) => {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      user: safeString(forcedUser || userName || 'SISTEMA'),
      action: safeString(action),
      details: safeString(details),
      timestamp: Date.now()
    };
    setAuditLogs(prev => [entry, ...prev]);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (!name) {
      setLoginError('Informe seu nome para entrar.');
      return;
    }
    setLoginError('');
    setUserName(name); 
    setIsLogged(true);
    localStorage.setItem(STORAGE_KEYS.user, name);
    await registerLog('Login', `Utilizador "${name}" acedeu ao sistema.`, name);
  };

  const handleFileUpload = async (e, system) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    const XLSX = await loadXLSX();
    const newItems = [];
    for (const file of files) {
      const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
      const decodeText = (buffer) => {
        const bytes = new Uint8Array(buffer);
        const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
        if (utf8.includes('�')) {
          return new TextDecoder('windows-1252', { fatal: false }).decode(bytes);
        }
        return utf8;
      };

      const processContent = (content, isBinary = false) => {
        let results = [];
        if (isBinary) {
          const workbook = XLSX.read(content, { type: 'array' });
          results = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
        } else {
          const text = typeof content === 'string' ? content : decodeText(content);
          const lines = text.split(/\r?\n/);
          if (lines.length === 0) return [];
          const sep = system === 'questor' ? '|' : ',';
          const headers = lines[0].split(sep).map(h => h.trim().replace(/"/g, ''));
          results = lines.slice(1).filter(l => l.trim()).map(l => {
              const vals = system === 'questor' ? l.split('|') : l.match(/(".*?"|[^,]+|(?<=,)(?=,)|(?<=^)(?=,)|(?<=,)(?=$))/g);
              const obj = {};
              headers.forEach((h, i) => { obj[h] = safeString(vals?.[i]).trim().replace(/^"|"$/g, ''); });
              return obj;
          });
        }
        return results.map(row => {
          const clean = {};
          Object.keys(row).forEach(k => clean[k] = safeString(row[k]));
          return clean;
        });
      };
      const reader = new FileReader();
      const res = await new Promise((r) => {
        reader.onload = (ev) => r(processContent(ev.target.result, isExcel));
        if (isExcel) {
          reader.readAsArrayBuffer(file);
        } else {
          reader.readAsArrayBuffer(file);
        }
      });
      newItems.push(...res);
    }
    const updated = { ...data };
    const idKey = system === 'questor' ? 'INSCRFEDERAL' : 'CNPJ';
    const existing = new Set(updated[system].map(i => normalizeId(i[idKey])));
    const filtered = newItems.filter(i => {
      const id = normalizeId(i[idKey] || i['cnpj'] || i['CNPJ']);
      if (!id || existing.has(id)) return false;
      existing.add(id); return true;
    });
    updated[system] = [...updated[system], ...filtered];
    setData(updated); 
    setIsSyncing(true);
    await registerLog('Importação', `Adicionados ${filtered.length} registos no sistema ${system.toUpperCase()}.`); 
    setIsSyncing(false); 
    e.target.value = null;
  };

  const assignPayer = async (payerId) => {
    const nextOverrides = { ...payerOverrides };
    selectedIds.forEach(id => { nextOverrides[id] = safeString(payerId); });
    setPayerOverrides(nextOverrides);
    await registerLog('Vínculo Manual', `${selectedIds.size} clientes vinculados ao pagador ${payerId}.`);
    setSelectedIds(new Set()); 
    setIsPayerModalOpen(false);
  };

  const removePayer = async (id) => { 
    const nextOverrides = { ...payerOverrides };
    delete nextOverrides[id];
    setPayerOverrides(nextOverrides);
    await registerLog('Desvínculo', `Vínculo manual removido do cliente ${id}.`); 
  };
  
  const toggleMatrixExclusion = async (id) => {
    if (matrixExclusions.has(id)) {
      const next = new Set(matrixExclusions);
      next.delete(id);
      setMatrixExclusions(next);
      await registerLog('Regra Matriz', `Regra de 8 dígitos reativada para o cliente ${id}.`);
    } else {
      const next = new Set(matrixExclusions);
      next.add(id);
      setMatrixExclusions(next);
      await registerLog('Regra Matriz', `Regra de 8 dígitos desativada para o cliente ${id}.`);
    }
  };

  const clearSystemData = async (system) => {
    const updated = { ...data, [system]: [] };
    setData(updated); 
    await registerLog('Limpeza', `A base do sistema ${system.toUpperCase()} foi limpa.`);
  };

  // --- RENDERS CONDICIONAIS ---

  if (!isLogged) {
    return (
      <div className="min-h-screen bg-indigo-600 flex items-center justify-center p-6 font-sans text-slate-900">
        <div className="bg-white p-8 rounded-3xl shadow-2xl w-full max-w-md animate-in zoom-in border-t-8 border-indigo-500">
          <div className="bg-indigo-100 w-16 h-16 rounded-2xl flex items-center justify-center mb-6 mx-auto shadow-sm">
            <Lock className="text-indigo-600" size={32} />
          </div>
          <h1 className="text-2xl font-black text-center mb-1 text-indigo-900 leading-none tracking-tight">Conciliador Base de Clientes</h1>
          <p className="text-slate-500 text-center mb-8 text-[10px] font-black uppercase tracking-widest">Identificação Colaborativa</p>
          <form onSubmit={handleLogin} className="space-y-4">
            <input name="name" type="text" placeholder="Nome do Responsável" required className="w-full px-5 py-4 bg-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500 font-bold" />
            {loginError && <div className="bg-rose-50 text-rose-600 p-3 rounded-xl text-[10px] font-black uppercase border border-rose-100">{loginError}</div>}
            <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-4 rounded-2xl font-black shadow-lg transition-all active:scale-95">
              Entrar no Sistema
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 text-sm">
      <header className="bg-white border-b sticky top-0 z-40 px-4 sm:px-6 lg:px-10 py-3 shadow-sm">
        <div className="max-w-screen-2xl w-full mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 p-2 rounded-xl text-white shadow-md shadow-indigo-100"><ArrowRightLeft size={20} /></div>
            <div>
              <h1 className="text-lg font-black tracking-tight leading-none uppercase italic text-indigo-900 leading-tight">Conciliador Base de Clientes</h1>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-black uppercase flex items-center gap-1"><ShieldCheck size={10} /> Sincronizado</span>
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter"> {safeString(userName)}</span>
              </div>
            </div>
          </div>
          <nav className="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
            {[{ id: 'upload', label: 'Importar', icon: Download }, { id: 'explorer', label: 'Trabalho', icon: Users }, { id: 'audit', label: 'Auditoria', icon: History }].map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-black transition-all ${activeTab === tab.id ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}>
                <tab.icon size={14} /> {safeString(tab.label)}
              </button>
            ))}
            <button onClick={() => { localStorage.removeItem(STORAGE_KEYS.user); window.location.reload(); }} className="ml-2 p-2 text-slate-400 hover:text-rose-500 transition-colors" title="Sair"><LogOut size={16} /></button>
          </nav>
        </div>
      </header>

      <main className="max-w-screen-2xl w-full mx-auto px-4 sm:px-6 lg:px-10 py-6">
        {activeTab === 'upload' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-in fade-in duration-500">
            <UploadCard title="Questor" desc="Base Primária (Pipe/Excel)" icon={Settings} color="blue" count={data.questor.length} onChange={(e) => handleFileUpload(e, 'questor')} onClear={() => clearSystemData('questor')} />
            <UploadCard title="Sênior" desc="Faturamento (CSV/Excel)" icon={FileSpreadsheet} color="orange" count={data.senior.length} onChange={(e) => handleFileUpload(e, 'senior')} onClear={() => clearSystemData('senior')} />
            <UploadCard title="Gestta" desc="Tarefas (Ativos/Inativos)" icon={CheckCircle2} color="emerald" count={data.gestta.length} onChange={(e) => handleFileUpload(e, 'gestta')} onClear={() => clearSystemData('gestta')} />
          </div>
        )}

        {activeTab === 'explorer' && (
          <div className="space-y-4 animate-in fade-in duration-300">
            <div className="bg-white p-4 rounded-2xl border flex flex-wrap items-center justify-between gap-4 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input type="text" placeholder="Busca CNPJ ou Nome..." className="pl-9 pr-4 py-2 border rounded-xl w-64 outline-none focus:ring-2 focus:ring-indigo-500 text-sm bg-slate-50" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                </div>
                {selectedIds.size > 0 && (
                  <button onClick={() => setIsPayerModalOpen(true)} className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-xs font-black shadow-lg flex items-center gap-2 transform active:scale-95 transition-all">
                    <UserPlus size={14} /> Vincular Pagador ({selectedIds.size})
                  </button>
                )}
                {Object.values(columnFilters).some(v => v !== '' && v !== 'all') && (
                    <button onClick={() => setColumnFilters({id:'', nome:'', questor:'all', senior:'all', seniorOrigem:'all', gestta:'all', diagnostico:'all', areaGestta:'all', areaQuestor:'all', confrontoArea:'all'})} className="text-rose-500 hover:bg-rose-50 px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors">
                        <FilterX size={14} /> Limpar Filtros
                    </button>
                )}
              </div>
              <button onClick={() => exportToCSV(filteredData, 'confronto_clientes')} className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-xl text-xs font-black shadow-md hover:bg-slate-900 transition-all"><ArrowDownToLine size={14} /> Exportar CSV</button>
            </div>

            <div className="bg-white rounded-3xl border overflow-hidden shadow-sm">
              <div className="overflow-x-auto max-h-[75vh]">
                <table className="w-full min-w-[1200px] table-fixed text-left text-xs sm:text-sm">
                  <colgroup>
                    <col className="w-12" />
                    <col className="w-40" />
                    <col className="w-[28rem]" />
                    <col className="w-24" />
                    <col className="w-24" />
                    <col className="w-28" />
                    <col className="w-24" />
                    <col className="w-28" />
                    <col className="w-44" />
                    <col className="w-36" />
                    <col className="w-36" />
                    <col className="w-36" />
                  </colgroup>
                  <thead className="bg-slate-50/95 backdrop-blur sticky top-0 z-20 border-b shadow-[0_1px_0_0_rgba(15,23,42,0.06)]">
                    <tr className="text-[11px] font-black uppercase text-slate-500 tracking-wider">
                      <th className="px-4 py-3 w-10 text-center border-r border-slate-100">
                        <button onClick={() => { if (selectedIds.size === filteredData.length) setSelectedIds(new Set()); else setSelectedIds(new Set(filteredData.map(i => i.id))); }}>
                          {selectedIds.size === filteredData.length && filteredData.length > 0 ? <CheckSquare size={16} className="text-indigo-600" /> : <Square size={16} />}
                        </button>
                      </th>
                      <SortHeader label="Documento" sortKey="id" currentSort={sortConfig} onSort={(k) => setSortConfig(p => ({key: k, direction: p.key === k && p.direction === 'asc' ? 'desc' : 'asc'}))} />
                      <SortHeader label="Empresa" sortKey="nome" currentSort={sortConfig} onSort={(k) => setSortConfig(p => ({key: k, direction: p.key === k && p.direction === 'asc' ? 'desc' : 'asc'}))} />
                      <SortHeader label="Questor" sortKey="questor" currentSort={sortConfig} onSort={(k) => setSortConfig(p => ({key: k, direction: p.key === k && p.direction === 'asc' ? 'desc' : 'asc'}))} />
                      <SortHeader label="Sênior" sortKey="senior" currentSort={sortConfig} onSort={(k) => setSortConfig(p => ({key: k, direction: p.key === k && p.direction === 'asc' ? 'desc' : 'asc'}))} />
                      <SortHeader label="Origem Fat." sortKey="seniorOrigem" currentSort={sortConfig} onSort={(k) => setSortConfig(p => ({key: k, direction: p.key === k && p.direction === 'asc' ? 'desc' : 'asc'}))} />
                      <SortHeader label="Gestta" sortKey="gestta" currentSort={sortConfig} onSort={(k) => setSortConfig(p => ({key: k, direction: p.key === k && p.direction === 'asc' ? 'desc' : 'asc'}))} />
                      <SortHeader label="Diagnóstico" sortKey="diagnostico" currentSort={sortConfig} onSort={(k) => setSortConfig(p => ({key: k, direction: p.key === k && p.direction === 'asc' ? 'desc' : 'asc'}))} />
                      <SortHeader label="Área Gestta" sortKey="areaGestta" currentSort={sortConfig} onSort={(k) => setSortConfig(p => ({key: k, direction: p.key === k && p.direction === 'asc' ? 'desc' : 'asc'}))} />
                      <SortHeader label="Área Questor" sortKey="areaQuestor" currentSort={sortConfig} onSort={(k) => setSortConfig(p => ({key: k, direction: p.key === k && p.direction === 'asc' ? 'desc' : 'asc'}))} />
                      <SortHeader label="Confronto" sortKey="confrontoArea" currentSort={sortConfig} onSort={(k) => setSortConfig(p => ({key: k, direction: p.key === k && p.direction === 'asc' ? 'desc' : 'asc'}))} />
                    </tr>
                    <tr className="bg-slate-50/60 border-b">
                      <td className="border-r border-slate-100"></td>
                      <td className="px-4 py-2"><input type="text" className="w-full h-8 px-2 border rounded text-[11px] bg-white" value={columnFilters.id} onChange={(e) => setColumnFilters({...columnFilters, id: e.target.value})} /></td>
                      <td className="px-4 py-2"><input type="text" className="w-full h-8 px-2 border rounded text-[11px] bg-white" value={columnFilters.nome} onChange={(e) => setColumnFilters({...columnFilters, nome: e.target.value})} /></td>
                      <td className="px-4 py-2"><select className="w-full h-8 px-2 border rounded text-[11px] bg-white" value={columnFilters.questor} onChange={(e) => setColumnFilters({...columnFilters, questor: e.target.value})}><option value="all">Todos</option><option value="sim">Sim</option><option value="nao">Não</option></select></td>
                      <td className="px-4 py-2"><select className="w-full h-8 px-2 border rounded text-[11px] bg-white" value={columnFilters.senior} onChange={(e) => setColumnFilters({...columnFilters, senior: e.target.value})}><option value="all">Todos</option><option value="sim">Sim</option><option value="nao">Não</option></select></td>
                      <td className="px-4 py-2">
                        <select className="w-full h-8 px-2 border rounded text-[11px] bg-white" value={columnFilters.seniorOrigem} onChange={(e) => setColumnFilters({...columnFilters, seniorOrigem: e.target.value})}>
                          <option value="all">Todos</option>
                          <option value="Direto">Direto</option>
                          <option value="Manual">Manual</option>
                          <option value="Matriz">Matriz</option>
                          <option value="Ausente">Ausente</option>
                        </select>
                      </td>
                      <td className="px-4 py-2"><select className="w-full h-8 px-2 border rounded text-[11px] bg-white" value={columnFilters.gestta} onChange={(e) => setColumnFilters({...columnFilters, gestta: e.target.value})}><option value="all">Todos</option><option value="ativo">Ativo</option><option value="inativo">Inativo</option><option value="ausente">Ausente</option></select></td>
                      <td className="px-4 py-2">
                        <select className="w-full h-8 px-2 border rounded text-[11px] bg-white" value={columnFilters.diagnostico} onChange={(e) => setColumnFilters({...columnFilters, diagnostico: e.target.value})}>
                          <option value="all">Todos</option>
                          <option value="Consistente">Consistente</option>
                          <option value="Falta Cadastro Questor">Falta Questor</option>
                          <option value="Cliente Inativo (Baixa)">Pendente Baixa</option>
                          <option value="Divergente">Divergente</option>
                        </select>
                      </td>
                      <td className="px-4 py-2">
                        <select className="w-full h-8 px-2 border rounded text-[11px] bg-white" value={columnFilters.areaGestta} onChange={(e) => setColumnFilters({...columnFilters, areaGestta: e.target.value})}>
                          <option value="all">Todos</option>
                          <option value="In Company">In Company</option>
                          <option value="Integrada">Integrada</option>
                        </select>
                      </td>
                      <td className="px-4 py-2">
                        <select className="w-full h-8 px-2 border rounded text-[11px] bg-white" value={columnFilters.areaQuestor} onChange={(e) => setColumnFilters({...columnFilters, areaQuestor: e.target.value})}>
                          <option value="all">Todos</option>
                          <option value="In Company">In Company</option>
                          <option value="Integrada">Integrada</option>
                        </select>
                      </td>
                      <td className="px-4 py-2">
                        <select className="w-full h-8 px-2 border rounded text-[11px] bg-white" value={columnFilters.confrontoArea} onChange={(e) => setColumnFilters({...columnFilters, confrontoArea: e.target.value})}>
                          <option value="all">Todos</option>
                          <option value="OK">OK</option>
                          <option value="Divergente">Divergente</option>
                          <option value="Falta Questor">Falta Questor</option>
                          <option value="Falta Gestta">Falta Gestta</option>
                          <option value="Falta Gestta/Questor">Falta Gestta/Questor</option>
                        </select>
                      </td>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-[11px] sm:text-xs">
                    {filteredData.map(item => (
                      <tr key={item.id} className={`hover:bg-slate-100/60 transition-colors ${selectedIds.has(item.id) ? 'bg-indigo-50/60' : ''}`}>
                        <td className="px-4 py-3 text-center border-r border-slate-100"><button onClick={() => { const n = new Set(selectedIds); if (n.has(item.id)) n.delete(item.id); else n.add(item.id); setSelectedIds(n); }}>{selectedIds.has(item.id) ? <CheckSquare size={16} className="text-indigo-600" /> : <Square size={16} className="text-slate-200" />}</button></td>
                        <td className="px-4 py-3 font-mono text-slate-500 whitespace-nowrap">{safeString(item.id)}</td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-800 leading-snug">{safeString(item.nome)}</div>
                          <div className="flex gap-2 mt-1 opacity-60">
                            {item.codigoQuestor && <span className="text-[9px] font-bold border px-1 rounded">Q: {safeString(item.codigoQuestor)}</span>}
                            {item.codigoSenior && <span className="text-[9px] font-bold border px-1 rounded">S: {safeString(item.codigoSenior)}</span>}
                            {item.codigoGestta && <span className="text-[9px] font-bold border px-1 rounded">G: {safeString(item.codigoGestta)}</span>}
                          </div>
                          {item.payerId && (
                            <div className="flex items-center gap-1 text-[9px] text-indigo-500 font-black mt-1 bg-indigo-50 px-2 py-0.5 rounded-full w-fit border border-indigo-100">
                              <LinkIcon size={10} /> Pagante: {safeString(item.payerId)} <button onClick={() => removePayer(item.id)} className="text-rose-400 hover:text-rose-600 ml-1"><X size={10} /></button>
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4"><Badge text={item.questor ? "Sim" : "Não"} color={item.questor ? "blue" : "red"} /></td>
                        <td className="px-6 py-4"><Badge text={item.senior ? "Sim" : "Não"} color={item.senior ? "orange" : "red"} /></td>
                        <td className="px-6 py-4">
                            <div className="flex items-center gap-1.5">
                                <span className={`text-[8px] font-black uppercase ${item.seniorOrigem === 'Matriz' ? 'text-indigo-500' : 'text-slate-400'}`}>{safeString(item.seniorOrigem)}</span>
                                {item.seniorOrigem === 'Matriz' && <button onClick={() => toggleMatrixExclusion(item.id)} className="text-rose-300 hover:text-rose-500" title="Ignorar Matriz"><ShieldOff size={10} /></button>}
                                {item.isExcluded && <button onClick={() => toggleMatrixExclusion(item.id)} className="text-indigo-300 hover:text-indigo-500" title="Reativar Matriz"><RotateCcw size={10} /></button>}
                            </div>
                        </td>
                        <td className="px-6 py-4"><Badge text={safeString(item.gestta)} color={item.gestta.toLowerCase() === 'ativo' ? 'emerald' : 'red'} /></td>
                        <td className="px-6 py-4"><DiagBadge text={safeString(item.diagnostico)} /></td>
                        <td className="px-6 py-4"><Badge text={safeString(item.areaGestta || 'N/A')} color={item.areaGestta ? 'blue' : 'slate'} /></td>
                        <td className="px-6 py-4"><Badge text={safeString(item.areaQuestor || 'N/A')} color={item.areaQuestor ? 'orange' : 'slate'} /></td>
                        <td className="px-6 py-4">
                          <Badge
                            text={safeString(item.confrontoArea)}
                            color={item.confrontoArea === 'OK' ? 'emerald' : item.confrontoArea === 'Divergente' ? 'red' : 'slate'}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'audit' && (
          <div className="bg-white rounded-3xl border shadow-sm overflow-hidden animate-in fade-in">
            <div className="p-6 border-b flex items-center justify-between bg-slate-50">
              <h2 className="font-black text-lg flex items-center gap-2 uppercase tracking-tight leading-none text-indigo-950"><History size={20} className="text-indigo-600" /> Histórico de Atividades</h2>
            </div>
            <div className="overflow-x-auto max-h-[70vh]">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-[10px] font-black uppercase text-slate-500 tracking-widest border-b sticky top-0">
                  <tr>
                    <th className="px-6 py-4">Horário</th>
                    <th className="px-6 py-4">Nome do Usuário</th>
                    <th className="px-6 py-4">Ação</th>
                    <th className="px-6 py-4">Descrição</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {auditLogs.map(log => (
                    <tr key={log.id} className="hover:bg-slate-50 transition-colors group">
                      <td className="px-6 py-4 text-[11px] font-mono text-slate-400 whitespace-nowrap">{formatTimestamp(log.timestamp)}</td>
                      <td className="px-6 py-4 font-black text-indigo-600 uppercase tracking-tighter">{safeString(log.user)}</td>
                      <td className="px-6 py-4"><span className="px-2 py-0.5 bg-slate-100 rounded text-[9px] font-black uppercase border tracking-tighter">{safeString(log.action)}</span></td>
                      <td className="px-6 py-4 text-slate-600 font-medium">{safeString(log.details)}</td>
                    </tr>
                  ))}
                  {auditLogs.length === 0 && (
                    <tr><td colSpan="4" className="px-6 py-20 text-center text-slate-400 italic font-medium">Nenhum evento registrado ainda.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* Modal Pagador */}
      {isPayerModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 text-slate-900">
          <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in duration-200">
            <div className="p-6 border-b flex items-center justify-between bg-slate-50">
              <h3 className="font-black">Vincular Pagador</h3>
              <button onClick={() => setIsPayerModalOpen(false)} className="p-2 hover:bg-slate-200 rounded-full transition-colors"><X size={20} /></button>
            </div>
            <div className="p-4"><div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} /><input autoFocus type="text" placeholder="Busca CNPJ ou Nome..." className="w-full pl-10 pr-4 py-3 border rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800 font-bold" value={payerSearch} onChange={(e) => setPayerSearch(e.target.value)} /></div></div>
            <div className="max-h-80 overflow-y-auto p-2">
              {allConsolidatedData.filter(p => p.nome.toLowerCase().includes(payerSearch.toLowerCase()) || p.id.includes(payerSearch)).slice(0, 50).map(p => (
                <button key={p.id} onClick={() => assignPayer(p.id)} className="w-full text-left p-4 hover:bg-indigo-50 flex justify-between items-center rounded-xl transition-all border border-transparent hover:border-indigo-100 mb-1 group">
                  <div><div className="font-bold text-slate-700 group-hover:text-indigo-700 leading-none">{safeString(p.nome)}</div><div className="text-xs text-slate-400 font-mono mt-1">{safeString(p.id)}</div></div>
                  <UserPlus size={18} className="text-slate-300 group-hover:text-indigo-500" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Componentes Reutilizáveis
const SortHeader = ({ label, sortKey, currentSort, onSort }) => (
  <th className="px-4 py-3 cursor-pointer hover:bg-slate-100 group transition-colors border-r border-slate-100" onClick={() => onSort(sortKey)}>
    <div className="flex items-center gap-2">
      {safeString(label)}
      <div className={`transition-opacity ${currentSort.key === sortKey ? 'opacity-100' : 'opacity-0 group-hover:opacity-40'}`}>{currentSort.direction === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />}</div>
    </div>
  </th>
);

const UploadCard = ({ title, desc, icon: Icon, color, onChange, count, onClear }) => {
  const styles = { blue: 'border-blue-200 text-blue-700', orange: 'border-orange-200 text-orange-700', emerald: 'border-emerald-200 text-emerald-700' };
  return (
    <div className={`p-6 rounded-3xl border-2 border-dashed ${styles[color]} flex flex-col items-center bg-white shadow-sm hover:border-solid transition-all`}>
      <div className="mb-4 p-4 rounded-2xl bg-white shadow-sm border"><Icon size={32} /></div>
      <h4 className="font-black uppercase tracking-tighter text-sm mb-1">{safeString(title)}</h4>
      <p className="text-[10px] opacity-70 font-bold mb-4">{safeString(desc)}</p>
      <div className="relative w-full">
        <input type="file" multiple accept=".csv,.xlsx,.xls,.txt" onChange={onChange} className="absolute inset-0 opacity-0 cursor-pointer z-10" />
        <button className="w-full bg-white py-2 rounded-xl text-xs font-black shadow-sm flex items-center justify-center gap-2 border hover:bg-indigo-50 transition-colors"> <Plus size={14} /> Selecionar </button>
      </div>
      {count > 0 && (
        <div className="mt-4 flex items-center gap-2"><span className="bg-slate-100 px-3 py-1 rounded-full text-[10px] font-black">{count} registros</span><button onClick={onClear} className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg transition-colors border border-transparent hover:border-rose-100" title="Limpar base"><Trash2 size={14} /></button></div>
      )}
    </div>
  );
};

const Badge = ({ text, color, title }) => {
  const styles = { blue: 'bg-blue-100 text-blue-700', red: 'bg-rose-100 text-rose-700', orange: 'bg-orange-100 text-orange-700', emerald: 'bg-emerald-100 text-emerald-700', slate: 'bg-slate-100 text-slate-500' };
  return <span title={title} className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider ${styles[color]}`}>{safeString(text)}</span>;
};

const DiagBadge = ({ text }) => {
  if (text === 'Consistente') return <span className="text-emerald-500 font-bold text-[10px] flex items-center gap-1 uppercase tracking-tighter leading-none"><CheckCircle2 size={12}/> Consistente</span>;
  if (text === 'Divergente') return <span className="text-slate-400 font-bold text-[10px] flex items-center gap-1 uppercase tracking-tighter leading-none"><Info size={12}/> Divergente</span>;
  const isFalta = text.includes('Falta');
  return <span className={`px-3 py-1 rounded-full text-[9px] font-black border shadow-sm leading-none ${isFalta ? 'bg-amber-100 text-amber-800 border-amber-200' : 'bg-rose-100 text-rose-800 border-rose-200'}`}>{safeString(text).toUpperCase()}</span>;
};

export default App;
