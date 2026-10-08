import React, { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChefHat, MapPin, Phone,
  ChevronDown, ChevronUp, Package,
  Navigation, CheckCircle2, Camera, Loader2, Image as ImageIcon,
  Clock
} from 'lucide-react';
import { ActionSlider } from '@/modules/DeliveryV2/components/ui/ActionSlider';
import { uploadAPI, deliveryAPI, adminAPI } from '@food/api';
import { toast } from 'sonner';
import { openCamera } from "@food/utils/imageUploadUtils";
import { Share2, Users, PhoneCall } from 'lucide-react';
import { useDeliveryStore } from '@/modules/DeliveryV2/store/useDeliveryStore';
import { formatKm } from '@/modules/DeliveryV2/utils/geo';
import {
  getCurrentRiderId,
  resolveCoDriver,
  toPartnerId,
  getPartnerWaitMessage,
  getMyLeg,
  isDualLegOrder,
} from '@/modules/DeliveryV2/utils/partnerIdentity';

/**
 * PickupActionModal - Unified White/Green Theme with Slider Actions.
 * Includes Bill Upload feature prior to pickup.
 */
export const PickupActionModal = ({
  order,
  status,
  isWithinRange,
  distanceToTarget,
  eta,
  onReachedPickup,
  onPickedUp,
  onMinimize,
}) => {
  const [showItems, setShowItems] = useState(false);
  const [isUploadingBill, setIsUploadingBill] = useState(false);
  const [billImageUploaded, setBillImageUploaded] = useState(false);
  const [billImageUrl, setBillImageUrl] = useState(null);
  const [isSharing, setIsSharing] = useState(false);
  const [splitThreshold, setSplitThreshold] = useState(20);
  const [showDelayPicker, setShowDelayPicker] = useState(false);
  const cameraInputRef = useRef(null);

  const delayReasons = [
    { label: "Heavy Traffic", icon: "🚦", value: "Heavy Traffic 🚦" },
    { label: "Busy Kitchen", icon: "👨‍🍳", value: "Busy Kitchen 👨‍🍳" },
    { label: "Vehicle Issue", icon: "🛵", value: "Vehicle Issue 🛵" },
    { label: "Rain/Weather", icon: "🌧️", value: "Rain/Weather 🌧️" }
  ];

  // Current multi-restaurant stop — follow driver-chosen sequence
  const currentPickupKey = useMemo(() => {
    if (order?.isMultiRestaurant && Array.isArray(order.pickups) && order.pickups.length > 0) {
      const remaining = order.pickups
        .filter(
          (p) =>
            !p.permanentlyDropped &&
            !['picked_up', 'ready_for_handover', 'cancelled'].includes(String(p.status || '')),
        )
        .sort((a, b) => (Number(a.sequence) || 0) - (Number(b.sequence) || 0));
      const next = remaining[0];
      if (next) {
        return String(next.restaurantId || next._id || next.restaurantName || '');
      }
    }
    return String(order?._id || order?.orderId || 'single');
  }, [order?._id, order?.orderId, order?.isMultiRestaurant, order?.pickups]);

  const orderedPickups = useMemo(() => {
    const list = Array.isArray(order?.pickups) ? [...order.pickups] : [];
    return list.sort((a, b) => (Number(a.sequence) || 0) - (Number(b.sequence) || 0));
  }, [order?.pickups]);

  const activePickups = useMemo(
    () =>
      orderedPickups.filter(
        (p) => !p.permanentlyDropped && String(p.status || '') !== 'cancelled',
      ),
    [orderedPickups],
  );

  const currentPickup = useMemo(() => {
    return (
      activePickups.find(
        (p) => !['picked_up', 'ready_for_handover'].includes(String(p.status || '')),
      ) || null
    );
  }, [activePickups]);

  const currentPickupName =
    currentPickup?.restaurantName ||
    order.restaurantName ||
    order.restaurant_name ||
    'Restaurant';
  const currentPickupAddress =
    currentPickup?.location?.address ||
    currentPickup?.location?.formattedAddress ||
    currentPickup?.restaurantAddress ||
    order.restaurantAddress ||
    order.restaurant_address ||
    order.restaurantLocation?.address ||
    'Address not available';
  const currentPickupPhone =
    currentPickup?.phone ||
    order.restaurantPhone ||
    order.restaurant_phone ||
    order.restaurantId?.phone ||
    '';
  const pickedCount = activePickups.filter((p) =>
    ['picked_up', 'ready_for_handover'].includes(String(p.status || '')),
  ).length;

  useEffect(() => {
    setBillImageUploaded(false);
    setBillImageUrl(null);
    setIsUploadingBill(false);
  }, [currentPickupKey]);

  const handleReportDelay = async (reason) => {
    try {
      await deliveryAPI.reportDelay(order._id || order.orderId, reason);
      toast.success("Delay reported to customer");
      setShowDelayPicker(false);
    } catch (err) {
      toast.error("Failed to report delay");
    }
  };

  React.useEffect(() => {
    const fetchSettings = async () => {
      try {
        const response = await adminAPI.getDeliveryBoySettings();
        const settings = response?.data?.data || response?.data || {};
        if (settings.splitOrderThreshold) {
          setSplitThreshold(settings.splitOrderThreshold);
        }
      } catch (error) {
        // Silently fail
      }
    };
    fetchSettings();
  }, []);

  if (!order) return null;

  const handleBillImageSelect = async (file) => {
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image size should be less than 5MB');
      return;
    }

    setIsUploadingBill(true);
    try {
      const res = await uploadAPI.uploadMedia(file, { folder: 'appzeto/delivery/bills' });
      if (res?.data?.success && res?.data?.data) {
        setBillImageUrl(res.data.data.url || res.data.data.secure_url);
        setBillImageUploaded(true);
        // toast.success('Bill image uploaded!');
      } else {
        throw new Error('Upload failed');
      }
    } catch (err) {
      toast.error('Failed to upload bill image');
      setBillImageUploaded(false);
      setBillImageUrl(null);
    } finally {
      setIsUploadingBill(false);
    }
  };

  const handleTakeCameraPhoto = () => {
    openCamera({
      onSelectFile: (file) => handleBillImageSelect(file),
      fileNamePrefix: `bill-${order.orderId || order._id}`
    })
  }

  const handlePickFromGallery = () => {
    cameraInputRef.current?.click()
  }

  const handleFindNewDriver = async () => {
    try {
      setIsSharing(true);
      const res = await deliveryAPI.shareOrder(order._id || order.orderId);
      if (res?.data?.success) {
        toast.success("Looking for another driver…");
        const { activeOrder, setActiveOrder } = useDeliveryStore.getState();
        if (activeOrder && (activeOrder._id === order._id || activeOrder.orderId === order.orderId)) {
          setActiveOrder({
            ...activeOrder,
            dispatch: {
              ...activeOrder.dispatch,
              isShared: true,
              shareOpenedAt: new Date().toISOString(),
            }
          });
        }
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to find a new driver");
    } finally {
      setIsSharing(false);
    }
  };

  // Get rider ID: delivery_user localStorage is most reliable (has actual partner _id)
  const currentRiderId = getCurrentRiderId();
  const primaryId = toPartnerId(order.dispatch?.deliveryPartnerId);
  const secondaryId = toPartnerId(order.dispatch?.sharedPartnerId);

  const isPrimaryRider = Boolean(currentRiderId) && primaryId === String(currentRiderId);
  const isSharedRider = Boolean(currentRiderId) && secondaryId === String(currentRiderId);
  // Partner actually joined (not just "searching")
  const partnerJoined = Boolean(secondaryId);
  const isSearchingPartner = Boolean(order.dispatch?.isShared) && !partnerJoined;
  // This modal only opens for the assigned driver's active trip — each driver
  // completes pickup independently. Backend still validates ownership.
  const canActOnPickup = true;

  // Contact only after the second driver has accepted — resolve the *other* driver
  const otherPartner = resolveCoDriver(order, currentRiderId);
  const waitMessage = getPartnerWaitMessage(order, currentRiderId);
  const myLeg = getMyLeg(order, currentRiderId);
  const myAlreadyPicked = ['picked_up', 'at_drop', 'delivered'].includes(
    String(myLeg?.status || ''),
  );

  const handleCallPartner = () => {
    const phone = otherPartner?.phoneNumber || otherPartner?.phone;
    if (phone) window.open(`tel:${phone}`);
    else toast.error('Partner phone number not available');
  };

  const isAtPickup = status === 'REACHED_PICKUP';
  // Dual-leg: each driver must reach independently — never use parent deliveryState
  // (first arriver would unlock bill/pickup for the partner who is still en route).
  const myLegStatus = String(myLeg?.status || '');
  const hasReachedPickup = isDualLegOrder(order)
    ? ['at_pickup', 'picked_up', 'at_drop', 'delivered'].includes(myLegStatus) ||
      status === 'REACHED_PICKUP' ||
      myAlreadyPicked
    : order.deliveryState?.status === 'reached_pickup' ||
      order.deliveryState?.currentPhase === 'at_pickup' ||
      status === 'REACHED_PICKUP';
  const isPending = order.orderStatus === 'created';

  const totalQuantity = React.useMemo(() => {
    let count = 0;
    if (Array.isArray(order.items)) {
      count = order.items.reduce((acc, item) => acc + (Number(item.quantity) || 1), 0);
    } else if (Array.isArray(order.pickups)) {
      order.pickups.forEach(p => {
        if (Array.isArray(p.items)) count += p.items.length;
        else if (p.quantity) count += Number(p.quantity);
      });
    }
    return count;
  }, [order.items, order.pickups]);

  const restaurantName = currentPickupName;
  const restaurantAddress = currentPickupAddress;
  const restaurantPhone = currentPickupPhone;
  const items = order.items || [];
  const restaurantLogo = order.restaurantImage || order.restaurant?.logo || order.restaurant?.profileImage || 'https://cdn-icons-png.flaticon.com/512/3170/3170733.png';

  return (
    <div className="fixed inset-0 z-[2000] p-0 sm:p-4 flex items-end justify-center">
      {/* Background Dim */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="absolute inset-0 bg-black/40 -z-10"
      />

      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        className="w-full max-w-md sm:max-w-lg bg-white rounded-t-3xl sm:rounded-t-[2.5rem] shadow-[0_-20px_60px_rgba(0,0,0,0.3)] p-4 sm:p-6 pb-[120px] sm:pb-[140px] max-h-[84vh] overflow-y-auto"
      >
        {/* Handle / Minimize */}
        <div className="w-full flex justify-center pb-2 sm:pb-4 pt-1">
          <button onClick={onMinimize} className="p-1 hover:bg-gray-100 active:scale-95 transition-all rounded-full flex flex-col items-center">
            <ChevronDown className="w-6 h-6 text-gray-400 stroke-3" />
          </button>
        </div>

        {/* Restaurant Header */}
        {!order.isMultiRestaurant ? (
          <div className="flex items-start justify-between mb-5 sm:mb-8 pb-3 sm:pb-4 border-b border-gray-50 gap-2">
            <div className="flex gap-3 sm:gap-4 min-w-0 flex-1">
              <div className="w-14 h-14 shrink-0 bg-white rounded-2xl flex items-center justify-center shadow-lg shadow-black/5 overflow-hidden border border-gray-100">
                <img src={restaurantLogo} alt="Logo" className="w-full h-full object-cover" />
              </div>
              <div className="min-w-0">
                <h3 className="text-gray-950 text-lg sm:text-xl font-bold break-words">{restaurantName}</h3>
                <p className="text-gray-500 text-[10px] font-bold uppercase tracking-widest flex items-center gap-1 mt-1.5">
                  {hasReachedPickup ? (
                    <span className="text-green-600">Reached Store √</span>
                  ) : (
                    <span className="text-orange-500">
                      {formatKm(distanceToTarget)} km • {eta || '--'} min to Store
                    </span>
                  )}
                </p>
              </div>
            </div>

            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => setShowDelayPicker(true)}
                className="w-10 h-10 rounded-full bg-orange-50 flex items-center justify-center text-orange-600 border border-orange-100"
                title="Report Delay"
              >
                <Clock className="w-5 h-5" />
              </button>
              {restaurantPhone && (
                <button
                  onClick={() => window.location.href = `tel:${restaurantPhone}`}
                  className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center text-green-600 border border-green-100"
                >
                  <Phone className="w-5 h-5" />
                </button>
              )}
              <button
                onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(restaurantAddress)}`, '_blank')}
                className="w-10 h-10 rounded-full bg-gray-900 flex items-center justify-center text-white shadow-lg"
              >
                <Navigation className="w-5 h-5" />
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 mb-6">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Multi-Pickup Route</p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowDelayPicker(true)}
                  className="w-7 h-7 rounded-full bg-orange-50 flex items-center justify-center text-orange-600 border border-orange-100"
                  title="Report Delay"
                >
                  <Clock className="w-4 h-4" />
                </button>
                <p className="text-[10px] font-bold text-orange-500 uppercase tracking-widest">
                  {pickedCount} / {activePickups.length} Picked
                </p>
              </div>
            </div>

            {currentPickup ? (
              <div className="rounded-2xl bg-orange-500 text-white p-3.5 shadow-lg shadow-orange-200">
                <p className="text-[10px] font-bold uppercase tracking-widest text-orange-100">
                  Now picking up
                </p>
                <p className="text-base font-bold mt-0.5">{currentPickupName}</p>
                <p className="text-[11px] text-orange-50/90 mt-1 line-clamp-2">{currentPickupAddress}</p>
                <div className="mt-2 flex gap-2">
                  {currentPickupPhone ? (
                    <button
                      type="button"
                      onClick={() => { window.location.href = `tel:${currentPickupPhone}`; }}
                      className="flex-1 py-2 rounded-xl bg-white/15 text-xs font-semibold inline-flex items-center justify-center gap-1.5"
                    >
                      <Phone className="w-3.5 h-3.5" /> Call
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() =>
                      window.open(
                        `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(currentPickupAddress)}`,
                        '_blank',
                      )
                    }
                    className="flex-1 py-2 rounded-xl bg-white text-orange-700 text-xs font-semibold inline-flex items-center justify-center gap-1.5"
                  >
                    <Navigation className="w-3.5 h-3.5" /> Navigate
                  </button>
                </div>
              </div>
            ) : null}

            {orderedPickups.map((p, idx) => {
              const cancelled =
                Boolean(p.permanentlyDropped) ||
                String(p.status || '').toLowerCase() === 'cancelled';
              const isDone = ['picked_up', 'ready_for_handover'].includes(String(p.status || ''));
              const isCurrent =
                !cancelled &&
                !isDone &&
                String(p.restaurantId || '') === String(currentPickup?.restaurantId || '');

              return (
                <div
                  key={String(p.restaurantId || idx)}
                  className={`p-4 rounded-2xl border-2 transition-all min-w-0 ${
                    cancelled
                      ? 'bg-rose-50/50 border-rose-100 opacity-80'
                      : isCurrent
                        ? 'bg-orange-50/50 border-orange-200'
                        : isDone
                          ? 'bg-green-50/30 border-green-100 opacity-60'
                          : 'bg-gray-50/50 border-gray-100'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 min-w-0">
                    <div className="flex gap-3 min-w-0 flex-1">
                      <div
                        className={`w-10 h-10 shrink-0 rounded-xl flex items-center justify-center shadow-sm ${
                          cancelled
                            ? 'bg-rose-100 text-rose-500'
                            : isCurrent
                              ? 'bg-orange-500 text-white'
                              : isDone
                                ? 'bg-green-500 text-white'
                                : 'bg-white text-gray-400'
                        }`}
                      >
                        {isDone ? (
                          <CheckCircle2 className="w-5 h-5" />
                        ) : (
                          <ChefHat className="w-5 h-5" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h4 className="text-sm font-bold text-gray-950 break-words [overflow-wrap:anywhere]">
                          {p.restaurantName}
                        </h4>
                        <div className="flex flex-wrap items-start gap-1.5 mt-0.5">
                          <p className="text-[10px] text-gray-500 break-words [overflow-wrap:anywhere] min-w-0 flex-1">
                            {p.location?.address || p.restaurantAddress || 'Pickup location'}
                          </p>
                          <span
                            className={`shrink-0 text-[8px] px-1.5 py-0.5 rounded-full font-bold uppercase ${
                              cancelled
                                ? 'bg-rose-100 text-rose-700'
                                : isDone
                                  ? 'bg-green-100 text-green-700'
                                  : isCurrent
                                    ? 'bg-orange-100 text-orange-700'
                                    : p.status === 'ready'
                                      ? 'bg-blue-100 text-blue-700'
                                      : 'bg-gray-100 text-gray-500'
                            }`}
                          >
                            {cancelled
                              ? 'Cancelled'
                              : isDone
                                ? 'Picked'
                                : isCurrent
                                  ? 'Current'
                                  : String(p.status || 'pending').replace(/_/g, ' ')}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Action Sliders */}
        <div className="space-y-4 sm:space-y-6">
          {!hasReachedPickup ? (
            <div>
              <p className={`text-center text-[10px] font-bold uppercase tracking-widest mb-3 transition-colors ${isPending ? 'text-red-500' : isWithinRange ? 'text-green-600' : 'text-orange-500 animate-pulse'
                }`}>
                {isPending
                  ? 'Wait for Restaurant to Accept Order...'
                  : isWithinRange
                    ? `Ready — swipe when at ${currentPickupName}`
                    : `Heading to ${currentPickupName}`}
              </p>
              <ActionSlider
                key="action-reach"
                label={isPending ? "Waiting for Restaurant..." : "Slide to Reach"}
                successLabel="Reached!"
                disabled={!isWithinRange || isPending}
                onConfirm={onReachedPickup}
                color={isPending ? "bg-gray-400" : "bg-green-600"}
              />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex justify-center items-center gap-3 w-full">
                {!billImageUploaded && !isUploadingBill && canActOnPickup && (
                  <>
                    <button
                      onClick={handleTakeCameraPhoto}
                      className="flex-1 flex items-center justify-center gap-2 py-3 sm:py-4 rounded-2xl bg-gray-900 text-white font-bold text-[11px] sm:text-xs uppercase tracking-widest shadow-lg active:scale-95 transition-all"
                    >
                      <Camera className="w-5 h-5" />
                      <span>Camera</span>
                    </button>
                    <button
                      onClick={handlePickFromGallery}
                      className="flex-1 flex items-center justify-center gap-2 py-3 sm:py-4 rounded-2xl bg-orange-50 text-orange-600 border border-orange-100 font-bold text-[11px] sm:text-xs uppercase tracking-widest active:scale-95 transition-all"
                    >
                      <ImageIcon className="w-5 h-5" />
                      <span>Gallery</span>
                    </button>
                  </>
                )}

                {isUploadingBill && (
                  <div className="w-full flex items-center justify-center gap-2 py-3 sm:py-4 rounded-2xl bg-gray-50 text-gray-400 font-bold text-[11px] sm:text-xs uppercase tracking-widest">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Uploading...</span>
                  </div>
                )}

                {billImageUploaded && (
                  <div className="w-full flex items-center justify-center gap-2 py-3 sm:py-4 rounded-2xl bg-green-100 text-green-700 font-bold text-[11px] sm:text-xs uppercase tracking-widest">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Bill Uploaded</span>
                  </div>
                )}

                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => handleBillImageSelect(e.target.files[0])}
                  className="hidden"
                />
              </div>

              {/* Optional second driver for large orders — primary decides at pickup */}
              {totalQuantity >= splitThreshold && !isSearchingPartner && !partnerJoined && !isSharedRider && (
                <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 flex flex-col gap-3 mt-2">
                  <div className="flex gap-3 items-start">
                    <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 shrink-0">
                      <Users className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                      <p className="text-[10px] font-bold text-blue-700 uppercase tracking-widest mb-1">
                        Need another driver?
                      </p>
                      <p className="text-xs font-medium text-blue-900 leading-tight">
                        This order has {totalQuantity} items. If you need help, find a new driver. Otherwise you can complete this order yourself.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleFindNewDriver}
                    disabled={isSharing}
                    className="w-full py-3 rounded-xl bg-blue-600 text-white font-bold text-[10px] uppercase tracking-widest shadow-md active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {isSharing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
                    <span>Find New Driver</span>
                  </button>
                </div>
              )}

              {/* Searching — no call button until a partner actually joins */}
              {isSearchingPartner && (
                <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 flex gap-3 items-start mt-2">
                  <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-amber-600 shrink-0">
                    <Loader2 className="w-5 h-5 animate-spin" />
                  </div>
                  <div className="flex-1">
                    <p className="text-[10px] font-bold text-amber-700 uppercase tracking-widest mb-1">
                      Waiting for second driver
                    </p>
                    <p className="text-xs font-medium text-amber-900 leading-tight">
                      Waiting for another driver to accept. You can keep picking up — if none joins, complete alone after the search times out.
                    </p>
                  </div>
                </div>
              )}

              {/* Partner joined but this driver is ahead — wait for their action */}
              {!isSearchingPartner && waitMessage && (
                <div className={`rounded-2xl p-4 flex gap-3 items-start mt-2 border ${
                  waitMessage.role === 'need_my_pickup' || waitMessage.role === 'need_my_arrival'
                    ? 'bg-orange-50 border-orange-100'
                    : 'bg-amber-50 border-amber-100'
                }`}>
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                    waitMessage.role === 'need_my_pickup' || waitMessage.role === 'need_my_arrival'
                      ? 'bg-orange-100 text-orange-600'
                      : 'bg-amber-100 text-amber-600'
                  }`}>
                    <Loader2 className="w-5 h-5 animate-spin" />
                  </div>
                  <div className="flex-1">
                    <p className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${
                      waitMessage.role === 'need_my_pickup' || waitMessage.role === 'need_my_arrival'
                        ? 'text-orange-700'
                        : 'text-amber-700'
                    }`}>
                      {waitMessage.title}
                    </p>
                    <p className={`text-xs font-medium leading-tight ${
                      waitMessage.role === 'need_my_pickup' || waitMessage.role === 'need_my_arrival'
                        ? 'text-orange-900'
                        : 'text-amber-900'
                    }`}>
                      {waitMessage.body}
                    </p>
                  </div>
                </div>
              )}

              {/* Partner joined — both drivers can call each other */}
              {partnerJoined && otherPartner && (
                <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 flex flex-col gap-3 mt-2">
                  <div className="flex gap-3 items-center">
                    <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
                      <Users className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-bold text-indigo-700 uppercase tracking-widest mb-1">
                        Delivery Partner
                      </p>
                      <p className="text-xs font-bold text-indigo-900 truncate">
                        {otherPartner.fullName || otherPartner.name || 'Delivery Partner'}
                      </p>
                      <p className="text-[10px] font-medium text-indigo-600 mt-0.5">
                        Complete your pickup. Pay follows each driver’s employment (per-order / salary).
                      </p>
                    </div>
                    <button
                      onClick={handleCallPartner}
                      className="w-10 h-10 rounded-full bg-indigo-600 flex items-center justify-center text-white shadow-lg active:scale-95 transition-all shrink-0"
                      title="Call partner"
                    >
                      <PhoneCall className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {myAlreadyPicked ? (
                <div className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-amber-100 text-amber-800 font-bold text-[11px] sm:text-xs uppercase tracking-widest mt-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Waiting for other driver to accept / slide pickup</span>
                </div>
              ) : (
                <div>
                  <p className={`text-center text-[10px] font-bold uppercase tracking-widest mb-3 ${billImageUploaded ? 'text-green-600' : 'text-gray-400'}`}>
                    {billImageUploaded ? "Check the restaurant logo - Swipe to pick up" : "Capture bill to unlock swipe"}
                  </p>
                  {canActOnPickup && (
                    <ActionSlider
                      key="action-pickup"
                      label="Slide to Pick Up"
                      successLabel="Picked Up!"
                      disabled={!billImageUploaded}
                      onConfirm={() => onPickedUp(billImageUrl)}
                      color="bg-orange-500"
                    />
                  )}
                </div>
              )}
            </div>
          )}

          {/* Delivery Instructions (User Note) */}
          {order?.note && (
            <div className="bg-orange-50 border border-orange-100 rounded-2xl p-3.5 sm:p-4 flex gap-3 items-start">
              <ChefHat className="w-5 h-5 text-orange-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-[10px] font-bold text-orange-600 uppercase tracking-widest mb-1.5">User Instructions</p>
                <p className="text-sm font-bold text-gray-800 leading-snug">"{order.note}"</p>
              </div>
            </div>
          )}

          {/* Collapsible Order Summary */}
          <button
            onClick={() => setShowItems(!showItems)}
            className="w-full flex items-center justify-between p-3.5 sm:p-4 bg-gray-50 rounded-2xl hover:bg-gray-100 transition-colors"
          >
            <div className="flex items-center gap-3 text-gray-900 font-bold text-xs uppercase tracking-widest">
              <Package className="w-5 h-5 text-gray-400" />
              <span>Order Details ({items.length || 0})</span>
            </div>
            {showItems ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>

          {showItems && (
            <div className="overflow-hidden space-y-2 px-1">
              {items.map((item, idx) => (
                <div key={idx} className="flex justify-between items-center p-3 border-b border-gray-50 last:border-0">
                  <span className="text-gray-700 text-sm font-bold">{item.name || 'Item Name'}</span>
                  <span className="text-green-600 font-bold bg-green-50 px-2.5 py-1 rounded-lg text-xs">x{item.quantity || 1}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>

      {/* Delay Selection Modal */}
      <AnimatePresence>
        {showDelayPicker && (
          <div className="fixed inset-0 z-[1100] flex items-end justify-center p-0 sm:p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowDelayPicker(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              className="relative w-full max-w-md bg-white rounded-t-[2.5rem] p-6 pb-12 shadow-2xl"
            >
              <div className="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mb-6" />
              <h3 className="text-xl font-black text-gray-900 mb-2">Report Delay</h3>
              <p className="text-sm text-gray-500 mb-6 font-medium">Why is it taking longer? Select a reason to inform the customer.</p>

              <div className="grid grid-cols-2 gap-3">
                {delayReasons.map((r, i) => (
                  <button
                    key={i}
                    onClick={() => handleReportDelay(r.value)}
                    className="flex flex-col items-center gap-3 p-5 rounded-3xl bg-gray-50 border border-gray-100 hover:bg-orange-50 hover:border-orange-200 hover:scale-[1.02] active:scale-95 transition-all"
                  >
                    <span className="text-3xl">{r.icon}</span>
                    <span className="text-xs font-bold text-gray-700 uppercase tracking-wider">{r.label}</span>
                  </button>
                ))}
              </div>

              <button
                onClick={() => setShowDelayPicker(false)}
                className="w-full mt-6 py-4 rounded-2xl text-gray-400 font-bold text-xs uppercase tracking-widest hover:text-gray-600 transition-colors"
              >
                Cancel
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default PickupActionModal;

