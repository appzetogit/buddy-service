/**
 * Taxi realtime, on the platform's Socket.IO server.
 *
 * Taxi no longer starts a server of its own: the platform `io` (config/socket.js) already
 * authenticates every connection with the platform access token and puts it in `socket.user`.
 * This registers the taxi events on that same server for the two roles the platform currently
 * carries here - riders (platform customers) and admins - and leaves every other role (restaurant,
 * seller, delivery partner...) completely alone, so Food and Quick Commerce sockets are untouched.
 *
 * Riders (delivery partners) join the taxi rooms too, so ride offers and ride updates reach the
 * delivery app over the connection it already has. Their sockets are only added to taxi rooms and
 * given the ride events; everything Food / Quick Commerce do with them is unchanged.
 */
import { SOCKET_EVENTS } from './events.js';
import { resolvePartnerFromAccountId } from '../shared/partner.js';
import { registerRideSocketHandlers } from './handlers/rideSocketHandler.js';
import { authorizeRideRoomAccess } from './middleware/rideRoomAuth.js';
import { getPresenceParticipantRoom, getPresenceRoleRoom } from './presenceRooms.js';
import {
  addSocketSubscriptions,
  joinRideRoom,
  notifyLateAvailableDriver,
  setSocketServer,
  startDispatchFlow,
} from '../services/dispatchService.js';
import { createRideRecord, getRideRoom } from '../services/rideService.js';
import { consumeScopedRateLimit } from '../middlewares/rateLimitMiddleware.js';
import { getSocketClientIp } from '../shared/clientIp.js';
import { normalizePoint } from '../../../utils/geo.js';
import { User } from '../user/models/User.js';

/** Platform role -> taxi role. Anything else is not a taxi participant. */
const TAXI_ROLE_BY_PLATFORM_ROLE = { USER: 'user', ADMIN: 'admin', DRIVER: 'driver', DELIVERY_PARTNER: 'driver' };

const onAsync = (socket, handler) => async (payload = {}) => {
  try {
    await handler(payload);
  } catch (error) {
    socket.emit('errorMessage', { message: error.message || 'Socket operation failed' });
  }
};

const resolveTaxiIdentity = async (socket) => {
  const role = TAXI_ROLE_BY_PLATFORM_ROLE[String(socket.user?.role || '').toUpperCase()];
  const sub = socket.user?.userId ? String(socket.user.userId) : '';
  if (!role || !sub) return null;

  if (role === 'driver') {
    // A rider's token id may be the delivery-partner id or the unified identity id.
    const partner = await resolvePartnerFromAccountId(sub);
    if (!partner || (partner.status && partner.status !== 'approved')) return null;
    return { role, sub: String(partner._id) };
  }

  if (role === 'user') {
    const rider = await User.findById(sub).select('active isActive deletedAt').lean();
    if (!rider || rider.deletedAt || rider.isActive === false || rider.active === false) return null;
  }
  return { role, sub };
};

export const registerTaxiSocket = (io) => {
  setSocketServer(io);

  io.on('connection', async (socket) => {
    const identity = await resolveTaxiIdentity(socket).catch(() => null);
    if (!identity) return;
    socket.auth = identity;

    addSocketSubscriptions(socket, { role: identity.role, entityId: identity.sub });
    if (identity.role === 'driver') {
      // A rider who comes online while a ride is still being searched gets that offer now.
      notifyLateAvailableDriver(identity.sub).catch(() => {});
    }
    socket.join(getPresenceParticipantRoom(identity.role, identity.sub));
    socket.join(getPresenceRoleRoom(identity.role));

    socket.on(
      'joinRide',
      onAsync(socket, async ({ rideId }) => {
        if (!rideId) return;
        await authorizeRideRoomAccess({ socket, rideId });
        joinRideRoom(socket, rideId);
      }),
    );

    registerRideSocketHandlers({ io, socket, onAsync });

    socket.on(
      'requestRide',
      onAsync(
        socket,
        async ({
          pickup,
          drop,
          fare,
          estimatedDistanceMeters,
          estimatedDurationMinutes,
          vehicleTypeId,
          vehicleIconType,
          paymentMethod,
          serviceType,
          intercity,
        }) => {
          if (identity.role !== 'user') return;

          const rateLimitOutcome = await consumeScopedRateLimit({
            scope: 'ride_create_socket',
            max: 10,
            windowMs: 10 * 60 * 1000,
            mode: 'auth_or_ip',
            parts: [identity.sub || `ip:${getSocketClientIp(socket)}`],
          });
          if (!rateLimitOutcome.allowed) {
            socket.emit('errorMessage', { message: 'Too many ride requests. Please try again later.' });
            return;
          }

          // Ride creation and dispatch share the same service path as the REST controller.
          const ride = await createRideRecord({
            userId: identity.sub,
            pickupCoords: normalizePoint(pickup, 'pickup'),
            dropCoords: normalizePoint(drop, 'drop'),
            fare: Number(fare || 0),
            estimatedDistanceMeters: Number(estimatedDistanceMeters || 0),
            estimatedDurationMinutes: Number(estimatedDurationMinutes || 0),
            vehicleTypeId,
            vehicleIconType,
            paymentMethod,
            serviceType,
            intercity,
          });

          joinRideRoom(socket, ride._id);
          await startDispatchFlow(ride);

          socket.emit('rideCreated', { rideId: String(ride._id), room: getRideRoom(ride._id), status: ride.status });
          socket.emit(SOCKET_EVENTS.RIDE_JOINED, { rideId: String(ride._id), room: getRideRoom(ride._id) });
        },
      ),
    );
  });
};
