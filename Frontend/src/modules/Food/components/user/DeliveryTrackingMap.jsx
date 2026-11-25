import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { 
  GoogleMap, 
  useJsApiLoader, 
  OverlayView, 
  DirectionsService, 
  Polyline
} from '@react-google-maps/api';
import io from 'socket.io-client';
import { API_BASE_URL } from '@food/api/config';
import bikeLogo from '@food/assets/bikelogo.png';
import { riderMapIcon, riderIconRotates } from '@/shared/utils/riderMapIcon';
import { subscribeOrderTracking } from '@food/realtimeTracking';
import { motion, AnimatePresence } from 'framer-motion';
import { Navigation } from 'lucide-react';

const MAP_LIBRARIES = Object.freeze(['geometry', 'places']);

const RIDER_BIKE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60">
  <circle cx="30" cy="30" r="28" fill="white" stroke="#ff8100" stroke-width="4" />
  <g transform="translate(15, 15) scale(1.2)">
    <path d="M19 7c0-1.1-.9-2-2-2h-3v2h3v2.65l-2.13 1.52c-.31.22-.5.57-.5.95V13h-4.4a2 2 0 00-1.92 1.45L6 20H2v2h4.5c1.07 0 1.97-.85 1.97-1.97V20l.4-1.2h3.13l.4 1.2c.4 1.2 1.5 2 2.77 2h.3c1.07 0 1.97-.85 1.97-1.97V20l-.4-1.2H14.1l-.33-1H18v-2h-2.17l-.67-2H18c1.1 0 2-.9 2-2V7h-1zM7 18h-.5C5.67 18 5 17.33 5 16.5S5.67 15 6.5 15H7v3zm8.5 0h-.5V15h.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5z" fill="#ff8100" />
  </g>
</svg>`;

const RESTAURANT_PIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="#FF6B35">
  <path d="M12 2C8.13 2 5 5.13 5 9c0 4.17 4.42 9.92 6.24 12.11.4.48 1.08.48 1.52 0C14.58 18.92 19 13.17 19 9c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5 14.5 7.62 14.5 9 13.38 11.5 12 11.5z"/>
  <circle cx="12" cy="9" r="3" fill="#FFFFFF"/>
</svg>`;

const CUSTOMER_PIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="#10B981">
  <path d="M12 2C8.13 2 5 5.13 5 9c0 4.17 4.42 9.92 6.24 12.11.4.48 1.08.48 1.52 0C14.58 18.92 19 13.17 19 9c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5 14.5 7.62 14.5 9 13.38 11.5 12 11.5z"/>
  <circle cx="12" cy="9" r="3" fill="#FFFFFF"/>
</svg>`;

const debugLog = (...args) => console.log('[DeliveryTrackingMap]', ...args);

/**
 * Given a full route path (array of LatLng) and rider's current position,
 * returns the index of the closest path point to the rider.
 * Uses Google Maps geometry library (spherical).
 */
function findClosestPointIndex(path, riderLatLng) {
  if (!path || path.length === 0 || !riderLatLng) return 0;
  const geo = window.google?.maps?.geometry?.spherical;
  if (!geo) return 0;

  let minDist = Infinity;
  let closestIdx = 0;

  for (let i = 0; i < path.length; i++) {
    const pt = path[i];
    const lat = typeof pt.lat === 'function' ? pt.lat() : pt.lat;
    const lng = typeof pt.lng === 'function' ? pt.lng() : pt.lng;
    const dist = geo.computeDistanceBetween(
      new window.google.maps.LatLng(lat, lng),
      new window.google.maps.LatLng(riderLatLng.lat, riderLatLng.lng)
    );
    if (dist < minDist) {
      minDist = dist;
      closestIdx = i;
    }
  }
  return closestIdx;
}

/**
 * Normalise a path point to a plain {lat, lng} object
 * (handles both Google LatLng objects and plain objects).
 */
function normPt(pt) {
  if (!pt) return null;
  const lat = typeof pt.lat === 'function' ? pt.lat() : pt.lat;
  const lng = typeof pt.lng === 'function' ? pt.lng() : pt.lng;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

const DeliveryTrackingMap = ({
  orderId,
  orderTrackingIds = [],
  restaurantCoords,
  customerCoords,
  pickups = [],
  order = null,
  onEtaUpdate = null
}) => {
  const [map, setMap] = useState(null);
  const [riderLocation, setRiderLocation] = useState(null);
  /** Dual-driver: map of partnerId → { lat, lng, heading } */
  const [riderLocations, setRiderLocations] = useState({});
  const [currentEta, setCurrentEta] = useState(null);
  /**
   * fullRoutePath — the decoded overview_path from the baseline Directions call.
   * We store it as plain [{lat,lng}] so it's React-state-safe.
   */
  const [fullRoutePath, setFullRoutePath] = useState(null);
  /**
   * cloudPolyline — encoded polyline coming from the driver's real-time Firebase push.
   * When present, we decode it and use it as the fullRoutePath instead.
   */
  const [cloudPolyline, setCloudPolyline] = useState(null);

  const [smoothLocation, setSmoothLocation] = useState(null);
  const socketRef = useRef(null);
  const interpStateRef = useRef({ lastPos: null, nextPos: null, startTime: 0, durationMs: 1500 });
  const lastUpdateAtRef = useRef(0);
  const lastSmoothSetRef = useRef(0);
  const baselineRequestedRef = useRef(false);

  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
    libraries: MAP_LIBRARIES,
  });

  if (loadError) {
    return (
      <div className="w-full h-full bg-red-50 border border-red-200 rounded-2xl flex items-center justify-center px-4 text-center">
        <p className="text-sm text-red-700">Google Map load failed. Please verify Maps API key and allowed localhost referrers.</p>
      </div>
    );
  }

  const trackingIds = useMemo(() => {
    const ids = [orderId, ...(Array.isArray(orderTrackingIds) ? orderTrackingIds : [])]
      .map(id => String(id || '').trim())
      .filter(Boolean);
    return [...new Set(ids)];
  }, [orderId, orderTrackingIds]);

  const backendUrl = useMemo(() => {
    return (API_BASE_URL || '').replace(/\/api\/v1\/?$/i, '').replace(/\/api\/?$/i, '');
  }, []);

  // 1. Initial State from Order Payload
  useEffect(() => {
    const loc = order?.deliveryState?.currentLocation;
    if (loc && !riderLocation) {
      const lat = typeof loc.lat === 'number' ? loc.lat : (Array.isArray(loc.coordinates) ? Number(loc.coordinates[1]) : null);
      const lng = typeof loc.lng === 'number' ? loc.lng : (Array.isArray(loc.coordinates) ? Number(loc.coordinates[0]) : null);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        setRiderLocation({ lat, lng, heading: loc.bearing || loc.heading || 0 });
      }
    }
  }, [order, riderLocation]);

  // 2. Core Data Sync (Socket + Firebase)
  //
  // Both channels are genuinely needed, not redundant: the OLDER Food
  // delivery flow (useLocationSharing.js) emits position via Socket.io, but
  // the current DeliveryV2 driver app (DeliveryHomeV2.jsx) never opens a
  // socket at all - it only writes position/polyline/eta straight to
  // Firebase via the REST availability-update + writeOrderTracking calls.
  // This page serves customer tracking for orders from BOTH driver apps, so
  // it must keep listening to both channels for position.
  useEffect(() => {
    if (!trackingIds.length) return;

    // A. FIREBASE — primary channel for DeliveryV2 orders (position + cloud
    // polyline + eta), fallback for older-flow orders.
    const unsubs = trackingIds.map(id => subscribeOrderTracking(id, (data) => {
      const applyLoc = (key, src) => {
        const lat = Number(src?.lat ?? src?.boy_lat);
        const lng = Number(src?.lng ?? src?.boy_lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return {
          lat,
          lng,
          heading: Number(src?.heading ?? src?.bearing ?? 0),
        };
      };

      // Dual-driver nested riders/{partnerId} (preferred when present)
      if (data?.riders && typeof data.riders === 'object') {
        const next = {};
        Object.entries(data.riders).forEach(([pid, loc]) => {
          const parsed = applyLoc(pid, loc);
          if (parsed) next[String(pid)] = parsed;
        });
        if (Object.keys(next).length) {
          setRiderLocations(next);
          const first = Object.values(next)[0];
          setRiderLocation(first);
        }
      } else {
        const lat = Number(data?.lat ?? data?.boy_lat);
        const lng = Number(data?.lng ?? data?.boy_lng);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          const loc = {
            lat,
            lng,
            heading: Number(data?.heading ?? data?.bearing ?? 0),
          };
          setRiderLocation(loc);
          setRiderLocations((prev) => ({ ...prev, primary: loc }));
        }
      }

      // Sync Cloud Polyline and ETA from driver's Firebase push
      if (data?.polyline) {
        debugLog('📡 Received Cloud Polyline for live path');
        setCloudPolyline(data.polyline);
      }
      if (data?.eta) {
        debugLog('⏱️ Received real-time ETA:', data.eta);
        setCurrentEta(data.eta);
        if (onEtaUpdate) onEtaUpdate(data.eta);
      }
    }));

    // B. SOCKET.IO REALTIME — drives the smooth interpolation animation when
    // available (older delivery flow only; DeliveryV2 never emits this).
    const token = localStorage.getItem('user_accessToken') || localStorage.getItem('accessToken') || '';
    socketRef.current = io(backendUrl, {
      transports: ['websocket'],
      auth: { token }
    });

    socketRef.current.on('connect', () => {
      trackingIds.forEach(id => socketRef.current.emit('join-tracking', id));
    });

    socketRef.current.on('location-update', (data) => {
      const dataOrderId = data?.orderId || data?.order_id || data?.trackingId || data?.order?.id || data?.order?._id;
      const matchedId = dataOrderId
        ? trackingIds.find(id => String(id) === String(dataOrderId))
        : (trackingIds.length === 1 ? trackingIds[0] : null);
      const lat = Number(data?.lat ?? data?.boy_lat ?? data?.location?.lat ?? data?.location?.coordinates?.[1]);
      const lng = Number(data?.lng ?? data?.boy_lng ?? data?.location?.lng ?? data?.location?.coordinates?.[0]);
      if (data && matchedId && Number.isFinite(lat) && Number.isFinite(lng)) {
        const partnerKey = String(data?.deliveryPartnerId || 'primary');
        const nextPos = {
          lat,
          lng,
          heading: Number(data?.heading ?? data?.bearing ?? data?.location?.heading ?? 0)
        };
        const now = Date.now();
        const delta = Math.max(300, Math.min(now - (lastUpdateAtRef.current || now), 4000));
        lastUpdateAtRef.current = now;

        interpStateRef.current = {
          lastPos: interpStateRef.current.nextPos || nextPos,
          nextPos: nextPos,
          startTime: now,
          durationMs: delta
        };

        setRiderLocation(nextPos);
        setRiderLocations((prev) => ({ ...prev, [partnerKey]: nextPos }));
      }
    });

    return () => {
      unsubs.forEach(u => u?.());
      socketRef.current?.disconnect();
    };
  }, [trackingIds, backendUrl]);

  // 3. Smooth Animation Loop (60 FPS Glide)
  useEffect(() => {
    let frame;
    const update = () => {
      const { lastPos, nextPos, startTime, durationMs } = interpStateRef.current;
      if (lastPos && nextPos) {
        const duration = Math.max(600, durationMs || 1500);
        const elapsed = Date.now() - startTime;
        const raw = Math.min(elapsed / duration, 1);
        const progress = raw * raw * (3 - 2 * raw); // easeInOut

        const lat = lastPos.lat + (nextPos.lat - lastPos.lat) * progress;
        const lng = lastPos.lng + (nextPos.lng - lastPos.lng) * progress;

        // Shortest-path heading interpolation
        let lastHead = lastPos.heading || 0;
        let nextHead = nextPos.heading || 0;
        if (Math.abs(nextHead - lastHead) > 180) {
          if (nextHead > lastHead) lastHead += 360;
          else nextHead += 360;
        }
        const heading = lastHead + (nextHead - lastHead) * progress;

        const now = Date.now();
        if (now - lastSmoothSetRef.current >= 33 || raw >= 1) {
          lastSmoothSetRef.current = now;
          setSmoothLocation({ lat, lng, heading: heading % 360 });
        }
      }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, []);

  // 4. When cloudPolyline updates: decode & store as fullRoutePath
  useEffect(() => {
    if (!cloudPolyline || !isLoaded || !window.google?.maps?.geometry?.encoding) return;
    try {
      const decoded = window.google.maps.geometry.encoding.decodePath(
        typeof cloudPolyline === 'string' ? cloudPolyline : (cloudPolyline.points || '')
      );
      const plain = decoded.map(normPt).filter(Boolean);
      if (plain.length > 1) {
        setFullRoutePath(plain);
        debugLog(`🗺️ Cloud polyline decoded: ${plain.length} points`);
      }
    } catch (e) {
      debugLog('Cloud polyline decode error:', e);
    }
  }, [cloudPolyline, isLoaded]);

  const displayRiderLocation = smoothLocation || riderLocation;
  const riderMarkerList = useMemo(() => {
    const entries = Object.entries(riderLocations || {});
    if (!entries.length && displayRiderLocation) {
      return [['primary', displayRiderLocation]];
    }
    // Prefer smoothed position for the first / primary marker used for route split
    return entries.map(([id, loc], idx) => {
      if (idx === 0 && displayRiderLocation) return [id, { ...loc, ...displayRiderLocation }];
      return [id, loc];
    });
  }, [riderLocations, displayRiderLocation]);

  const tripStatus = order?.status || order?.orderStatus || 'pending';
  const isOrderPickedUp = ['picked_up', 'out_for_delivery', 'delivered'].includes(tripStatus.toLowerCase());

  // 5. Smart camera: fit bounds
  const lastCameraUpdateRef = useRef({ time: 0, status: null });
  useEffect(() => {
    if (!map || !customerCoords || !isLoaded) return;

    const now = Date.now();
    const statusChanged = lastCameraUpdateRef.current.status !== isOrderPickedUp;
    const timeSinceLastUpdate = now - lastCameraUpdateRef.current.time;
    if (!statusChanged && timeSinceLastUpdate < 15000) return;

    lastCameraUpdateRef.current = { time: now, status: isOrderPickedUp };

    const bounds = new window.google.maps.LatLngBounds();
    
    if (pickups && pickups.length > 0) {
      pickups.forEach(p => {
        const coords = p.location?.coordinates;
        if (Array.isArray(coords) && coords.length >= 2) {
          bounds.extend({ lat: Number(coords[1]), lng: Number(coords[0]) });
        }
      });
    } else if (restaurantCoords) {
      bounds.extend(restaurantCoords);
    }
    
    bounds.extend(customerCoords);
    if (riderLocation) bounds.extend(riderLocation);

    map.fitBounds(bounds, { top: 100, bottom: 120, left: 60, right: 60 });
  }, [map, riderLocation, restaurantCoords, customerCoords, isOrderPickedUp, isLoaded, pickups]);

  // 6. Baseline Directions callback — stores the overview_path as fullRoutePath
  const baselineDirectionsCallback = useCallback((result, status) => {
    if (status === 'OK' && result) {
      const rawPath = result.routes?.[0]?.overview_path || [];
      const plain = rawPath.map(normPt).filter(Boolean);
      if (plain.length > 1) {
        setFullRoutePath(plain);
      }
      // Also extract ETA from baseline if no real-time ETA yet
      const durationText = result?.routes?.[0]?.legs?.[0]?.duration?.text;
      if (durationText && !currentEta) {
        setCurrentEta(durationText);
        if (onEtaUpdate) onEtaUpdate(durationText);
      }
    } else if (status !== 'OK') {
      console.error('[DeliveryTrackingMap] Baseline DirectionsService failed:', status);
    }
  }, [currentEta, onEtaUpdate]);

  const baselineDirectionsOptions = useMemo(() => {
    if (!customerCoords || cloudPolyline) return null;
    
    let origin = restaurantCoords;
    let waypoints = [];
    
    if (pickups && pickups.length > 0) {
      const firstPickup = pickups[0]?.location?.coordinates;
      if (Array.isArray(firstPickup) && firstPickup.length >= 2) {
        origin = { lat: Number(firstPickup[1]), lng: Number(firstPickup[0]) };
      }
      
      if (pickups.length > 1) {
        waypoints = pickups.slice(1).map(p => {
          const c = p.location?.coordinates;
          if (Array.isArray(c) && c.length >= 2) {
            return { location: { lat: Number(c[1]), lng: Number(c[0]) }, stopover: true };
          }
          return null;
        }).filter(Boolean);
      }
    }

    if (!origin) return null;

    return {
      origin,
      destination: customerCoords,
      waypoints,
      travelMode: 'DRIVING'
    };
  }, [restaurantCoords?.lat, restaurantCoords?.lng, customerCoords?.lat, customerCoords?.lng, cloudPolyline, pickups]);

  const traveledPath = useMemo(() => {
    if (!fullRoutePath || fullRoutePath.length < 2) return [];
    if (!displayRiderLocation || !isLoaded || !window.google?.maps?.geometry) return [];
    const splitIdx = findClosestPointIndex(fullRoutePath, displayRiderLocation);
    return [
      ...fullRoutePath.slice(0, splitIdx + 1),
      { lat: displayRiderLocation.lat, lng: displayRiderLocation.lng }
    ];
  }, [fullRoutePath, displayRiderLocation, isLoaded]);

  const remainingPath = useMemo(() => {
    if (!fullRoutePath || fullRoutePath.length < 2) return [];
    if (!displayRiderLocation || !isLoaded || !window.google?.maps?.geometry) return fullRoutePath;
    const splitIdx = findClosestPointIndex(fullRoutePath, displayRiderLocation);
    return [
      { lat: displayRiderLocation.lat, lng: displayRiderLocation.lng },
      ...fullRoutePath.slice(splitIdx + 1)
    ];
  }, [fullRoutePath, displayRiderLocation, isLoaded]);

  // Route color by phase
  const remainingColor = isOrderPickedUp ? '#3b82f6' : '#22c55e';

  const center = useMemo(() => {
    if (isOrderPickedUp) return customerCoords || { lat: 0, lng: 0 };
    if (pickups && pickups.length > 0) {
       const first = pickups[0]?.location?.coordinates;
       if (Array.isArray(first) && first.length >= 2) return { lat: Number(first[1]), lng: Number(first[0]) };
    }
    return restaurantCoords || { lat: 0, lng: 0 };
  }, [isOrderPickedUp, restaurantCoords, customerCoords, pickups]);

  if (!isLoaded) return <div className="w-full h-full bg-gray-100 animate-pulse" />;

  return (
    <div className="relative w-full h-full overflow-hidden rounded-2xl shadow-inner border border-gray-100">
      <GoogleMap
        mapContainerStyle={{ width: '100%', height: '100%' }}
        center={center}
        zoom={15}
        onLoad={setMap}
        options={{
          disableDefaultUI: false,
          zoomControl: true,
          mapTypeControl: false,
          scaleControl: true,
          streetViewControl: false,
          rotateControl: false,
          fullscreenControl: false,
          gestureHandling: 'greedy',
          styles: [
            { featureType: 'poi', stylers: [{ visibility: 'off' }] },
            { featureType: 'transit', stylers: [{ visibility: 'off' }] }
          ]
        }}
      >
        {/* BASELINE DIRECTIONS API CALL (only needed if no cloudPolyline) */}
        {!fullRoutePath && baselineDirectionsOptions && !baselineRequestedRef.current && (
          <DirectionsService
            options={baselineDirectionsOptions}
            callback={(r, s) => {
              baselineRequestedRef.current = true;
              baselineDirectionsCallback(r, s);
            }}
          />
        )}

        {/* ── TRAVELED PATH ── */}
        {traveledPath.length > 1 && (
          <Polyline
            path={traveledPath}
            options={{
              strokeColor: '#9ca3af',
              strokeOpacity: 0,
              strokeWeight: 6,
              zIndex: 6,
              icons: [
                {
                  icon: {
                    path: 'M 0,-1 0,1',
                    strokeOpacity: 0.85,
                    strokeWeight: 5,
                    scale: 4,
                  },
                  offset: '0',
                  repeat: '14px',
                }
              ]
            }}
          />
        )}

        {/* ── REMAINING PATH ── */}
        {remainingPath.length > 1 && (
          <Polyline
            path={remainingPath}
            options={{
              strokeColor: remainingColor,
              strokeOpacity: 0.95,
              strokeWeight: 6,
              zIndex: 8,
            }}
          />
        )}

        {/* ── RESTAURANT PINS (Multiple Support) ── */}
        {(pickups && pickups.length > 0 ? pickups : (restaurantCoords ? [{ location: { coordinates: [restaurantCoords.lng, restaurantCoords.lat] }, restaurantId: order?.restaurantId }] : [])).map((pickup, idx) => {
          const coords = pickup.location?.coordinates;
          if (!Array.isArray(coords) || coords.length < 2) return null;
          const pos = { lat: Number(coords[1]), lng: Number(coords[0]) };
          
          return (
            <OverlayView key={`res-pin-${idx}`} position={pos} mapPaneName={OverlayView.MARKER_LAYER}>
              <div className="relative -translate-x-1/2 -translate-y-full mb-1 group">
                {!isOrderPickedUp && (
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                    <motion.div
                      animate={{ scale: [1, 2], opacity: [0.5, 0] }}
                      transition={{ duration: 2, repeat: Infinity }}
                      className="w-16 h-16 rounded-full border-4 border-[#16A34A]/50"
                    />
                  </div>
                )}
                <div className="relative w-11 h-11 rounded-full p-1 bg-white shadow-xl border-2 border-[#16A34A] overflow-hidden group-hover:scale-110 transition-transform">
                  <img
                    src={pickup.restaurantLogo || order?.restaurantLogo || order?.restaurantId?.logo || order?.restaurantId?.profileImage || `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(RESTAURANT_PIN_SVG)}`}
                    alt="Restaurant"
                    className="w-full h-full object-contain rounded-full bg-gray-50"
                    onError={(e) => { e.target.src = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(RESTAURANT_PIN_SVG)}`; }}
                  />
                </div>
                <div className="absolute top-[100%] left-1/2 -translate-x-1/2 w-3 h-3 bg-[#16A34A] -mt-1 shadow-sm" style={{ clipPath: 'polygon(50% 100%, 0 0, 100% 0)' }} />
              </div>
            </OverlayView>
          );
        })}

        {/* ── CUSTOMER PIN ── */}
        <OverlayView position={customerCoords} mapPaneName={OverlayView.MARKER_LAYER}>
          <div className="relative -translate-x-1/2 -translate-y-full mb-1 group">
            {isOrderPickedUp && (
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                <motion.div
                  animate={{ scale: [1, 2], opacity: [0.5, 0] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="w-16 h-16 rounded-full border-4 border-green-500/50"
                />
              </div>
            )}
            <div className="relative w-11 h-11 rounded-full p-1 bg-white shadow-xl border-2 border-green-500 overflow-hidden group-hover:scale-110 transition-transform">
              <img
                src={order?.customerImage || order?.userId?.profileImage || order?.userId?.avatar || `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(CUSTOMER_PIN_SVG)}`}
                alt="Me"
                className="w-full h-full object-contain rounded-full bg-gray-50"
                onError={(e) => { e.target.src = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(CUSTOMER_PIN_SVG)}`; }}
              />
            </div>
            <div className="absolute top-[100%] left-1/2 -translate-x-1/2 w-3 h-3 bg-green-500 -mt-1 shadow-sm" style={{ clipPath: 'polygon(50% 100%, 0 0, 100% 0)' }} />
          </div>
        </OverlayView>

        {/* ── RIDER MARKER(S) — one per driver on dual orders ── */}
        {riderMarkerList.map(([riderId, loc], idx) => {
          const riderIcon = riderMapIcon(order?.deliveryPartner || { vehicleType: order?.vehicleType });
          const spin = riderIconRotates(riderIcon) ? (loc.heading || 0) : 0;
          return (
          <OverlayView
            key={`rider-${riderId}`}
            position={loc}
            mapPaneName={OverlayView.MARKER_LAYER}
          >
            <div
              style={{
                transform: `translate(-50%, -50%) rotate(${spin}deg)`,
                transition: 'transform 0.2s linear',
                willChange: 'transform',
              }}
              className="relative w-16 h-16"
            >
              <img
                src={riderIcon}
                alt={`Rider ${idx + 1}`}
                className="w-full h-full object-contain drop-shadow-2xl"
                onError={(e) => { e.target.src = bikeLogo; }}
              />
              {riderMarkerList.length > 1 && (
                <span
                  className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-[#16A34A] text-white text-[10px] font-bold flex items-center justify-center shadow"
                  style={{ transform: `rotate(-${spin}deg)` }}
                >
                  {idx + 1}
                </span>
              )}
            </div>
          </OverlayView>
          );
        })}
      </GoogleMap>

      {/* LIVE ARRIVAL BADGE */}
      <AnimatePresence>
        {riderLocation && currentEta && (
          <motion.div
            initial={{ x: -20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            className="absolute top-4 left-4 z-[150] pointer-events-none"
          >
            <div className="bg-[#16A34A]/95 backdrop-blur-xl rounded-2xl p-3 shadow-[0_10px_30px_rgba(249,115,22,0.4)] border border-orange-400/50 flex flex-col min-w-[90px] group overflow-hidden relative">
              <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent pointer-events-none" />
              <div className="flex flex-col z-10">
                <span className="text-[9px] text-white/80 font-black uppercase tracking-[0.2em] mb-0.5">Arrival</span>
                <div className="flex items-center gap-2">
                  <span className="text-xl font-black text-white leading-none tracking-tighter">
                    {currentEta}
                  </span>
                  <div className="flex items-center gap-1.5 opacity-80">
                    <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                    <Navigation className="w-3 h-3 text-white rotate-45" />
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default DeliveryTrackingMap;

