import { Suspense, useEffect } from 'react';
import { Toaster } from 'react-hot-toast';
import { SettingsProvider } from './shared/context/SettingsContext';
import { UserThemeProvider } from './shared/context/UserThemeContext';
import { loadTaxiFonts } from './shared/utils/loadTaxiFonts';
import MainLayout from './layouts/MainLayout';
import TaxiUserRoutes from './routes/userRoutes';
import './styles/taxi.css';

const suspenseFallback = (
  <div className="flex items-center justify-center min-h-screen">
    <span className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
  </div>
);

/**
 * Taxi (rides + parcel) for riders, mounted by the platform router at /taxi/*.
 * Sign-in, session and API client are the platform's; this provides taxi's own settings/theme
 * context and a style scope so nothing leaks into Food / Quick Commerce.
 */
export default function TaxiUserApp() {
  useEffect(() => {
    loadTaxiFonts();
  }, []);

  return (
    <SettingsProvider>
      <UserThemeProvider>
        <div className="taxi-scope">
          <MainLayout>
            <Suspense fallback={suspenseFallback}>
              <Toaster position="top-right" />
              <TaxiUserRoutes />
            </Suspense>
          </MainLayout>
        </div>
      </UserThemeProvider>
    </SettingsProvider>
  );
}
