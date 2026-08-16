import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nContext.jsx';

export function OfflineBanner() {
  const { t } = useI18n();
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    const on = () => {
      setOnline(true);
      setFlash(true);
      setTimeout(() => setFlash(false), 2500);
    };
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  if (online && !flash) return null;

  return (
    <div
      className={
        online
          ? 'bg-emerald-600 px-4 py-1.5 text-center text-xs font-medium text-white'
          : 'bg-amber-500 px-4 py-1.5 text-center text-xs font-medium text-amber-950'
      }
    >
      {online ? t('online') : t('offline')}
    </div>
  );
}

export default OfflineBanner;
