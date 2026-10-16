import api from '../../../shared/api/axiosInstance';
import { clearModuleAuth, getModuleToken, isModuleAuthenticated } from '@food/utils/auth';

/**
 * Riders sign in through the platform login (Food / Quick Commerce / Taxi share one customer
 * account), so there is no taxi-specific sign-in here: the session is the platform's `user`
 * session and this file only reads it.
 */
export const getLocalUserToken = () => (isModuleAuthenticated('user') ? getModuleToken('user') || '' : '');

/** Drops the platform customer session (the account is shared, so it signs out everywhere). */
export const clearLocalUserSession = () => {
  clearModuleAuth('user');
  try {
    if (String(localStorage.getItem('chatRole') || '').toLowerCase() === 'user') {
      localStorage.removeItem('chatRole');
    }
  } catch {
    /* storage unavailable */
  }
};

export const withUserAuth = (config = {}) => {
  const token = getLocalUserToken();

  if (!token) {
    return config;
  }

  return {
    ...config,
    headers: {
      ...(config.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  };
};

export const userAuthService = {
  updateCurrentUser: (payload) => api.patch('/users/me', payload, withUserAuth()),
  getCurrentUser: () => api.get('/users/me', withUserAuth()),
  getWallet: () => api.get('/users/wallet', withUserAuth()),
  transferWallet: (phone, amount) => api.post('/users/wallet/transfer', { phone, amount }, withUserAuth()),
  transferWalletToDriver: (phone, amount) => api.post('/users/wallet/transfer/driver', { phone, amount }, withUserAuth()),
  createWalletTopupOrder: (amount) => api.post('/users/wallet/razorpay/order', { amount }, withUserAuth()),
  verifyWalletTopup: (payload) => api.post('/users/wallet/razorpay/verify', payload, withUserAuth()),
  createPhonePeWalletTopupOrder: (amount) => api.post('/users/wallet/phonepe/order', { amount }, withUserAuth()),
  verifyPhonePeWalletTopup: (merchantTransactionId) =>
    api.get(`/users/wallet/phonepe/status/${merchantTransactionId}`, withUserAuth()),
  requestAccountDeletion: (reason) => api.post('/users/me/delete-request', { reason }),
  getNotifications: () => api.get('/users/notifications', withUserAuth()),
  deleteNotification: (id) => api.delete(`/users/notifications/${id}`, withUserAuth()),
  clearAllNotifications: () => api.delete('/users/notifications', withUserAuth()),
  getRideBids: (rideId) => api.get(`/rides/${rideId}/bids`, withUserAuth()),
  acceptRideBid: (rideId, bidId) => api.post(`/rides/${rideId}/bids/${bidId}/accept`, {}, withUserAuth()),
  increaseRideBidCeiling: (rideId, incrementSteps = 1) =>
    api.patch(`/rides/${rideId}/bids/ceiling`, { incrementSteps }, withUserAuth()),
};
