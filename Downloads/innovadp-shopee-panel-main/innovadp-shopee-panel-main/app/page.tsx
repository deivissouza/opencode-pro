"use client";

import { useState, useEffect, useRef, FormEvent } from "react";
import useSWR from "swr";
import dynamic from "next/dynamic";
import Image from "next/image";

// Importa o Scanner de forma dinâmica para evitar erros de SSR
const Scanner = dynamic(() => import("@/components/Scanner"), { ssr: false });

// Ícones
const BoxIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
  </svg>
);
const DollarIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8v1m0 6v1m6-4a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);
const CameraIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
    <path d="M2 6a2 2 0 012-2h1.586a1 1 0 01.707.293l1.414 1.414a1 1 0 00.707.293H12.5A2 2 0 0114.5 6v1H16a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V9a2 2 0 012-2h1.5V6z" />
    <path d="M15 9.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
  </svg>
);

// Tipos
interface OrderItem {
  name: string;
  variation: string;
  sku: string;
  qty: number;
  image?: string;
}
interface ScannedOrder {
  order_sn: string;
  buyer: string;
  items: OrderItem[];
}
interface TodayStats {
  totalOrders: number;
  totalValue: number;
  perHour?: { hour: number; orders: number; value: number }[];
}
interface HistoryItem extends ScannedOrder {
  scanTime: string;
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function HomePage() {
  const [scannedOrder, setScannedOrder] = useState<ScannedOrder | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanInput, setScanInput] = useState("");
  const [isScannerVisible, setIsScannerVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: stats, error: statsError, isValidating } = useSWR<TodayStats>("/api/today", fetcher, { refreshInterval: 60000 });
  const connectionStatus: 'connected' | 'connecting' | 'error' = stats ? 'connected' : statsError ? 'error' : 'connecting';

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleScan = async (code: string) => {
    if (!code) return;
    setIsLoading(true);
    setError(null);
    setScannedOrder(null);
    try {
      const response = await fetch(`/api/scan?code=${encodeURIComponent(code)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Erro na busca do pedido.");
      if (data.notFound) {
        setError("Pedido não encontrado. Verifique o código ou o status na Shopee.");
        return;
      }
      const newOrder: ScannedOrder = data;
      setScannedOrder(newOrder);
      const newHistoryItem: HistoryItem = { ...newOrder, scanTime: new Date().toLocaleTimeString("pt-BR") };
      setHistory([newHistoryItem, ...history.slice(0, 9)]);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Ocorreu um erro desconhecido.";
      setError(errorMessage);
    } finally {
      setIsLoading(false);
      setScanInput("");
      inputRef.current?.focus();
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    handleScan(scanInput);
  };
  const handleScanSuccessFromCamera = (decodedText: string) => {
    setIsScannerVisible(false);
    handleScan(decodedText);
  };
  const formatCurrency = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
  const safeCurrency = (value: unknown) => {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? formatCurrency(n) : formatCurrency(0);
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-800">
      {isScannerVisible && <Scanner onScanSuccess={handleScanSuccessFromCamera} onCancel={() => setIsScannerVisible(false)} />}

      <header className="bg-white/80 backdrop-blur border-b border-slate-200/80 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-bold">IS</div>
            <div>
              <h1 className="text-base font-semibold text-slate-900">InnovadpStore · Painel Shopee</h1>
              <p className="text-xs text-slate-500">Picking, escaneamento e métricas diárias</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={
                connectionStatus === 'connected'
                  ? 'inline-flex items-center gap-2 px-2 py-1 text-xs rounded-md bg-green-50 text-green-700'
                  : connectionStatus === 'error'
                  ? 'inline-flex items-center gap-2 px-2 py-1 text-xs rounded-md bg-red-50 text-red-700'
                  : 'inline-flex items-center gap-2 px-2 py-1 text-xs rounded-md bg-amber-50 text-amber-700'
              }
              title={
                connectionStatus === 'connected'
                  ? 'Conectado à Shopee'
                  : connectionStatus === 'error'
                  ? 'Falha ao conectar à Shopee'
                  : 'Conectando à Shopee...'
              }
            >
              <span
                className={
                  'h-2 w-2 rounded-full ' +
                  (connectionStatus === 'connected'
                    ? 'bg-green-500'
                    : connectionStatus === 'error'
                    ? 'bg-red-500'
                    : 'bg-amber-500')
                }
              />
              {connectionStatus === 'connected' ? 'Conectado' : connectionStatus === 'error' ? 'Erro de conexão' : 'Conectando...'}
            </span>
            <span className="px-2 py-1 text-xs rounded-md bg-slate-100 text-slate-600">Beta</span>
            <button type="button" onClick={() => setIsScannerVisible(true)} className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
              <CameraIcon /> Escanear
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
        {statsError && (
          <div className="mb-4">
            <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 p-3 text-xs">
              <span className="font-semibold">Erro de conexão com a Shopee.</span>
              <span className="ml-1">Verifique as variáveis em Produção no Vercel: </span>
              <code className="bg-white/60 px-1 py-0.5 rounded">SHOPEE_PARTNER_ID</code>,
              <code className="bg-white/60 px-1 py-0.5 rounded ml-1">SHOPEE_PARTNER_KEY</code>,
              <code className="bg-white/60 px-1 py-0.5 rounded ml-1">SHOPEE_SHOP_ID</code>,
              <code className="bg-white/60 px-1 py-0.5 rounded ml-1">SHOPEE_ACCESS_TOKEN</code>.
              <span className="ml-1">Após ajustar, faça um Redeploy.</span>
              <a href="/api/today" className="ml-2 underline">/api/today</a>
            </div>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6">
          <div className="bg-white p-5 rounded-xl border border-slate-200/80 shadow-sm flex items-center gap-5">
            <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600"><BoxIcon /></div>
            <div>
              <h3 className="text-xs font-semibold text-slate-500">PEDIDOS DO DIA • READY_TO_SHIP</h3>
              <p className="text-3xl font-bold text-slate-900">{stats ? stats.totalOrders : <span className="inline-block h-8 w-16 rounded bg-slate-200 animate-pulse" />}</p>
            </div>
          </div>
          <div className="bg-white p-5 rounded-xl border border-slate-200/80 shadow-sm flex items-center gap-5">
            <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600"><DollarIcon /></div>
            <div>
              <h3 className="text-xs font-semibold text-slate-500">FATURAMENTO DO DIA (ESTIMADO)</h3>
              <p className="text-3xl font-bold text-slate-900">{stats ? safeCurrency(stats.totalValue) : <span className="inline-block h-8 w-24 rounded bg-slate-200 animate-pulse" />}</p>
            </div>
          </div>
        </div>

        {/* Gráfico de barras: pedidos por hora */}
        <div className="bg-white p-5 rounded-xl border border-slate-200/80 shadow-sm mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-900">Pedidos por Hora (Hoje)</h3>
            <span className="text-xs text-slate-500">Atualiza a cada 60s</span>
          </div>
          {stats?.perHour && stats.perHour.length > 0 ? (
            <div className="h-32">
              {(() => {
                const values = stats.perHour!.map((h) => h.orders);
                const max = Math.max(1, ...values);
                const barW = 100 / values.length;
                const bars = values.map((v, i) => {
                  const x = i * barW + barW * 0.15; // gap
                  const height = (v / max) * 100;
                  const y = 100 - height;
                  const w = barW * 0.7;
                  return <rect key={i} x={x} y={y} width={w} height={height} fill="#4f46e5" rx={0.8} />; // indigo-600
                });
                return (
                  <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
                    <g>
                      <line x1="0" x2="100%" y1="25%" y2="25%" stroke="#e5e7eb" strokeWidth="1" />
                      <line x1="0" x2="100%" y1="50%" y2="50%" stroke="#e5e7eb" strokeWidth="1" />
                      <line x1="0" x2="100%" y1="75%" y2="75%" stroke="#e5e7eb" strokeWidth="1" />
                    </g>
                    {bars}
                  </svg>
                );
              })()}
            </div>
          ) : (
            <p className="text-sm text-slate-500">Sem dados suficientes para o gráfico.</p>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 flex flex-col gap-6">
            <div className="bg-white p-5 rounded-xl border border-slate-200/80 shadow-sm">
              <h2 className="font-semibold text-slate-900 mb-1">Escanear Pedido</h2>
              <p className="text-xs text-slate-500 mb-4">Bipe a etiqueta oficial ou digite o código do pedido.</p>
              <form onSubmit={handleSubmit} className="space-y-3">
                <input ref={inputRef} type="text" value={scanInput} onChange={(e) => setScanInput(e.target.value)} placeholder="Aguarde a leitura ou digite..." className="w-full p-3 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition" disabled={isLoading} />
                <button type="submit" className="w-full bg-indigo-600 text-white font-bold py-3 rounded-lg hover:bg-indigo-700 transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed flex items-center justify-center gap-2" disabled={isLoading}>{isLoading ? "Buscando..." : "Buscar Pedido"}</button>
                <button type="button" onClick={() => setIsScannerVisible(true)} className="w-full bg-white text-slate-700 font-bold py-3 rounded-lg border border-slate-300 hover:bg-slate-50 transition-colors flex items-center justify-center gap-2"><CameraIcon />Escanear com a Câmera</button>
              </form>
            </div>

            <div className="bg-white p-5 rounded-xl border border-slate-200/80 shadow-sm">
              <h2 className="font-semibold text-slate-900 mb-4">Últimos Scans</h2>
              {history.length === 0 ? <p className="text-sm text-slate-500">Nenhum pedido escaneado ainda.</p> : (
                <ul className="divide-y divide-slate-100">
                  {history.map((item) => (
                    <li key={item.order_sn} className="py-2 text-sm">
                      <div className="flex items-center justify-between">
                        <p className="font-semibold truncate text-slate-700">SN: {item.order_sn}</p>
                        <span className="px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-600">{item.scanTime}</span>
                      </div>
                      <div className="flex justify-between text-slate-500 mt-1">
                        <span className="truncate">Comprador: {item.buyer}</span>
                        <span>{item.items.length} item(s)</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200/80 shadow-sm min-h-[400px]">
            <div className="p-5 md:p-6 border-b border-slate-200/80">
              <h2 className="font-semibold text-slate-900">Detalhes do Pedido Escaneado</h2>
            </div>
            <div className="p-5 md:p-6">
              {isLoading && <p className="text-center text-slate-500">Buscando dados do pedido...</p>}
              {error && <p className="text-center text-red-500 font-semibold bg-red-100/50 p-4 rounded-lg">{error}</p>}
              {!isLoading && !error && !scannedOrder && (
                <div className="text-center text-slate-400 mt-10">
                  <p className="font-semibold">Bipe uma etiqueta oficial da Shopee</p>
                  <p className="text-sm">Os produtos e quantidades aparecerão aqui.</p>
                </div>
              )}
              {scannedOrder && (
                <div>
                  <div className="mb-6">
                    <p className="text-xs text-slate-500">Order SN</p>
                    <p className="font-mono text-base font-semibold text-slate-800">{scannedOrder.order_sn}</p>
                    <p className="text-xs text-slate-500 mt-2">Comprador</p>
                    <p className="font-semibold text-slate-800">{scannedOrder.buyer}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center rounded-full bg-slate-100 text-slate-700 px-2.5 py-0.5 text-xs">{scannedOrder.items.length} itens</span>
                      <span className="inline-flex items-center rounded-full bg-indigo-50 text-indigo-700 px-2.5 py-0.5 text-xs">Qtd total: {scannedOrder.items.reduce((acc, it) => acc + it.qty, 0)}</span>
                    </div>
                  </div>
                  <h3 className="font-semibold text-slate-900 mb-3">Itens do Pedido:</h3>
                  <ul className="space-y-3">
                    {scannedOrder.items.map((item, index) => (
                      <li key={index} className="flex items-center gap-4 p-3 rounded-lg even:bg-slate-50/80">
                        <div className="w-16 h-16 bg-slate-100 border border-slate-200 rounded-md flex-shrink-0 flex items-center justify-center overflow-hidden">
                          {item.image ? (
                            <Image
                              src={item.image}
                              alt={item.name}
                              width={64}
                              height={64}
                              className="w-full h-full object-cover rounded-md"
                            />
                          ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l-1.586-1.586a2 2 0 00-2.828 0L6 14" /></svg>
                          )}
                        </div>
                        <div className="flex-grow text-sm">
                          <p className="font-semibold text-slate-800">{item.name}</p>
                          <p className="text-slate-600">{item.variation}</p>
                          <p className="font-mono text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-full inline-block mt-1">SKU: {item.sku}</p>
                        </div>
                        <div className="flex-shrink-0 text-center ml-auto">
                          <p className="text-xs text-slate-500">Qtd.</p>
                          <p className="text-3xl font-bold text-indigo-600">{item.qty}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
        <footer className="text-center text-xs text-slate-400 mt-10">
          <p>InnovadpStore/Nolix · Dados via Shopee Open Platform v2</p>
        </footer>
      </main>
    </div>
  );
}
