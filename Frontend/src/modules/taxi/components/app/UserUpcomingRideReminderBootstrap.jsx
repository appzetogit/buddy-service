import { useEffect } from 'react';
import { useLocation } from '@taxi/shared/router';
import api from '../../shared/api/axiosInstance';
import { getLocalUserToken } from '../../modules/user/services/authService';
import { syncUpcomingRideReminders } from '../../modules/user/utils/upcomingRideReminderService';

const getResponsePayload = (response) =>
  response?.data?.data || response?.data || response || {};

const USER_REMINDER_SYNC_INTERVAL_MS = 10 * 60 * 1000;
const USER_REMINDER_SYNC_COOLDOWN_MS = 60 * 1000;

const UserUpcomingRideReminderBootstrap = () => {
  const location = useLocation();
  const isUserReminderRoute =
    location.pathname.startsWith('/taxi/user') ||
    location.pathname === '/user' ||
    location.pathname.startsWith('/ride');

  useEffect(() => {
    if (!isUserReminderRoute || !getLocalUserToken()) {
      return undefined;
    }

    let cancelled = false;
    let syncInFlight = false;
    let lastSyncAt = 0;

    const syncReminders = async (reason = 'timer') => {
      if (cancelled || syncInFlight) {
        return;
      }

      const now = Date.now();
      if (reason !== 'mount' && now - lastSyncAt < USER_REMINDER_SYNC_COOLDOWN_MS) {
        return;
      }

      syncInFlight = true;
      lastSyncAt = now;

      try {
        const scheduledRideResponse = await api.get('/rides', {
          params: {
            page: 1,
            limit: 20,
            category: 'scheduled',
          },
        });

        if (cancelled) {
          return;
        }

        const scheduledRidePayload = getResponsePayload(scheduledRideResponse);

        syncUpcomingRideReminders({
          scheduledRides: Array.isArray(scheduledRidePayload?.results)
            ? scheduledRidePayload.results
            : [],
        });
      } catch {
        // Reminder sync is non-blocking.
      } finally {
        syncInFlight = false;
      }
    };

    const handleVisibilitySync = () => {
      if (document.visibilityState === 'visible' && document.hasFocus()) {
        syncReminders('visibility');
      }
    };

    const handleFocusSync = () => {
      syncReminders('focus');
    };

    syncReminders('mount');
    const intervalId = window.setInterval(
      () => syncReminders('timer'),
      USER_REMINDER_SYNC_INTERVAL_MS,
    );
    window.addEventListener('focus', handleFocusSync);
    document.addEventListener('visibilitychange', handleVisibilitySync);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocusSync);
      document.removeEventListener('visibilitychange', handleVisibilitySync);
    };
  }, [isUserReminderRoute]);

  return null;
};

export default UserUpcomingRideReminderBootstrap;
