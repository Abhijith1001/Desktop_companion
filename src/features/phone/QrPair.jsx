import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../../services/api';
import { useToasts } from '../../stores';

const TEXT = {
  waiting: 'On the phone: Wireless debugging → Pair device with QR code, then scan this.',
  pairing: 'Phone found. Pairing…',
  connecting: 'Paired. Connecting…',
};

// One-time QR code for Android's "Pair device with QR code". The main process
// watches for the phone that scanned it and pairs and connects on its own.
export default function QrPair({ onDone }) {
  const toast = useToasts((s) => s.push);
  const [image, setImage] = useState(null);
  const [state, setState] = useState('idle');

  useEffect(() => {
    const off = api.phone.onQr((e) => {
      setState(e.state);
      if (e.state === 'done') {
        setImage(null);
        toast(e.serial ? 'Phone paired and connected. Click Mirror to start.' : 'Paired! Now press Connect with the address on the Wireless debugging screen.', 'success');
        onDone?.();
      } else if (e.state === 'error') {
        setImage(null);
        toast(e.message, 'error');
      }
    });
    return () => { off(); api.phone.qrCancel().catch(() => {}); };
  }, [onDone, toast]);

  async function show() {
    try {
      const { payload } = await api.phone.qrStart();
      setImage(await QRCode.toDataURL(payload, { width: 220, margin: 2, errorCorrectionLevel: 'M' }));
      setState('waiting');
    } catch (err) { toast(err.message, 'error'); }
  }

  function cancel() {
    api.phone.qrCancel().catch(() => {});
    setImage(null);
    setState('idle');
  }

  if (!image) {
    return <button type="button" className="btn-primary mt-3" onClick={show}>Show QR code to pair</button>;
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-4 rounded-xl border border-stone-200 p-3 dark:border-stone-800">
      {/* White backing so the code scans in dark mode too. */}
      <img src={image} alt="Pairing QR code" width={180} height={180} className="rounded-lg bg-white" />
      <div className="min-w-0 flex-1 space-y-2 text-sm">
        <p aria-live="polite">{TEXT[state] || TEXT.waiting}</p>
        <p className="text-xs text-stone-500 dark:text-stone-400">The code works once and expires after 2 minutes.</p>
        <div className="flex gap-2">
          <button type="button" className="btn-outline" onClick={show}>New code</button>
          <button type="button" className="btn-ghost" onClick={cancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
