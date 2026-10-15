import { useEffect } from 'react';
import { useLocation, useNavigate } from '@taxi/shared/router';
import { socketService } from '../../shared/api/socket';
import { clearLocalUserSession } from '../../modules/user/services/authService';
import { clearCurrentRide } from '../../modules/user/services/currentRideService';
import { getAdminToken } from '@taxi/shared/api/session';

const clearUserSession = () => {
  clearCurrentRide();
  clearLocalUserSession();
};

const UserAccountInvalidationListener = () => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const isUserRoute =
      !location.pathname.startsWith('/admin') &&
      !location.pathname.startsWith('/user-import') &&
      !location.pathname.startsWith('/driver-import') &&
      !location.pathname.startsWith('/owner') &&
      !location.pathname.startsWith('/taxi/driver');

    if (!isUserRoute) {
      return undefined;
    }

    const handleLogout = (loginState = null) => {
      clearUserSession();
      socketService.disconnect();
      navigate('/taxi/user/login', { replace: true, state: loginState });
    };

    const handleAuthStale = (event) => {
      const staleToken = event.detail?.token || '';
      const currentUserToken =
        localStorage.getItem('user_accessToken') || '';
      const currentAdminToken = getAdminToken() || '';

      if (
        event.detail?.role === 'user' &&
        (!staleToken || staleToken === currentUserToken)
      ) {
        handleLogout(event.detail?.message ? { error: event.detail.message } : null);
        return;
      }

      if (
        event.detail?.role === 'admin' &&
        (!staleToken || staleToken === currentAdminToken)
      ) {
        socketService.disconnect();
        navigate('/admin/login');
      }
    };

    window.addEventListener('app:auth-stale', handleAuthStale);

    return () => {
      window.removeEventListener('app:auth-stale', handleAuthStale);
    };
  }, [location.pathname, navigate]);

  return null;
};

export default UserAccountInvalidationListener;
