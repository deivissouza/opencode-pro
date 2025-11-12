'use client';

import { useEffect, useRef, useState } from 'react';

type Props = {
  onScanSuccess?: (decodedText: string) => void;
  onCode?: (code: string) => void;
  onCancel: () => void;
};

export default function Scanner({ onScanSuccess, onCode, onCancel }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scannerRef = useRef<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!containerRef.current) return;

    let mounted = true;
    let html5qrcode: any = null;
    const elementId = 'innovadp-qr-reader';

    const loadScanner = async () => {
      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
        if (!mounted || !containerRef.current) return;

        const holder = document.createElement('div');
        holder.id = elementId;
        holder.style.width = '100%';
        holder.style.maxWidth = '420px';
        containerRef.current.innerHTML = '';
        containerRef.current.appendChild(holder);

        html5qrcode = new Html5Qrcode(elementId, { verbose: false });
        scannerRef.current = html5qrcode;

        await html5qrcode.start(
          { facingMode: { exact: 'environment' } },
          {
            fps: 10,
            qrbox: { width: 260, height: 260 },
            formatsToSupport: [
              Html5QrcodeSupportedFormats.QR_CODE,
              Html5QrcodeSupportedFormats.CODE_128,
              Html5QrcodeSupportedFormats.CODE_39,
              Html5QrcodeSupportedFormats.CODE_93,
              Html5QrcodeSupportedFormats.EAN_13,
              Html5QrcodeSupportedFormats.EAN_8,
            ],
          },
          (decodedText: string) => {
            const code = decodedText.trim();
            if (!code) return;
            try {
              console.log('[Scanner] código lido:', code);
              onCode?.(code);
              onScanSuccess?.(code);
            } catch (err) {
              console.error('[Scanner] erro ao entregar código:', err);
            }
          },
          () => {
            // erros de leitura são frequentes; ignorar para UX
          }
        );
      } catch (err) {
        console.error('[Scanner] erro ao iniciar câmera:', err);
        setError('Não foi possível acessar a câmera. Verifique permissões e HTTPS.');
      }
    };

    loadScanner();

    return () => {
      mounted = false;
      if (scannerRef.current) {
        scannerRef.current
          .stop()
          .then(() => scannerRef.current?.clear())
          .catch(() => {});
      }
      scannerRef.current = null;
    };
  }, [onCode, onScanSuccess]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-lg border border-slate-200">
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-800">Scanner da Etiqueta</h2>
          <button
            type="button"
            onClick={onCancel}
            className="text-slate-500 hover:text-slate-700 text-sm px-2 py-1 rounded-md hover:bg-slate-100"
          >
            Fechar
          </button>
        </div>
        <div className="p-4 flex flex-col items-center gap-2">
          <div ref={containerRef} className="rounded-md overflow-hidden w-full flex justify-center" />
          {error ? (
            <p className="text-xs text-red-500 text-center">{error}</p>
          ) : (
            <p className="text-[10px] text-slate-500 text-center">
              Aponte para o QR ou código de barras da etiqueta Shopee. Use a câmera traseira.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
