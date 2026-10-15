import { getFirebaseMessaging } from '../../../config/firebase.js';
import { Driver } from '../driver/models/Driver.js';
import { User } from '../user/models/User.js';
import { listEntityPushTokens } from './pushTokenService.js';

const INVALID_TOKEN_CODES = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
  'messaging/invalid-argument',
]);

const chunk = (items, size) => {
  const groups = [];

  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }

  return groups;
};

const collectAudienceTargets = async ({ sendTo, serviceLocationId }) => {
  const includeUsers = sendTo === 'all' || sendTo === 'users';
  const includeDrivers = sendTo === 'all' || sendTo === 'drivers';
  const targets = [];

  if (includeUsers) {
    const users = await User.find({
      deletedAt: null,
      isActive: { $ne: false },
      active: { $ne: false },
    })
      .select('_id fcmTokenWeb fcmTokenMobile fcmTokens')
      .lean();

    users.forEach((user) => {
      listEntityPushTokens(user, 'user').forEach((tokenEntry) => {
        targets.push({
          ...tokenEntry,
          entityId: String(user._id),
        });
      });
    });
  }

  if (includeDrivers) {
    const driverQuery = {
      deletedAt: null,
      approve: { $ne: false },
      status: { $ne: 'pending' },
    };

    if (serviceLocationId) {
      driverQuery.service_location_id = serviceLocationId;
    }

    const drivers = await Driver.find(driverQuery)
      .select('_id fcmTokenWeb fcmTokenMobile fcmTokens')
      .lean();

    drivers.forEach((driver) => {
      listEntityPushTokens(driver, 'driver').forEach((tokenEntry) => {
        targets.push({
          ...tokenEntry,
          entityId: String(driver._id),
        });
      });
    });
  }

  return targets;
};

const removeInvalidTokens = async (invalidTargets = []) => {
  if (invalidTargets.length === 0) {
    return 0;
  }

  const userIdsByField = { fcmTokenWeb: new Set(), fcmTokenMobile: new Set() };
  const driverIdsByField = { fcmTokenWeb: new Set(), fcmTokenMobile: new Set() };

  invalidTargets.forEach((target) => {
    if (target.role === 'user') {
      userIdsByField[target.field]?.add(target.entityId);
    }

    if (target.role === 'driver') {
      driverIdsByField[target.field]?.add(target.entityId);
    }
  });

  const operations = [];

  // Customers hold token arrays (shared with Food / Quick Commerce): remove only the dead token.
  invalidTargets
    .filter((target) => target.role === 'user' && target.token)
    .forEach((target) => {
      operations.push(
        User.updateOne(
          { _id: target.entityId },
          { $pull: { fcmTokens: target.token, fcmTokenMobile: target.token } },
        ),
      );
    });

  // Riders are delivery partners and hold token arrays too: remove only the dead token.
  invalidTargets
    .filter((target) => target.role === 'driver' && target.token)
    .forEach((target) => {
      operations.push(
        Driver.updateOne(
          { _id: target.entityId },
          { $pull: { fcmTokens: target.token, fcmTokenMobile: target.token } },
        ),
      );
    });

  await Promise.all(operations);
  return invalidTargets.length;
};

const sendPushToTargets = async ({
  targets = [],
  title,
  body,
  image = '',
  data = {},
  dataOnly = false,
}) => {
  const messaging = getFirebaseMessaging();

  if (!messaging) {
    return {
      attempted: false,
      deliveredCount: 0,
      failedCount: 0,
      invalidTokenCount: 0,
      targetCount: 0,
      reason: 'Firebase messaging is not configured on the backend',
    };
  }

  const dedupedTargets = Array.from(
    new Map((Array.isArray(targets) ? targets : []).map((target) => [target.token, target])).values(),
  );

  if (dedupedTargets.length === 0) {
    return {
      attempted: true,
      deliveredCount: 0,
      failedCount: 0,
      invalidTokenCount: 0,
      targetCount: 0,
      reason: 'No saved FCM tokens were found for the selected entities',
    };
  }

  let deliveredCount = 0;
  let failedCount = 0;
  const invalidTargets = [];
  const safeData = Object.fromEntries(
    Object.entries(data || {}).map(([key, value]) => [key, String(value ?? '')]),
  );

  for (const batch of chunk(dedupedTargets, 500)) {
    // Data-only when the app must handle the push itself.
    //
    // On Android a message carrying a `notification` block is drawn straight
    // into the system tray by the Firebase SDK whenever the app is backgrounded
    // or killed, and `onMessageReceived` is never called. For an ordinary
    // notification that is exactly what we want. For a ride offer it is fatal:
    // the driver sees a dead tray line, the native full-screen card never
    // posts, and Dart never learns an offer exists.
    //
    // Stripping the block puts the message back on the data path, which always
    // wakes the app. The title and body ride along inside `data` so whatever
    // renders the alert still has them.
    const payload = dataOnly
      ? {
          tokens: batch.map((target) => target.token),
          data: {
            ...safeData,
            title: String(title ?? ''),
            body: String(body ?? ''),
            click_action: 'FLUTTER_NOTIFICATION_CLICK',
          },
          android: {
            priority: 'high',
          },
          apns: {
            // iOS drops a data-only push unless it is flagged as a silent
            // content update.
            payload: { aps: { 'content-available': 1 } },
            headers: { 'apns-priority': '5', 'apns-push-type': 'background' },
          },
        }
      : {
          tokens: batch.map((target) => target.token),
          notification: {
            title,
            body,
            ...(image ? { imageUrl: image } : {}),
          },
          data: {
            ...safeData,
            click_action: 'FLUTTER_NOTIFICATION_CLICK',
          },
          android: {
            priority: 'high',
            notification: image ? { imageUrl: image } : undefined,
          },
          webpush: {
            notification: {
              title,
              body,
              ...(image ? { image } : {}),
            },
          },
        };

    const response = await messaging.sendEachForMulticast(payload);

    response.responses.forEach((item, index) => {
      if (item.success) {
        deliveredCount += 1;
        return;
      }

      failedCount += 1;
      if (INVALID_TOKEN_CODES.has(item.error?.code)) {
        invalidTargets.push(batch[index]);
      }
    });
  }

  const invalidTokenCount = await removeInvalidTokens(invalidTargets);

  return {
    attempted: true,
    deliveredCount,
    failedCount,
    invalidTokenCount,
    targetCount: dedupedTargets.length,
    reason: '',
  };
};

const collectDirectTargets = async ({ userIds = [], driverIds = [] }) => {
  const normalizedUserIds = [...new Set((Array.isArray(userIds) ? userIds : []).map((id) => String(id || '').trim()).filter(Boolean))];
  const normalizedDriverIds = [...new Set((Array.isArray(driverIds) ? driverIds : []).map((id) => String(id || '').trim()).filter(Boolean))];
  const targets = [];

  if (normalizedUserIds.length) {
    const users = await User.find({ _id: { $in: normalizedUserIds } })
      .select('_id fcmTokenWeb fcmTokenMobile fcmTokens')
      .lean();

    users.forEach((user) => {
      listEntityPushTokens(user, 'user').forEach((tokenEntry) => {
        targets.push({
          ...tokenEntry,
          entityId: String(user._id),
        });
      });
    });
  }

  if (normalizedDriverIds.length) {
    const drivers = await Driver.find({ _id: { $in: normalizedDriverIds } })
      .select('_id fcmTokenWeb fcmTokenMobile fcmTokens')
      .lean();

    drivers.forEach((driver) => {
      listEntityPushTokens(driver, 'driver').forEach((tokenEntry) => {
        targets.push({
          ...tokenEntry,
          entityId: String(driver._id),
        });
      });
    });
  }

  return targets;
};

export const sendPushNotificationToAudience = async ({
  notificationId,
  serviceLocationId,
  sendTo,
  title,
  body,
  image,
}) => {
  const messaging = getFirebaseMessaging();

  if (!messaging) {
    return {
      attempted: false,
      deliveredCount: 0,
      failedCount: 0,
      invalidTokenCount: 0,
      targetCount: 0,
      reason: 'Firebase messaging is not configured on the backend',
    };
  }

  const targets = await collectAudienceTargets({ sendTo, serviceLocationId });
  const dedupedTargets = Array.from(
    new Map(targets.map((target) => [target.token, target])).values(),
  );

  if (dedupedTargets.length === 0) {
    return {
      attempted: true,
      deliveredCount: 0,
      failedCount: 0,
      invalidTokenCount: 0,
      targetCount: 0,
      reason: 'No saved FCM tokens were found for the selected audience',
    };
  }

  let deliveredCount = 0;
  let failedCount = 0;
  const invalidTargets = [];

  for (const batch of chunk(dedupedTargets, 500)) {
    const response = await messaging.sendEachForMulticast({
      tokens: batch.map((target) => target.token),
      notification: {
        title,
        body,
        ...(image ? { imageUrl: image } : {}),
      },
      data: {
        notificationId: String(notificationId || ''),
        serviceLocationId: String(serviceLocationId || ''),
        sendTo: String(sendTo || 'all'),
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
      },
      android: {
        priority: 'high',
        notification: image ? { imageUrl: image } : undefined,
      },
      webpush: {
        notification: {
          title,
          body,
          ...(image ? { image } : {}),
        },
      },
    });

    response.responses.forEach((item, index) => {
      if (item.success) {
        deliveredCount += 1;
        return;
      }

      failedCount += 1;
      if (INVALID_TOKEN_CODES.has(item.error?.code)) {
        invalidTargets.push(batch[index]);
      }
    });
  }

  const invalidTokenCount = await removeInvalidTokens(invalidTargets);

  return {
    attempted: true,
    deliveredCount,
    failedCount,
    invalidTokenCount,
    targetCount: dedupedTargets.length,
    reason: '',
  };
};

export const sendPushNotificationToEntities = async ({
  userIds = [],
  driverIds = [],
  title,
  body,
  image = '',
  data = {},
  /// Set for pushes the app has to act on rather than merely display — see the
  /// note in `sendPushToTargets`.
  dataOnly = false,
}) => {
  const targets = await collectDirectTargets({ userIds, driverIds });
  return sendPushToTargets({
    targets,
    title,
    body,
    image,
    data,
    dataOnly,
  });
};
