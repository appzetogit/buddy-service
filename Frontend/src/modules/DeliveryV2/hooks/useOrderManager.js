import { useRef } from 'react';
import { useDeliveryStore } from '@/modules/DeliveryV2/store/useDeliveryStore';
import { deliveryAPI } from '@food/api';
import { quickDeliveryAPI, isQuickDeliveryOrder } from '@quickCommerce/delivery/quickDeliveryApi';
import { toast } from 'sonner';
import {
  getCurrentRiderId,
  getMyLeg,
  isDualLegOrder,
  getOtherLeg,
  getPartnerWaitMessage,
} from '@/modules/DeliveryV2/utils/partnerIdentity';

/**
 * useOrderManager - Professional hook for real-world trip lifecycle actions.
 * Connects directly to the backend API services.
 */
export const useOrderManager = () => {
  const {
    activeOrder, tripStatus, updateTripStatus, clearActiveOrder, setActiveOrder, riderLocation
  } = useDeliveryStore();

  // Quick Commerce jobs live in their own collection, so they use the QC rider endpoints.
  // Same method names, so every call below stays unchanged.
  const apiFor = (orderLike = activeOrder) =>
    (isQuickDeliveryOrder(orderLike) ? quickDeliveryAPI : deliveryAPI);

  const resolveOrderId = (orderLike = activeOrder) =>
    orderLike?._id || orderLike?.id || orderLike?.orderId || orderLike?.order_id;

  const acceptOrderInFlight = useRef(false);

  const acceptOrder = async (order) => {
    // Client-side guard: prevent duplicate API calls if already processing
    if (acceptOrderInFlight.current) {
      toast.info('Already processing this order...');
      return;
    }
    const orderId = resolveOrderId(order);
    if (!orderId) {
      toast.error('Invalid order data');
      return;
    }

    acceptOrderInFlight.current = true;
    try {
      const isShared = order.isShared || order.dispatch?.isShared;
      const response = isShared
        ? await apiFor(order).acceptSharedOrder(orderId)
        : await apiFor(order).acceptOrder(orderId);

      if (response?.data?.success) {
        const fullOrder = response.data.data?.order || order;

        // Robustly determine locations from multiple possible formats (Populated API vs Socket)
        // Robustly determine locations from multiple possible formats
        const getLoc = (ref, keysLat, keysLng) => {
          if (!ref) return null;
          if (ref.location) {
            if (Array.isArray(ref.location.coordinates) && ref.location.coordinates.length >= 2) {
              return { lat: ref.location.coordinates[1], lng: ref.location.coordinates[0] };
            }
            return { lat: ref.location.latitude || ref.location.lat, lng: ref.location.longitude || ref.location.lng };
          }
          for (const k of keysLat) { if (ref[k] != null) return { lat: ref[k], lng: ref[keysLng[keysLat.indexOf(k)]] }; }
          return null;
        };

        // For multi-restaurant, find the next pending pickup location (driver sequence)
        let resLoc = null;
        if (fullOrder.isMultiRestaurant && Array.isArray(fullOrder.pickups)) {
          const nextPickup = [...fullOrder.pickups]
            .filter(
              (p) =>
                !p.permanentlyDropped &&
                !['picked_up', 'cancelled'].includes(String(p.status || '')),
            )
            .sort((a, b) => (Number(a.sequence) || 0) - (Number(b.sequence) || 0))[0];
          if (nextPickup) {
            resLoc =
              getLoc(nextPickup, ['latitude', 'lat'], ['longitude', 'lng']) ||
              getLoc(nextPickup.location, ['latitude', 'lat'], ['longitude', 'lng']);
          }
        }

        // Fallback to main restaurantId or top-level keys
        if (!resLoc) {
          resLoc = getLoc(fullOrder.restaurantId, ['latitude', 'lat'], ['longitude', 'lng']) ||
            getLoc(fullOrder, ['restaurant_lat', 'restaurantLat', 'latitude'], ['restaurant_lng', 'restaurantLng', 'longitude']);
        }

        const cusLoc = getLoc(fullOrder.deliveryAddress, ['latitude', 'lat'], ['longitude', 'lng']) ||
          getLoc(fullOrder, ['customer_lat', 'customerLat', 'latitude'], ['customer_lng', 'customerLng', 'longitude']);

        setActiveOrder({
          ...fullOrder,
          orderId: orderId,
          restaurantLocation: resLoc,
          customerLocation: cusLoc
        });

        updateTripStatus('PICKING_UP');
        // toast.success('Order Accepted! Opening Map...');
      } else {
        toast.error(response?.data?.message || 'Order already taken or unavailable');
        throw new Error('Accept failed');
      }
    } catch (error) {
      console.error('Accept Order Error:', error);
      const msg = error?.response?.data?.error || error?.response?.data?.message || 'Network error. Please try again.';
      // If the backend says already accepted by another — show friendly message
      if (error?.response?.status === 403 || msg.toLowerCase().includes('already accepted')) {
        toast.error('This order was just taken by another delivery partner.', { duration: 4000 });
      } else {
        toast.error(msg);
      }
      throw error;
    } finally {
      acceptOrderInFlight.current = false;
    }
  };


  /**
   * Mark "Reached Pickup" (Arrival at restaurant)
   */
  const reachPickup = async () => {
    const orderId = resolveOrderId();
    if (!orderId) {
      toast.error('Order id not found. Please refresh current trip.');
      throw new Error('Missing order id');
    }
    try {
      const response = await apiFor().confirmReachedPickup(orderId);
      if (response?.data?.success) {
        const updatedOrder = response.data.data?.order;
        if (updatedOrder) {
          setActiveOrder({
            ...(activeOrder || {}),
            ...updatedOrder,
            restaurantLocation: activeOrder?.restaurantLocation,
            customerLocation: activeOrder?.customerLocation,
          });
        }
        updateTripStatus('REACHED_PICKUP');
      } else {
        throw new Error('Confirm pickup failed');
      }
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.response?.data?.message || 'Failed to update status');
      throw error;
    }
  };

  /**
   * Mark "Picked Up" (Confirm order ID & start delivery)
   */
  const pickUpOrder = async (billImageUrl) => {
    const orderId = resolveOrderId();
    if (!orderId) {
      toast.error('Order id not found. Please refresh current trip.');
      throw new Error('Missing order id');
    }
    try {
      // confirmOrderId(orderId, confirmedOrderId, location, data)
      const response = await apiFor().confirmOrderId(
        orderId,
        activeOrder.displayOrderId || orderId,
        riderLocation || {},
        { billImageUrl }
      );

      if (response?.data?.success) {
        const updatedOrder = response.data.data?.order;
        if (updatedOrder) {
          const getLoc = (ref, keysLat, keysLng) => {
            if (!ref) return null;
            if (ref.location) {
              if (Array.isArray(ref.location.coordinates) && ref.location.coordinates.length >= 2) {
                return { lat: ref.location.coordinates[1], lng: ref.location.coordinates[0] };
              }
              return { lat: ref.location.latitude || ref.location.lat, lng: ref.location.longitude || ref.location.lng };
            }
            for (const k of keysLat) { if (ref[k] != null) return { lat: ref[k], lng: ref[keysLng[keysLat.indexOf(k)]] }; }
            return null;
          };

          let nextRestaurantLocation = activeOrder?.restaurantLocation || null;
          let nextPickupName = '';
          if (updatedOrder.isMultiRestaurant && Array.isArray(updatedOrder.pickups)) {
            const nextPickup = [...updatedOrder.pickups]
              .filter(
                (p) =>
                  !p.permanentlyDropped &&
                  !['picked_up', 'ready_for_handover', 'cancelled'].includes(String(p.status || '')),
              )
              .sort((a, b) => (Number(a.sequence) || 0) - (Number(b.sequence) || 0))[0];
            if (nextPickup) {
              nextPickupName = nextPickup.restaurantName || '';
              nextRestaurantLocation = getLoc(nextPickup, ['latitude', 'lat'], ['longitude', 'lng'])
                || getLoc(nextPickup.location, ['latitude', 'lat'], ['longitude', 'lng'])
                || nextRestaurantLocation;
            }
          }

          // Sync local order state (includes updated pickups array + next stop coords)
          setActiveOrder({
            ...activeOrder,
            ...updatedOrder,
            restaurantLocation: nextRestaurantLocation,
            customerLocation: activeOrder?.customerLocation,
          });

          // Dual-leg: each driver can finish their own pickup even if the other
          // partner has not collected yet (parent may still be ready_for_pickup).
          const riderId = getCurrentRiderId();
          const myLeg = getMyLeg(updatedOrder, riderId);
          const myLegCollected = Boolean(
            myLeg && ['picked_up', 'at_drop', 'delivered'].includes(String(myLeg.status || '')),
          );

          const isFullyPicked = updatedOrder.orderStatus === 'picked_up' || updatedOrder.status === 'picked_up';
          const waitMsg = getPartnerWaitMessage(updatedOrder, riderId);
          const waitingOnPartnerPickup =
            isDualLegOrder(updatedOrder) &&
            myLegCollected &&
            !isFullyPicked &&
            Boolean(waitMsg);

          if (waitingOnPartnerPickup) {
            // Stay on restaurant UI with an explicit wait banner (do not jump to drop yet).
            updateTripStatus('REACHED_PICKUP');
            toast.info(waitMsg.body);
          } else if (isFullyPicked || myLegCollected) {
            updateTripStatus('PICKED_UP');
            toast.success(
              myLegCollected && !isFullyPicked
                ? 'Your items collected! Heading to Drop-off'
                : 'All restaurants picked up! Heading to customer',
            );
          } else {
            // Revert to PICKING_UP to target the NEXT restaurant in the pickups array
            updateTripStatus('PICKING_UP');
            toast.success(
              nextPickupName
                ? `Pickup done. Next: ${nextPickupName} — reach store, then capture bill.`
                : 'Pickup confirmed. Continue to the next restaurant.',
            );
          }
        } else {
          updateTripStatus('PICKED_UP');
        }
      } else {
        throw new Error('Confirm order ID failed');
      }
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.response?.data?.message || 'Error confirming pickup');
      throw error;
    }
  };

  /**
   * Mark "Reached Drop" (Arrival at customer)
   */
  const reachDrop = async () => {
    const orderId = resolveOrderId();
    if (!orderId) {
      toast.error('Order id not found. Please refresh current trip.');
      throw new Error('Missing order id');
    }
    try {
      const response = await apiFor().confirmReachedDrop(orderId);
      if (response?.data?.success) {
        updateTripStatus('REACHED_DROP');
        // toast.info('Arrived at Customer Location');
      } else {
        throw new Error('Confirm drop failed');
      }
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.response?.data?.message || 'Failed to notify arrival');
      throw error;
    }
  };

  /**
   * Finalize Delivery with OTP Check
   */
  const completeDelivery = async (otp, paymentMethodOverride = null) => {
    const orderId = resolveOrderId();
    if (!orderId) {
      toast.error('Order id not found. Please refresh current trip.');
      throw new Error('Missing order id');
    }
    try {
      let finalOrder = activeOrder;

      const riderId = getCurrentRiderId();
      const myLeg = getMyLeg(activeOrder, riderId);
      const isDualLeg = isDualLegOrder(activeOrder);

      // Dual-leg: each driver must verify THEIR own OTP — never skip via order-level flag.
      const isAlreadyVerified = isDualLeg
        ? Boolean(myLeg?.otpVerified)
        : Boolean(activeOrder?.deliveryVerification?.dropOtp?.verified);

      if (!isAlreadyVerified) {
        if (!otp || otp === 'VERIFIED') {
          toast.error('Handover code is required');
          throw new Error('Missing OTP');
        }
        const verifyRes = await apiFor().verifyDropOtp(orderId, otp);
        if (verifyRes?.data?.success) {
          finalOrder = verifyRes.data?.data?.order || activeOrder;
        } else {
          toast.error('Invalid OTP. Please check with customer.');
          throw new Error('Invalid OTP');
        }
      }

      try {
        const completeRes = await apiFor().completeDelivery(orderId, {
          otp: otp && otp !== 'VERIFIED' ? otp : undefined,
          rating: 5,
          paymentMethod: paymentMethodOverride,
        });
        if (completeRes.data?.success && completeRes.data?.data?.order) {
          finalOrder = completeRes.data.data.order;
        }
      } catch (completeErr) {
        const msg =
          completeErr?.response?.data?.error ||
          completeErr?.response?.data?.message ||
          completeErr?.message;
        toast.error(msg || 'Could not complete delivery');
        throw completeErr;
      }

      if (finalOrder) setActiveOrder(finalOrder);

      // Dual-leg: this driver's trip ends when complete succeeds so the map polyline clears.
      const otherLeg = getOtherLeg(finalOrder, getCurrentRiderId());
      const orderDone = String(finalOrder?.orderStatus || '') === 'delivered';
      updateTripStatus('COMPLETED');
      if (
        isDualLegOrder(finalOrder) &&
        !orderDone &&
        otherLeg &&
        String(otherLeg.status || '') !== 'delivered'
      ) {
        toast.info('Your delivery is done. Waiting for your partner to finish.');
      }
    } catch (error) {
      console.error('Completion Error:', error);
      if (!error?.response) {
        toast.error(
          error?.response?.data?.error ||
          error?.response?.data?.message ||
          error?.message ||
          'Verification failed',
        );
      }
      throw error;
    }
  };

  const resetTrip = () => {
    clearActiveOrder();
  };

  return {
    acceptOrder,
    reachPickup,
    pickUpOrder,
    reachDrop,
    completeDelivery,
    resetTrip,
  };
};
