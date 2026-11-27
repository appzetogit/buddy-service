// Tells the server a login screen is open so it can get the WhatsApp OTP connection ready
// (the provider is slow to open a new one). Fire-and-forget; at most once every 60 s per tab.
let lastWarm = 0;
export const warmOtpChannel = () => {
  if (Date.now() - lastWarm < 60 * 1000) return;
  lastWarm = Date.now();
  const base = String(import.meta.env?.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '');
  try {
    fetch(`${base}/common/otp/warm`, { method: 'POST', keepalive: true }).catch(() => {});
  } catch {
    // never block a login screen
  }
};
