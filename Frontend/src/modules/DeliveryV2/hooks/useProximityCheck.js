import { useMemo } from 'react';
import { useDeliveryStore } from '@/modules/DeliveryV2/store/useDeliveryStore';
import { calculateDistance } from '@/modules/DeliveryV2/hooks/proximity.utils';
import { extractLatLng, resolvePickupLatLng } from '@/modules/DeliveryV2/utils/geo';

/**
 * useProximityCheck - Professional hook for dynamic range monitoring.
 * Ensures rider can only advance based on Admin-defined ranges.
 * 
 * @returns {Object} { distanceToTarget, isWithinRange, actionLimit }
 */
export const useProximityCheck = () => {
  const riderLocation = useDeliveryStore((state) => state.riderLocation);
  const activeOrder = useDeliveryStore((state) => state.activeOrder);
  const tripStatus = useDeliveryStore((state) => state.tripStatus);
  const settings = useDeliveryStore((state) => state.settings);

  // Determine current target based on trip state
  const targetLocation = useMemo(() => {
    if (!activeOrder) return null;
    
    // If heading to pickup or arrived at pickup, target is restaurant
    if (['PICKING_UP', 'REACHED_PICKUP'].includes(tripStatus)) {
      if (activeOrder.isMultiRestaurant && activeOrder.pickups?.length > 0) {
        // Remaining stops (skip dropped/cancelled/collected), in server-assigned visit order.
        const remaining = activeOrder.pickups
          .filter(
            (p) =>
              !p.permanentlyDropped &&
              p.status !== 'cancelled' &&
              !['picked_up', 'ready_for_handover'].includes(p.status),
          )
          .sort((a, b) => (Number(a.sequence) || 0) - (Number(b.sequence) || 0));

        // Follow `sequence`, but if the next stop isn't ready and another already is,
        // head to the ready one first — mirrors getNextPickup() on the server.
        const head = remaining[0];
        const pendingPickup =
          head && head.status === 'ready'
            ? head
            : remaining.find((p) => p.status === 'ready') || head;

        const pendingPoint =
          extractLatLng(pendingPickup?.location) || extractLatLng(pendingPickup);
        if (pendingPoint) return pendingPoint;
      }
      // Single restaurant, or a multi-restaurant order whose next stop carries no usable
      // coordinates. resolvePickupLatLng also reads `restaurantId.location`, so a trip whose
      // flattened `restaurantLocation` could not be derived still yields a target instead of
      // leaving the rider with no distance at all.
      return resolvePickupLatLng(activeOrder);
    }

    // If heading to drop or arrived at drop, target is customer
    if (['PICKED_UP', 'REACHED_DROP'].includes(tripStatus)) {
      return (
        extractLatLng(activeOrder.customerLocation) ||
        extractLatLng(activeOrder.customer_location) ||
        extractLatLng(activeOrder.deliveryAddress?.location) ||
        extractLatLng(activeOrder.deliveryAddress)
      );
    }

    return null;
  }, [activeOrder, tripStatus]);

  // Determine current range limit from admin settings
  const actionLimit = useMemo(() => {
    if (tripStatus === 'PICKING_UP') return settings.pickupRangeLimit || 500;
    if (tripStatus === 'PICKED_UP') return settings.deliveryRangeLimit || 500;
    return 500;
  }, [tripStatus, settings]);

  // Calculate real-time distance
  const distanceToTarget = useMemo(() => {
    const rider = extractLatLng(riderLocation);
    if (!rider || !targetLocation) return Infinity;

    const distance = calculateDistance(
      rider.lat,
      rider.lng,
      targetLocation.lat,
      targetLocation.lng,
    );
    // calculateDistance returns NaN for any non-finite input. NaN compares false against every
    // threshold, so it would silently read as "out of range" forever; Infinity is the value the
    // rest of the app already treats as "unknown".
    return Number.isFinite(distance) ? distance : Infinity;
  }, [riderLocation, targetLocation]);

  // Calculate real-time duration (in seconds)
  const durationToTarget = useMemo(() => {
    if (distanceToTarget === Infinity) return Infinity;
    // Default speed: 7 m/s (approx 25 km/h)
    return Math.round(distanceToTarget / 7);
  }, [distanceToTarget]);

  // Dev mode bypass
  const isDevMode = import.meta.env.VITE_APP_MODE === 'developer' || 
                    import.meta.env.VITE_ENABLE_RANGE_BYPASS === 'true' ||
                    import.meta.env.DEV;

  const isWithinRange = isDevMode ? true : (distanceToTarget <= actionLimit);

  return {
    distanceToTarget,
    durationToTarget,
    isWithinRange,
    actionLimit,
  };
};
