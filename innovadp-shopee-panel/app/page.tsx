"use client";

import Image from "next/image";
import { useState, useEffect, useRef, FormEvent, type ReactNode } from "react";
import useSWR from "swr";
import dynamic from "next/dynamic";

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
const LightningIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const ChartIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M3 3v18h18" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M7 13l4-4 4 4 4-6" strokeLinecap="round" strokeLinejoin="round" />
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
  paymentMethod: string;
  shippingCarrier: string;
  note: string;
  payTime: string;
  recipientCity: string;
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

const SCAN_PARAM_KEYS = new Set([
  "order_sn",
  "ordersn",
  "order",
  "orderid",
  "sn",
  "o",
  "code",
  "c",
  "tracking_no",
  "trackingno",
  "tracking",
  "trackingid",
  "tn",
  "waybill",
  "awb",
  "package",
  "package_no",
  "package_sn",
  "packageno",
  "packagesn",
  "pkg",
  "pkgno",
  "pkg_sn",
]);

const sanitizeCandidate = (value: string) => value.replace(/[^A-Z0-9]/gi, "").toUpperCase();
const isLikelyShopeeCode = (value: string) => {
  if (!value) return false;
  if (/^BR[A-Z0-9]{8,}$/i.test(value)) return true;
  if (/^[A-Z0-9]{12,25}$/i.test(value)) return true;
  if (/^\d{9,25}$/.test(value)) return true;
  return false;
};

const extractCodeFromScan = (raw: string) => {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";

  const tryCandidate = (val?: string | null) => {
    const clean = sanitizeCandidate(val ?? "");
    return isLikelyShopeeCode(clean) ? clean : "";
  };
  const tryStructuredCandidate = (value: string) => {
    try {
      const structured = JSON.parse(value);
      const search = (node: unknown): string => {
        if (typeof node === "string" || typeof node === "number") {
          return tryCandidate(String(node));
        }
        if (Array.isArray(node)) {
          for (const entry of node) {
            const candidate = search(entry);
            if (candidate) return candidate;
          }
        } else if (node && typeof node === "object") {
          const entries = Object.entries(node as Record<string, unknown>);
          for (const [key, child] of entries) {
            if (SCAN_PARAM_KEYS.has(key.toLowerCase())) {
              const candidate = search(child);
              if (candidate) return candidate;
            }
          }
          for (const [, child] of entries) {
            const candidate = search(child);
            if (candidate) return candidate;
          }
        }
        return "";
      };
      return search(structured);
    } catch {
      return "";
    }
  };

  try {
    const url = new URL(trimmed);
    for (const key of Array.from(SCAN_PARAM_KEYS)) {
      const value = url.searchParams.get(key);
      const candidate = tryCandidate(value);
      if (candidate) return candidate;
    }
    const segments = url.pathname.split("/").filter(Boolean).reverse();
    for (const segment of segments) {
      const candidate = tryCandidate(segment);
      if (candidate) return candidate;
    }
  } catch {
    // not a URL, ignore
  }

  const structuredCandidate = tryStructuredCandidate(trimmed);
  if (structuredCandidate) return structuredCandidate;

  const looksBase64 =
    /^[A-Za-z0-9+/=]+$/.test(trimmed) && trimmed.length % 4 === 0 && trimmed.length >= 16;
  if (looksBase64 && typeof atob === "function") {
    try {
      const decoded = atob(trimmed);
      const candidate = tryStructuredCandidate(decoded) || tryCandidate(decoded);
      if (candidate) return candidate;
    } catch {
      // ignore
    }
  }

  const labeledParts = trimmed.split(/[\s,;\n\r]+/);
  for (const part of labeledParts) {
    const [rawKey, rawValue] = part.split(/[:=]/, 2);
    if (!rawValue) continue;
    const key = rawKey?.toLowerCase();
    if (key && SCAN_PARAM_KEYS.has(key)) {
      const candidate = tryCandidate(rawValue);
      if (candidate) return candidate;
    }
  }

  const tokens = trimmed
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  for (const token of tokens) {
    const candidate = tryCandidate(token);
    if (candidate) return candidate;
  }

  return tryCandidate(trimmed);
};

const statusStyles = {
  connected: {
    label: "Online",
    badge: "bg-emerald-500/15 text-emerald-200 border border-emerald-500/30",
  },
  connecting: {
    label: "Sincronizando",
    badge: "bg-amber-500/15 text-amber-200 border border-amber-500/30",
  },
  error: {
    label: "Offline",
    badge: "bg-rose-500/15 text-rose-200 border border-rose-500/30",
  },
} as const;

type StatsCardProps = {
  title: string;
  value: string;
  helper?: string;
  footnote?: string;
  badge?: { label: string; tone: string };
  icon?: ReactNode;
};

const StatsCard = ({ title, value, helper, footnote, badge, icon }: StatsCardProps) => (
  <div className="rounded-3xl bg-gradient-to-br from-slate-900/70 to-slate-900/30 border border-white/5 shadow-lg shadow-slate-900/20 p-5">
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-semibold text-slate-400">{title}</p>
        <p className="mt-3 text-3xl font-semibold text-white tracking-tight">{value}</p>
      </div>
      <div className="shrink-0 rounded-2xl bg-white/5 p-3 text-indigo-300">{icon}</div>
    </div>
    <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
      <span>{helper}</span>
      {badge ? (
        <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-semibold uppercase ${badge.tone}`}>
          {badge.label}
        </span>
      ) : null}
    </div>
    {footnote ? <p className="mt-2 text-xs text-slate-500">{footnote}</p> : null}
  </div>
);

const formatHourLabel = (hour: number) => `${String(hour).padStart(2, "0")}h`;

const HISTORY_STORAGE_KEY = "innovadp-shopee-panel:history";

export default function HomePage() {
  const [scannedOrder, setScannedOrder] = useState<ScannedOrder | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isHistoryLoaded, setIsHistoryLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanInput, setScanInput] = useState("");
  const [isScannerVisible, setIsScannerVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: stats, error: statsError, isValidating } = useSWR<TodayStats>("/api/today", fetcher, { refreshInterval: 60000 });
  const connectionStatus: 'connected' | 'connecting' | 'error' = stats ? 'connected' : statsError ? 'error' : 'connecting';

  useEffect(() => {
    inputRef.current?.focus();
    try {
      const savedHistory = localStorage.getItem(HISTORY_STORAGE_KEY);
      if (savedHistory) {
        setHistory(JSON.parse(savedHistory));
      }
    } catch (error) {
      console.error("Failed to load history from localStorage", error);
    }
    setIsHistoryLoaded(true);
  }, []);

  useEffect(() => {
    if (!isHistoryLoaded) {
      return;
    }
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
    } catch (error) {
      console.error("Failed to save history to localStorage", error);
    }
  }, [history, isHistoryLoaded]);

  const formatCurrency = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
  const safeCurrency = (value: unknown) => {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? formatCurrency(n) : formatCurrency(0);
  };
  const formatNumber = (value: number, decimals = 0) =>
    value.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

  const hourlySeries = Array.from({ length: 24 }, (_, hour) => {
    const match = stats?.perHour?.find((entry) => entry.hour === hour);
    return {
      hour,
      orders: match?.orders ?? 0,
      value: match?.value ?? 0,
    };
  });
  const totalOrders = stats?.totalOrders ?? 0;
  const totalValue = stats?.totalValue ?? 0;
  const avgTicketValue = totalOrders > 0 ? totalValue / totalOrders : 0;
  const activeHours = hourlySeries.filter((entry) => entry.orders > 0).length || (totalOrders > 0 ? 1 : 0);
  const orderVelocity = activeHours ? totalOrders / activeHours : 0;
  const peakHour = hourlySeries.reduce(
    (best, entry) => (entry.orders > best.orders ? entry : best),
    { hour: 0, orders: 0, value: 0 }
  );
  const topHours = [...hourlySeries].sort((a, b) => b.orders - a.orders).slice(0, 6);
  const maxOrders = Math.max(1, ...hourlySeries.map((entry) => entry.orders));
  const totalItemsScanned = history.reduce(
    (sum, item) => sum + item.items.reduce((count, orderItem) => count + orderItem.qty, 0),
    0
  );
  const lastScanTime = history[0]?.scanTime;
  const connectionBadge = statusStyles[connectionStatus];
  const topHourOrders = topHours[0]?.orders ?? 1;
  const hasHourlyData = hourlySeries.some((entry) => entry.orders > 0);
  const statsCards: StatsCardProps[] = [
    {
      title: "Pedidos confirmados",
      value: totalOrders ? formatNumber(totalOrders) : "--",
      helper: peakHour.orders ? `Pico às ${formatHourLabel(peakHour.hour)}` : "Aguardando novos pedidos",
      badge: connectionBadge ? { label: connectionBadge.label, tone: connectionBadge.badge } : undefined,
      icon: <BoxIcon />,
    },
    {
      title: "Faturamento estimado",
      value: safeCurrency(totalValue),
      helper: totalOrders ? `Ticket médio de ${safeCurrency(avgTicketValue)}` : "Sem base para cálculo",
      icon: <DollarIcon />,
      badge: { label: isValidating ? "Atualizando..." : "Shopee v2", tone: "bg-indigo-500/15 text-indigo-200 border border-indigo-500/30" },
    },
    {
      title: "Velocidade de picking",
      value: totalOrders ? `${formatNumber(orderVelocity, 1)}/h` : "--",
      helper: activeHours ? `${activeHours} hora(s) ativa(s)` : "Sem movimentação",
      icon: <LightningIcon />,
      footnote: peakHour.orders ? `Maior lote com ${formatNumber(peakHour.orders)} pedidos` : undefined,
    },
    {
      title: "Leituras nesta sessão",
      value: formatNumber(history.length),
      helper: totalItemsScanned ? `${formatNumber(totalItemsScanned)} itens conferidos` : "Nenhum item conferido",
      icon: <CameraIcon />,
      footnote: lastScanTime ? `Último scan às ${lastScanTime}` : "Inicie um scan para preencher",
    },
  ];

  const handleScan = async (rawCode: string) => {
    const code = extractCodeFromScan(rawCode);
    if (!code) {
      setError("Codigo lido indisponivel. Aproxime a camera ou informe apenas o Order SN / rastreio.");
      setScanInput("");
      inputRef.current?.focus();
      return;
    }
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

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {isScannerVisible && (
        <Scanner onScanSuccess={handleScanSuccessFromCamera} onCancel={() => setIsScannerVisible(false)} />
      )}

      <header className="sticky top-0 z-30 border-b border-white/10 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10 text-sm font-bold tracking-tight text-white">
              IS
            </div>
            <div>
              <p className="text-sm font-semibold text-white">InnovadpStore · Painel Operacional</p>
              <p className="text-xs text-slate-400">Shopee Open Platform v2 · monitoramento em tempo real</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${connectionBadge?.badge ?? ""}`}
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "currentColor" }} />
              {connectionBadge?.label ?? "Status desconhecido"}
            </span>
            <button
              type="button"
              onClick={() => setIsScannerVisible(true)}
              className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              <CameraIcon /> Abrir câmera
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-8 px-4 py-8">
        {statsError && (
          <div className="rounded-3xl border border-rose-500/40 bg-rose-500/10 p-5 text-sm text-rose-100">
            <p className="font-semibold">Erro ao sincronizar com a Shopee.</p>
            <p className="mt-1">
              Confirme as variáveis
              <code className="mx-1 rounded bg-white/10 px-1 py-0.5 text-[11px] font-mono">SHOPEE_PARTNER_ID</code>
              <code className="mx-1 rounded bg-white/10 px-1 py-0.5 text-[11px] font-mono">SHOPEE_PARTNER_KEY</code>
              <code className="mx-1 rounded bg-white/10 px-1 py-0.5 text-[11px] font-mono">SHOPEE_SHOP_ID</code>
              <code className="mx-1 rounded bg-white/10 px-1 py-0.5 text-[11px] font-mono">SHOPEE_ACCESS_TOKEN</code>
              e faça novo deploy.
            </p>
            <a href="/api/today" className="mt-2 inline-flex text-xs font-semibold text-rose-200 underline">
              Abrir /api/today
            </a>
          </div>
        )}

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {statsCards.map((card) => (
            <StatsCard key={card.title} {...card} />
          ))}
        </section>

        <section className="grid gap-6 lg:grid-cols-3">
          <div className="rounded-3xl border border-white/5 bg-slate-900/60 p-6 lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white">Fluxo por hora</p>
                <p className="text-xs text-slate-400">Pedidos atualizados automaticamente a cada 60s</p>
              </div>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
                <ChartIcon /> Monitor ao vivo
              </span>
            </div>
            {hasHourlyData ? (
              <div className="mt-6 overflow-x-auto">
                <div className="min-w-[720px]">
                  <div className="flex h-48 items-end gap-3 pb-2">
                    {hourlySeries.map((entry) => (
                      <div key={entry.hour} className="flex flex-col items-center gap-2 text-[11px] text-slate-400">
                        <span className="text-slate-100">
                          {entry.orders ? formatNumber(entry.orders) : ""}
                        </span>
                        <div
                          className="w-6 rounded-full bg-gradient-to-t from-indigo-600 via-sky-500 to-emerald-400 transition-all"
                          style={{
                            height: `${Math.max(4, (entry.orders / maxOrders) * 100)}%`,
                            opacity: entry.orders ? 1 : 0.18,
                          }}
                        />
                        <span className="uppercase tracking-wide">{formatHourLabel(entry.hour)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <p className="mt-6 text-sm text-slate-400">Ainda não há registros horários para hoje.</p>
            )}
          </div>
          <div className="rounded-3xl border border-white/5 bg-slate-900/60 p-6">
            <p className="text-sm font-semibold text-white">Insights rápidos</p>
            <ul className="mt-4 space-y-4 text-sm text-slate-300">
              <li className="flex items-center justify-between">
                <span>Ticket médio</span>
                <span className="font-semibold text-white">{safeCurrency(avgTicketValue)}</span>
              </li>
              <li className="flex items-center justify-between">
                <span>Maior volume</span>
                <span className="text-white">
                  {peakHour.orders ? `${formatNumber(peakHour.orders)} pedidos às ${formatHourLabel(peakHour.hour)}` : "--"}
                </span>
              </li>
              <li className="flex items-center justify-between">
                <span>Valor no pico</span>
                <span className="font-semibold text-white">{safeCurrency(peakHour.value)}</span>
              </li>
              <li className="flex items-center justify-between">
                <span>Horas ativas</span>
                <span className="text-white">{activeHours || 0}</span>
              </li>
              <li className="flex items-center justify-between">
                <span>Última leitura</span>
                <span className="text-white">{lastScanTime ?? "Sem dados"}</span>
              </li>
            </ul>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-3">
          <div className="rounded-3xl border border-white/5 bg-slate-900/60 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-white">Centro de escaneamento</p>
                <p className="text-xs text-slate-400">Leia via câmera ou digite o SN/rastreio manualmente.</p>
              </div>
            </div>
            <form onSubmit={handleSubmit} className="mt-6 space-y-3">
              <label className="text-xs uppercase tracking-wide text-slate-400">Inserir código manualmente</label>
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  ref={inputRef}
                  type="text"
                  value={scanInput}
                  onChange={(e) => setScanInput(e.target.value)}
                  placeholder="SN, rastreio BR ou link completo"
                  className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none"
                />
                <button
                  type="submit"
                  className="rounded-2xl bg-indigo-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition hover:bg-indigo-400"
                >
                  Buscar pedido
                </button>
              </div>
            </form>
            <div className="mt-4 flex flex-wrap gap-3 text-sm">
              <button
                type="button"
                onClick={() => setIsScannerVisible(true)}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-white transition hover:bg-white/10"
              >
                <CameraIcon /> Escanear etiqueta
              </button>
              <button
                type="button"
                onClick={() => setScanInput("")}
                className="rounded-2xl border border-white/10 bg-transparent px-4 py-2 text-slate-300 transition hover:text-white"
              >
                Limpar campo
              </button>
            </div>
            <div className="mt-4 text-xs text-slate-400">
              {isLoading ? "Consultando Shopee..." : "Pronto para a próxima leitura"}
            </div>
          </div>

          <div className="rounded-3xl border border-white/5 bg-slate-900/60 p-6 lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 pb-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Order SN</p>
                <p className="font-mono text-lg text-white">{scannedOrder?.order_sn ?? "—"}</p>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs">
                <BoxIcon /> {scannedOrder ? `${scannedOrder.items.length} SKU(s)` : "Aguardando leitura"}
              </div>
            </div>
            <div className="space-y-4 pt-4">
              {isLoading && <p className="text-center text-sm text-slate-400">Buscando dados do pedido...</p>}
              {error && (
                <p className="rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-center text-sm text-rose-100">
                  {error}
                </p>
              )}
              {!isLoading && !error && !scannedOrder && (
                <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 px-4 py-8 text-center text-sm text-slate-400">
                  Escaneie uma etiqueta oficial da Shopee para preencher este painel.
                </div>
              )}
              {scannedOrder && (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-5 text-sm">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-slate-500">Comprador</p>
                      <p className="font-semibold text-white">{scannedOrder.buyer}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-slate-500">Cidade</p>
                      <p className="font-semibold text-white">{scannedOrder.recipientCity || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-slate-500">Pagamento</p>
                      <p className="font-semibold text-white">{scannedOrder.paymentMethod}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-slate-500">Transportadora</p>
                      <p className="font-semibold text-white">{scannedOrder.shippingCarrier}</p>
                    </div>
                  </div>
                  {scannedOrder.note && (
                    <div>
                      <p className="text-xs uppercase tracking-wide text-slate-500">Nota do comprador</p>
                      <p className="mt-1 rounded-lg bg-slate-800/50 p-3 text-sm text-slate-300">{scannedOrder.note}</p>
                    </div>
                  )}
                  <ul className="space-y-3 pt-5">
                    {scannedOrder.items.map((item, index) => (
                      <li key={index} className="flex items-center gap-4 rounded-2xl border border-white/5 bg-white/5 p-3">
                        <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl border border-white/5 bg-slate-900/60">
                          {item.image ? (
                            <Image src={item.image} alt={item.name} width={64} height={64} className="h-full w-full object-cover" unoptimized />
                          ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l-1.586-1.586a2 2 0 00-2.828 0L6 14" />
                            </svg>
                          )}
                        </div>
                        <div className="flex-1 text-sm">
                          <p className="font-semibold text-white">{item.name}</p>
                          <p className="text-slate-400">{item.variation || "Padrão"}</p>
                          <p className="mt-1 inline-flex rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-mono text-slate-300">
                            SKU: {item.sku}
                          </p>
                        </div>
                        <div className="text-center">
                          <p className="text-xs text-slate-400">Qtd.</p>
                          <p className="text-2xl font-bold text-indigo-400">{item.qty}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-3xl border border-white/5 bg-slate-900/60 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-white">Últimos scans</p>
                <p className="text-xs text-slate-400">Histórico da sessão (máx. 10 leituras)</p>
              </div>
              {history.length ? (
                <button
                  type="button"
                  onClick={() => setHistory([])}
                  className="text-xs text-slate-400 underline-offset-4 hover:text-white hover:underline"
                >
                  Limpar histórico
                </button>
              ) : null}
            </div>
            <div className="mt-4 space-y-3">
              {history.length ? (
                history.map((item) => {
                  const totalQty = item.items.reduce((sum, orderItem) => sum + orderItem.qty, 0);
                  return (
                    <div key={`${item.order_sn}-${item.scanTime}`} className="flex items-center justify-between gap-4 rounded-2xl border border-white/5 bg-white/5 p-4">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-white">{item.order_sn}</p>
                        <p className="text-xs text-slate-400">Comprador: {item.buyer}</p>
                      </div>
                      <div className="text-right text-xs text-slate-400">
                        <p className="font-semibold text-white">{item.items.length} SKU(s)</p>
                        <p>{totalQty} un • {item.scanTime}</p>
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="rounded-2xl border border-dashed border-white/10 bg-white/5 p-4 text-sm text-slate-400">
                  Nenhum scan registrado nesta sessão.
                </p>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-white/5 bg-slate-900/60 p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white">Períodos mais fortes</p>
                <p className="text-xs text-slate-400">Horas com maior concentração de pedidos</p>
              </div>
            </div>
            {topHours.some((entry) => entry.orders > 0) ? (
              <ul className="mt-5 space-y-4">
                {topHours.filter((entry) => entry.orders > 0).map((entry) => (
                  <li key={entry.hour} className="flex items-center gap-3">
                    <div className="w-14 rounded-2xl bg-white/10 px-3 py-2 text-center text-xs font-semibold text-white">
                      {formatHourLabel(entry.hour)}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between text-xs text-slate-300">
                        <span>{formatNumber(entry.orders)} pedido(s)</span>
                        <span className="font-semibold text-white">{safeCurrency(entry.value)}</span>
                      </div>
                      <div className="mt-2 h-1.5 rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-amber-400"
                          style={{ width: `${Math.max(5, (entry.orders / topHourOrders) * 100)}%` }}
                        />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-5 rounded-2xl border border-dashed border-white/10 bg-white/5 p-4 text-sm text-slate-400">
                Ainda não identificamos picos para o dia.
              </p>
            )}
          </div>
        </section>

        <footer className="py-6 text-center text-xs text-slate-500">
          InnovadpStore · Dados alimentados pela Shopee Open Platform v2 · Atualização contínua a cada 60 segundos
        </footer>
      </main>
    </div>
  );
}
