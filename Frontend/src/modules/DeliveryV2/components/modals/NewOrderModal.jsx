import React, { useEffect, useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { MapPin, Clock, ChefHat, ChevronDown, AlertTriangle } from 'lucide-react';
import { ActionSlider } from '@/modules/DeliveryV2/components/ui/ActionSlider';
import { useDeliveryStore } from '@/modules/DeliveryV2/store/useDeliveryStore';
import {
  getHaversineDistance,
  extractLatLng,
  resolvePickupLatLng,
} from '@/modules/DeliveryV2/utils/geo';

function resolvePickupAddress(pickup, fallback = '') {
  const parts = [
    pickup?.restaurantAddress,
    pickup?.location?.address,
    pickup?.address,
    pickup?.restaurant_address,
  ]
    .map((v) => String(v || '').trim())
    .filter(Boolean);

  if (parts.length) return parts[0];

  const coords = pickup?.location?.coordinates;
  if (Array.isArray(coords) && coords.length >= 2) {
    return `Lat ${Number(coords[1]).toFixed(5)}, Lng ${Number(coords[0]).toFixed(5)}`;
  }

  return fallback || 'Address not available';
}

function LocationStep({
  icon: Icon,
  label,
  title,
  address,
  isLast = false,
  accentDotClass = 'bg-[#16A34A]',
  labelClass = 'text-[#16A34A]',
  mapsLink = null,
}) {
  return (
    <div className="flex gap-3 min-w-0">
      <div className="flex flex-col items-center w-5 shrink-0 pt-0.5">
        <div
          className={`w-5 h-5 rounded-full ${accentDotClass} border-4 border-[#F0FDF4] shadow-md shrink-0`}
        />
        {!isLast && (
          <div className="w-0.5 flex-1 min-h-[1.25rem] my-1 border-l-2 border-dashed border-[#D1D5DB]" />
        )}
      </div>

      <div className={`flex-1 min-w-0 ${isLast ? 'pb-1' : 'pb-5'}`}>
        <div className={`flex items-center gap-2 mb-1.5 font-bold text-[10px] uppercase tracking-widest ${labelClass}`}>
          <Icon className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{label}</span>
        </div>
        <p className="text-[#0A1F0A] font-bold text-sm sm:text-base leading-snug break-words [overflow-wrap:anywhere]">
          {title}
        </p>
        <p className="mt-1 text-[#5D6D5D] text-xs sm:text-sm font-medium leading-relaxed break-words [overflow-wrap:anywhere] whitespace-pre-wrap">
          {address}
        </p>
        {mapsLink && (
          <a
            href={mapsLink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex mt-2 text-[10px] font-bold uppercase tracking-widest text-[#0A1F0A] hover:text-[#22C55E]"
          >
            Open in Google Maps
          </a>
        )}
      </div>
    </div>
  );
}

/**
 * NewOrderModal - Incoming order acceptance (supports multi-restaurant).
 * Header (amount + timer) and actions stay pinned; locations scroll with full wrap.
 */
export const NewOrderModal = ({ order, onAccept, onReject, onMinimize, riderProfile }) => {
  const { riderLocation } = useDeliveryStore();
  const [timeLeft, setTimeLeft] = useState(60);

  useEffect(() => {
    if (timeLeft <= 0) {
      onReject();
      return;
    }
    const timer = setInterval(() => setTimeLeft((t) => t - 1), 1000);
    return () => clearInterval(timer);
  }, [timeLeft, onReject]);

  const { distanceKm, etaMins } = useMemo(() => {
    if (!order) return { distanceKm: null, etaMins: null };

    const rawDist = order.pickupDistanceKm || order.distanceKm;
    const rawEta = order.estimatedTime || order.duration || order.eta;

    if (rawDist != null) {
      return {
        distanceKm: Number(rawDist).toFixed(1),
        etaMins: rawEta && rawEta > 0 ? Math.ceil(rawEta) : Math.ceil((rawDist * 1000) / 416) + 5,
      };
    }

    // A shared ("Find new driver") invite is broadcast to the whole rider room, so unlike a
    // dispatch offer it carries no per-rider `pickupDistanceKm` - this rider has to work it out
    // from their own GPS. resolvePickupLatLng handles GeoJSON, the flat lat/lng mirror and
    // multi-restaurant pickups alike; reading only `latitude`/`lat` used to miss restaurants
    // stored as GeoJSON and left the card showing "??".
    const pickupPoint = resolvePickupLatLng(order);
    const riderPoint = extractLatLng(riderLocation);

    if (riderPoint && pickupPoint) {
      const distM = getHaversineDistance(
        riderPoint.lat, riderPoint.lng,
        pickupPoint.lat, pickupPoint.lng,
      );
      const km = distM / 1000;
      const mins = Math.ceil(distM / 416) + (order.prepTime || 5);

      return {
        distanceKm: km.toFixed(1),
        etaMins: mins,
      };
    }

    return { distanceKm: null, etaMins: order.prepTime || 15 };
  }, [order, riderLocation]);

  if (!order) return null;

  const isShared = order.isShared || order.dispatch?.isShared;
  const isSalaryPartner =
    order.earningDisplayMode === 'salary' ||
    order.employmentType === 'salary' ||
    riderProfile?.employmentType === 'salary';
  const earnings = (() => {
    if (isSalaryPartner) return 0;
    const candidates = [
      order.riderEarning,
      order.earnings,
      order.deliveryBoyFee,
      order.pricing?.deliveryFeeBreakdown?.riderFee,
      order.pricing?.deliveryFeeBreakdown?.deliveryBoyFee,
    ];
    for (const value of candidates) {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) return n;
    }
    for (const value of candidates) {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) return n;
    }
    return 0;
  })();
  const totalOriginalEarning = order.sharedRiderEarning
    ? (Number(order.sharedRiderEarning) + Number(earnings))
    : (isShared ? earnings * 2 : earnings);

  const restaurantName = order.restaurantName || order.restaurant_name || (order.restaurantId?.name) || 'Restaurant';
  const restaurantAddress =
    order.restaurantAddress ||
    order.restaurant_address ||
    (order.restaurantId?.location?.address) ||
    'Address not available';
  const deliveryAddress = order?.deliveryAddress || {};

  const geoCoords =
    Array.isArray(deliveryAddress?.location?.coordinates) &&
    deliveryAddress.location.coordinates.length >= 2
      ? {
          lng: deliveryAddress.location.coordinates[0],
          lat: deliveryAddress.location.coordinates[1],
        }
      : null;

  const customerLocation = order.customerLocation || order.deliveryLocation || geoCoords || null;

  const addressPartsFromSchema = [
    deliveryAddress.street,
    deliveryAddress.additionalDetails,
    deliveryAddress.city,
    deliveryAddress.state,
    deliveryAddress.zipCode,
  ]
    .map((v) => String(v || '').trim())
    .filter(Boolean);

  const customerAddress =
    order.customerAddress ||
    order.customer_address ||
    (addressPartsFromSchema.length ? addressPartsFromSchema.join(', ') : '') ||
    (customerLocation?.lat != null && customerLocation?.lng != null
      ? `Lat ${Number(customerLocation.lat).toFixed(5)}, Lng ${Number(customerLocation.lng).toFixed(5)}`
      : 'Location not available');

  const mapsLink =
    customerLocation?.lat != null && customerLocation?.lng != null
      ? `https://www.google.com/maps?q=${encodeURIComponent(
          `${customerLocation.lat},${customerLocation.lng}`,
        )}`
      : null;

  const orderZone =
    order.zoneName ||
    order.zoneId?.name ||
    order.zoneId?.zoneName ||
    order.zone?.name ||
    order.restaurantId?.zone?.name ||
    order.restaurantId?.zoneName;
  const riderZoneId = riderProfile?.zone?._id || riderProfile?.zone;
  const orderZoneId =
    order.zoneId?._id ||
    order.zoneId ||
    order.zone?._id ||
    order.zone ||
    order.restaurantId?.zone?._id ||
    order.restaurantId?.zone;

  const isOutsideZone = riderZoneId && orderZoneId && String(riderZoneId) !== String(orderZoneId);

  const pickups =
    order.pickups && order.pickups.length > 0
      ? order.pickups
      : [{ restaurantName, restaurantAddress }];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-1000 bg-black/60 flex items-end justify-center p-0"
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="w-full max-w-md sm:max-w-lg max-h-[92dvh] bg-white rounded-t-3xl sm:rounded-t-[3rem] overflow-hidden shadow-[0_-20px_60px_rgba(0,0,0,0.5)] flex flex-col"
      >
        {/* Handle / Minimize */}
        <div className="w-full flex justify-center pb-1 pt-2 bg-white shrink-0 relative z-10">
          <button
            type="button"
            onClick={onMinimize}
            className="p-1 hover:bg-gray-100 active:scale-95 transition-all rounded-full flex flex-col items-center"
          >
            <ChevronDown className="w-6 h-6 text-gray-400 stroke-3" />
          </button>
        </div>

        {/* Header: amount + timer — never overflow */}
        <div className="px-4 sm:px-6 py-3 sm:py-4 flex items-start justify-between gap-3 text-white bg-[#0A1F0A] shrink-0 border-b border-white/5">
          <div className="min-w-0 flex-1 pr-1">
            <p className="text-white/60 text-[10px] font-bold uppercase tracking-widest mb-1 truncate">
              {isShared ? 'Special Shared Request' : 'Incoming Request'}
            </p>
            <h2
              className={`text-xl sm:text-3xl font-bold tracking-tight tabular-nums break-all [overflow-wrap:anywhere] ${
                isSalaryPartner
                  ? 'text-white text-lg sm:text-2xl'
                  : isShared
                    ? 'text-amber-400'
                    : 'text-[#16A34A]'
              }`}
            >
              {isSalaryPartner ? 'You are on salary' : `₹${Number(earnings || 0).toFixed(2)}`}
            </h2>
            {isSalaryPartner ? (
              <span className="block mt-0.5 text-[10px] text-white/50 font-medium leading-snug break-words">
                This order has no per-order payout
              </span>
            ) : isShared ? (
              <span className="block mt-0.5 text-[10px] text-white/40 font-medium leading-snug break-words">
                (50% of ₹{Number(totalOriginalEarning).toFixed(2)} Total)
              </span>
            ) : null}
          </div>
          <div className="shrink-0 bg-white/10 border border-white/10 rounded-2xl px-3 sm:px-5 py-2 sm:py-2.5 text-white font-bold text-base sm:text-xl shadow-inner tabular-nums leading-none">
            {timeLeft}s
          </div>
        </div>

        {/* Scrollable middle: alerts + full locations */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          {isShared && (
            <div className="px-4 sm:px-6 pt-3">
              <div className="bg-amber-500/20 border border-amber-500/30 rounded-xl p-3 flex items-start gap-3">
                <div className="w-8 h-8 shrink-0 rounded-full bg-amber-500 flex items-center justify-center text-white text-lg font-bold">
                  🤝
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-amber-600">Special Order</p>
                  <p className="text-[10px] text-amber-700 font-medium leading-snug break-words">
                    This order is shared by another partner. Earnings are split 50/50.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="px-4 sm:px-6 pt-3 flex flex-col gap-2">
            {orderZone && (
              <div className="flex items-start gap-2 min-w-0">
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 shrink-0 pt-0.5">
                  Order Zone:
                </span>
                <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-[10px] font-bold uppercase tracking-tight border border-gray-200 break-words [overflow-wrap:anywhere] min-w-0">
                  {orderZone}
                </span>
              </div>
            )}

            {isOutsideZone && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-[10px] font-bold text-amber-700 leading-snug min-w-0 break-words">
                  This order is outside your selected zone.
                  <br />
                  <span className="uppercase tracking-wide">Aapko apne global order aaye ge</span>
                </p>
              </div>
            )}
          </div>

          {pickups.length > 1 && (
            <div className="px-4 sm:px-6 pt-3">
              <div className="bg-[#16A34A]/10 border-2 border-[#16A34A]/30 rounded-2xl p-3 flex items-start gap-2.5">
                <div className="w-6 h-6 sm:w-7 sm:h-7 shrink-0 rounded-full bg-[#16A34A] flex items-center justify-center text-sm font-bold">
                  ⚡
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] sm:text-xs font-bold uppercase tracking-widest text-[#0A1F0A] mb-0.5">
                    Multiple Restaurants
                  </p>
                  <p className="text-[10px] sm:text-xs text-[#0A1F0A]/70 leading-snug break-words">
                    User ordered from {pickups.length} restaurants. Pickup items from each location.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="px-4 sm:px-6 py-4 space-y-5">
            <div className="min-w-0">
              {pickups.map((pickup, idx) => (
                <LocationStep
                  key={`pickup-${pickup.restaurantId || idx}`}
                  icon={ChefHat}
                  label={
                    pickups.length > 1
                      ? `Restaurant Pickup #${idx + 1}`
                      : 'Restaurant Pickup'
                  }
                  title={pickup.restaurantName || pickup.restaurant_name || restaurantName}
                  address={resolvePickupAddress(pickup, restaurantAddress)}
                  isLast={false}
                />
              ))}
              <LocationStep
                icon={MapPin}
                label="Customer Drop"
                title="Customer Location"
                address={customerAddress}
                isLast
                accentDotClass="bg-[#0A1F0A]"
                labelClass="text-[#0A1F0A]"
                mapsLink={mapsLink}
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
              <div className="p-3 bg-[#F0FDF4] rounded-2xl border border-[#E8F0E8] flex items-center gap-2.5 min-w-0">
                <Clock className="w-5 h-5 text-[#22C55E] shrink-0" />
                <div className="flex flex-col min-w-0">
                  <span className="text-[10px] text-[#5D6D5D] font-bold uppercase tracking-widest">Time</span>
                  <span className="text-sm font-bold text-[#0A1F0A] truncate">{etaMins} MINS</span>
                </div>
              </div>
              <div className="p-3 bg-[#F0FDF4] rounded-2xl border border-[#E8F0E8] flex items-center gap-2.5 min-w-0">
                <MapPin className="w-5 h-5 text-[#5D6D5D] shrink-0" />
                <div className="flex flex-col min-w-0">
                  <span className="text-[10px] text-[#5D6D5D] font-bold uppercase tracking-widest">Distance</span>
                  <span className="text-sm font-bold text-[#0A1F0A] truncate">
                    {distanceKm != null ? `${distanceKm} KM` : 'Locating…'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Actions pinned at bottom */}
        <div className="shrink-0 px-4 sm:px-6 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-3 border-t border-gray-100 bg-white">
          <ActionSlider
            label={isShared ? 'Slide to Join Order' : 'Slide to Accept'}
            onConfirm={() => onAccept(order)}
            color="bg-[#22C55E]"
            successLabel={isShared ? 'Joined Order ✓' : 'Order Accepted ✓'}
          />
          <button
            type="button"
            onClick={onReject}
            className="w-full text-gray-400 font-bold text-[10px] uppercase tracking-widest hover:text-red-500 transition-colors py-2 active:scale-95"
          >
            Pass this task
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};
