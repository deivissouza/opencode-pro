'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Props = {
  onScanSuccess?: (decodedText: string) => void;
  onCode?: (code: string) => void;
  onCancel: () => void;
};

export default function Scanner({ onScanSuccess, onCode, onCancel }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scannerRef = useRef<any>(null);
  const handledResultRef = useRef(false);
  const [error, setError] = useState('');

  const disposeScanner = useCallback(async () => {
    if (!scannerRef.current) return;

    try {
      await scannerRef.current.stop();
    } catch (stopErr) {
      console.warn('[Scanner] stop error', stopErr);
    }

    try {
      await scannerRef.current.clear();
    } catch (clearErr) {
      console.warn('[Scanner] clear error', clearErr);
    }

    scannerRef.current = null;
    handledResultRef.current = false;
  }, []);

  useEffect(() => {
    let mounted = true;
    const elementId = 'innovadp-qr-reader';

    const loadScanner = async () => {
      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
        if (!mounted || !containerRef.current) return;

        await disposeScanner();

        const holder = document.createElement('div');
        holder.id = elementId;
        holder.style.width = '100%';
        holder.style.maxWidth = '420px';
        containerRef.current.innerHTML = '';
        containerRef.current.appendChild(holder);

        const html5qrcode = new Html5Qrcode(elementId, {
          verbose: false,
          formatsToSupport: [
            Html5QrcodeSupportedFormats.QR_CODE,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.CODE_93,
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
          ],
        });
        scannerRef.current = html5qrcode;
        handledResultRef.current = false;

        await html5qrcode.start(
          { facingMode: { exact: 'environment' } },
          {
            fps: 10,
            qrbox: { width: 260, height: 260 },
            disableFlip: true,
          },
          async (decodedText: string) => {
            const code = decodedText.trim();
            if (!code || handledResultRef.current) return;

            handledResultRef.current = true;

            try {
              console.log('[Scanner] código lido:', code);
              onCode?.(code);
              onScanSuccess?.(code);
            } catch (err) {
              console.error('[Scanner] erro ao entregar código:', err);
            } finally {
              await disposeScanner();
            }
          },
          () => {
            // erros de leitura são frequentes; ignorar para UX
          }
        );
      } catch (err) {
        if (!mounted) return;
        console.error('[Scanner] erro ao iniciar câmera:', err);
        setError('Não foi possível acessar a câmera. Verifique permissões e HTTPS.');
      }
    };

    loadScanner();

    return () => {
      mounted = false;
      void disposeScanner();
    };
  }, [disposeScanner, onCode, onScanSuccess]);

  const handleCancel = () => {
    void disposeScanner().finally(() => onCancel());
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-white/20 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <div>
            <p className="text-sm font-semibold text-slate-900">Scanner da Etiqueta</p>
            <p className="text-xs text-slate-500">Aponte para o QR ou código de barras</p>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            className="text-slate-500 hover:text-slate-800 text-sm px-2 py-1 rounded-md hover:bg-slate-100 transition-colors"
          >
            Fechar
          </button>
        </div>
        <div className="p-5 flex flex-col items-center gap-4">
          <div
            ref={containerRef}
            className="w-full rounded-xl overflow-hidden bg-slate-900/90 flex justify-center"
          />
          {error ? (
            <p className="text-sm text-red-500 text-center">{error}</p>
          ) : (
            <p className="text-xs text-slate-500 text-center">
              Permita o acesso à câmera e mantenha a etiqueta estável para uma leitura rápida.
            </p>
          )}
          <button
            type="button"
            onClick={handleCancel}
            className="w-full rounded-full bg-white text-slate-900 font-semibold py-2 text-sm shadow hover:bg-slate-50 transition-colors"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
