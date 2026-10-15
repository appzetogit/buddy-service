import simplify from 'simplify-js';
import { getFirebaseDatabase, firebaseServerTimestamp } from '../../../../config/firebase.js';

const SIMPLIFY_INTERVAL_MS = 3_000;
const ROUTE_TOLERANCE = 0.0001;
const FIREBASE_WRITE_INTERVAL_MS = 10_000;

const driverRouteBuffers = new Map();
const driverFirebaseWriteTimestamps = new Map();
const driverSimplifyTimestamps = new Map();

const toRoutePoint = (coordinates) => ({
  x: Number(coordinates[0]),
  y: Number(coordinates[1]),
});

const shouldSimplifyRoute = (driverId) => {
  const now = Date.now();
  const lastSimplifiedAt = driverSimplifyTimestamps.get(driverId) || 0;

  if (now - lastSimplifiedAt < SIMPLIFY_INTERVAL_MS) {
    return false;
  }

  driverSimplifyTimestamps.set(driverId, now);
  return true;
};

const maybeWriteRouteToFirebase = ({ driverId, points }) => {
  const now = Date.now();
  const lastWriteAt = driverFirebaseWriteTimestamps.get(driverId) || 0;

  if (now - lastWriteAt < FIREBASE_WRITE_INTERVAL_MS) {
    return;
  }

  driverFirebaseWriteTimestamps.set(driverId, now);

  const database = getFirebaseDatabase();

  if (!database) {
    return;
  }

  database
    .ref(`rides/${driverId}/route`)
    .set({
      points,
      updatedAt: firebaseServerTimestamp(),
    })
    .catch((error) => {
      console.error(`Firebase route sync failed for driver ${driverId}:`, error.message);
    });
};

/// Keeps the driver's travelled path for the trip, thinned with RDP so a
/// half-hour drive does not accumulate thousands of near-identical points.
///
/// This is the breadcrumb *trail*, not the live position - the marker is
/// interpolated in the apps and never reads this. It used to be broadcast to
/// the ride room on every GPS tick as `ride:driver-route:updated`, carrying
/// the whole accumulated array each time, to a room where neither app has
/// ever registered a handler. Now it only feeds the Firebase mirror, which is
/// throttled to one write per ten seconds.
export const updateDriverRoute = ({ rideId, driverId, coordinates }) => {
  const routePoint = toRoutePoint(coordinates);
  const currentBuffer = driverRouteBuffers.get(driverId) || [];
  currentBuffer.push(routePoint);

  // RDP is intentionally batched so 2-3 second GPS pings stay cheap.
  const nextBuffer = shouldSimplifyRoute(driverId)
    ? simplify(currentBuffer, ROUTE_TOLERANCE, true)
    : currentBuffer;

  driverRouteBuffers.set(driverId, nextBuffer);

  const payload = {
    rideId: String(rideId),
    driverId: String(driverId),
    points: nextBuffer,
    updatedAt: new Date().toISOString(),
  };

  // Firebase is best-effort; never hold up the socket location update path.
  setImmediate(() => maybeWriteRouteToFirebase({ driverId, points: nextBuffer }));

  return payload;
};

export const clearDriverRoute = (driverId) => {
  driverRouteBuffers.delete(driverId);
  driverFirebaseWriteTimestamps.delete(driverId);
  driverSimplifyTimestamps.delete(driverId);
};
