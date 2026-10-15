import { useLocation } from '@taxi/shared/router';
import { motion, AnimatePresence } from 'framer-motion';
import ScrollToTop from '../components/app/ScrollToTop';
import UserAccountInvalidationListener from '../components/app/UserAccountInvalidationListener';
import UserUpcomingRideReminderBootstrap from '../components/app/UserUpcomingRideReminderBootstrap';
import { useUserTheme } from '../shared/context/UserThemeContext';

/** Rider-side frame: themed mobile column with page transitions. (Admin has its own platform shell.) */
const MainLayout = ({ children }) => {
  const location = useLocation();
  const { theme } = useUserTheme();

  return (
    <>
      <ScrollToTop />
      <UserAccountInvalidationListener />
      <UserUpcomingRideReminderBootstrap />
      <div
        className={`redigo-app user-app-theme ${theme} min-h-screen transition-colors duration-300 ${
          theme === 'dark' ? 'bg-slate-950 text-white' : 'bg-slate-50 text-slate-900'
        }`}
      >
        <main
          className={`w-full max-w-lg md:max-w-7xl mx-auto shadow-2xl min-h-screen relative overflow-x-hidden transition-colors duration-300 ${
            theme === 'dark'
              ? 'bg-slate-900 text-white border-x border-slate-800/80'
              : 'bg-white text-slate-900 border-x border-slate-200'
          }`}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.28, ease: [0.21, 1.02, 0.43, 1.01] }}
              className="w-full min-h-screen flex flex-col"
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </>
  );
};

export default MainLayout;
