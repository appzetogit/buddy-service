/**
 * The address a request really came from.
 *
 * The API only listens on 127.0.0.1, so every request reaches it through nginx,
 * which sets X-Real-IP to the connecting address and overwrites anything the
 * client sent under that name. That makes it the one header here a client
 * cannot choose.
 *
 * X-Forwarded-For is the opposite: nginx appends the real address to whatever
 * the client already put there. Rate limits used to take its *first* entry -
 * the client's own - so a script could send a new made-up address with every
 * request and never reach a per-IP limit. When X-Real-IP is missing, the last
 * entry is the one nginx added.
 */
export const resolveClientIp = (headers = {}, fallback = '') => {
  const realIp = String(headers['x-real-ip'] || '').trim();
  if (realIp) return realIp;

  const forwarded = String(headers['x-forwarded-for'] || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (forwarded.length > 0) return forwarded[forwarded.length - 1];

  return String(fallback || '').trim() || 'unknown';
};

export const getRequestClientIp = (req) =>
  resolveClientIp(req?.headers, req?.ip || req?.socket?.remoteAddress || req?.connection?.remoteAddress);

export const getSocketClientIp = (socket) =>
  resolveClientIp(socket?.handshake?.headers, socket?.handshake?.address || socket?.conn?.remoteAddress);
