import { RIDE_LIVE_STATUS, RIDE_STATUS } from '../constants/index.js';
import { Driver } from '../driver/models/Driver.js';
import { Ride } from '../user/models/Ride.js';
import { User } from '../user/models/User.js';
import { emitToDriver } from './dispatchService.js';
import { sendPushNotificationToEntities } from './pushNotificationService.js';
import {
  SCHEDULED_RIDE_ACTIVE_LEAD_MS,
  getActiveRideForIdentity,
  serializeRideRealtime,
} from './rideService.js';

/**
 * Reminds drivers of the scheduled rides they accepted, and hands the ride to
 * them as their live trip.
 *
 *   - 30 minutes before pickup ("lead"): push "head out now", mark the driver
 *     busy so they are not sent other rides, and send the trip to the app
 *     (`ride:state`) so it opens - the ride is their active trip from now on.
 *   - At pickup time ("due"), if they have not set off yet: push "pickup time"
 *     and mark them busy again (in case another trip freed them in between).
 *
 * Each reminder is sent once per ride: the sweep claims it by stamping
 * `scheduleReminders.*SentAt` in the same update that finds it, so two
 * sweeps (or a restart) never send it twice. A ride that is cancelled or
 * started never matches.
 *
 * Pushes carry `scheduledRideId`, not `rideId`: the driver app treats any push
 * with a `rideId` as a new ride offer and, on Android, shows no notification
 * for it.
 */

const SWEEP_INTERVAL_MS = 60 * 1000;
// A due reminder this late is no longer useful; the rider will have called.
const DUE_REMINDER_GRACE_MS = 60 * 60 * 1000;

let sweepTimer = null;

const timeLabel = (date) =>
  new Date(date).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });

const notStartedYet = [RIDE_LIVE_STATUS.ACCEPTED, RIDE_LIVE_STATUS.ARRIVING];

/// Finds one ride still owed `stage` reminder and stamps it as sent.
const claimNext = (stage, now) => {
  const filter = stage === 'lead'
    ? {
        scheduledAt: { $gt: now, $lte: new Date(now.getTime() + SCHEDULED_RIDE_ACTIVE_LEAD_MS) },
        'scheduleReminders.leadSentAt': null,
      }
    : {
        scheduledAt: { $lte: now, $gt: new Date(now.getTime() - DUE_REMINDER_GRACE_MS) },
        'scheduleReminders.dueSentAt': null,
      };

  return Ride.findOneAndUpdate(
    {
      ...filter,
      driverId: { $ne: null },
      status: RIDE_STATUS.ACCEPTED,
      liveStatus: { $in: notStartedYet },
    },
    { $set: { [`scheduleReminders.${stage === 'lead' ? 'leadSentAt' : 'dueSentAt'}`]: now } },
    { returnDocument: 'after' },
  )
    .select('driverId userId scheduledAt pickupAddress liveStatus scheduleReminders')
    .lean();
};

const remind = async (ride, stage) => {
  const driverId = String(ride.driverId);
  const at = timeLabel(ride.scheduledAt);
  const pickup = ride.pickupAddress ? ` at ${ride.pickupAddress}` : '';

  // Busy from now on: no other ride is offered on top of this one. Completing
  // or cancelling the ride frees them as usual.
  await Driver.updateOne({ _id: driverId, isOnRide: { $ne: true } }, { $set: { isOnRide: true } });

  await sendPushNotificationToEntities({
    driverIds: [driverId],
    title: stage === 'lead' ? `Scheduled pickup at ${at}` : 'Scheduled pickup time',
    body: stage === 'lead'
      ? `Head out now for your scheduled ride${pickup}. It's open in the app.`
      : `Your rider is waiting${pickup}. Open the app to start the trip.`,
    data: {
      type: 'scheduled_ride_reminder',
      stage,
      scheduledRideId: String(ride._id),
      scheduledAt: new Date(ride.scheduledAt).toISOString(),
    },
  }).catch(() => null);

  // The ride is now the driver's active trip; send it so an open app shows it.
  const active = await getActiveRideForIdentity({ role: 'driver', entityId: driverId }).catch(() => null);
  if (active && String(active._id) === String(ride._id)) {
    emitToDriver(driverId, 'ride:state', serializeRideRealtime(active));
  }

  // And the rider's: it takes their active-ride slot now (unless they are on
  // another trip), and the push carries `rideId` so it opens live tracking.
  if (stage === 'lead' && ride.userId) {
    const userId = String(ride.userId);
    await User.updateOne({ _id: userId, currentRideId: null }, { $set: { currentRideId: ride._id } }).catch(() => null);
    await sendPushNotificationToEntities({
      userIds: [userId],
      title: `Your ${at} ride`,
      body: 'Your driver is heading to the pickup now. Tap to track.',
      data: { type: 'scheduled_ride_starting', rideId: String(ride._id) },
    }).catch(() => null);
  }
};

export const sweepScheduledRideReminders = async (now = new Date()) => {
  let sent = 0;
  for (const stage of ['lead', 'due']) {
    // One at a time: each claim is atomic, and a sweep rarely has more than a
    // handful due in the same minute.
    for (let guard = 0; guard < 100; guard += 1) {
      const ride = await claimNext(stage, now);
      if (!ride) break;
      await remind(ride, stage).catch((error) => {
        console.error('Scheduled ride reminder failed', String(ride._id), error?.message || error);
      });
      sent += 1;
    }
  }
  return sent;
};

export const startScheduledRideReminderLoop = () => {
  if (sweepTimer) return;

  const run = () =>
    sweepScheduledRideReminders().catch((error) => {
      console.error('Scheduled ride reminder sweep failed', error);
    });

  sweepTimer = setInterval(run, SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
  run();
};
