import { Suspense, useEffect } from 'react';
import { Toaster } from 'react-hot-toast';
import { SettingsProvider } from '../../shared/context/SettingsContext';
import { loadTaxiFonts } from '../../shared/utils/loadTaxiFonts';
import '../../styles/taxi.css';
import './styles/adminTheme.css';

const fallback = (
  <div className="flex min-h-[40vh] items-center justify-center">
    <span className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-gray-500" />
  </div>
);

/**
 * Wraps the taxi admin pages inside the platform admin shell. The sidebar, header and sign-in belong
 * to the platform admin; this only supplies what the taxi pages need around them: their styles
 * (scoped, so nothing leaks into Food / Quick Commerce), their settings context and a loader.
 */
export default function TaxiAdminFrame({ children }) {
  useEffect(() => {
    loadTaxiFonts();
  }, []);

  return (
    <SettingsProvider>
      <div className="taxi-scope taxi-embedded redigo-admin-root">
        <Toaster position="top-right" />
        <Suspense fallback={fallback}>{children}</Suspense>
      </div>
    </SettingsProvider>
  );
}
