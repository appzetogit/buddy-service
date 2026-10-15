import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Camera,
  CheckCircle2,
  ChevronDown,
  CreditCard,
  Image as ImageIcon,
  Loader2,
  MapPin,
  Navigation,
  Phone,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { ActionSlider } from '@/modules/DeliveryV2/components/ui/ActionSlider';
import { formatKm } from '@/modules/DeliveryV2/utils/geo';
import { uploadAPI } from '@food/api';
import { openCamera } from '@food/utils/imageUploadUtils';
import { taxiDeliveryAPI } from '@taxi/delivery/taxiDeliveryApi';

/**
 * The trip sheet for a taxi ride, in the same bottom-sheet the rider app uses for every job.
 *
 *   PICKING_UP      go to the passenger          -> slide "Reached pickup"
 *   REACHED_PICKUP  passenger gives the ride code -> "Start ride" (parcel: photo of the parcel first)
 *   PICKED_UP       drive to the destination      -> slide "Reached destination"
 *   REACHED_DROP    take the fare                 -> "Complete ride" (parcel: photo at handover)
 *
 * The stage and every action come from the parent (it owns the trip state machine, the map and the
 * proximity check); this only draws the stage and gathers what the stage needs - the ride code,
 * the parcel photo, how the fare was taken.
 */

const money = (value) => `₹${Number(value || 0).toFixed(2)}`;

const Shell = ({ onMinimize, children }) => (
  <div className="fixed inset-0 z-[2000] p-0 sm:p-4 flex items-end justify-center">
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-black/40 -z-10" />
    <motion.div
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      className="w-full max-w-md sm:max-w-lg bg-white rounded-t-3xl sm:rounded-t-[2.5rem] shadow-[0_-20px_60px_rgba(0,0,0,0.3)] p-4 sm:p-6 pb-[120px] sm:pb-[140px] max-h-[84vh] overflow-y-auto"
    >
      <div className="w-full flex justify-center pb-2 sm:pb-4 pt-1">
        <button onClick={onMinimize} className="p-1 hover:bg-gray-100 active:scale-95 transition-all rounded-full flex flex-col items-center">
          <ChevronDown className="w-6 h-6 text-gray-400 stroke-3" />
        </button>
      </div>
      {children}
    </motion.div>
  </div>
);

const PassengerHeader = ({ order, subtitle, destinationAddress }) => {
  const name = order.customerName || order.user?.name || 'Passenger';
  const phone = order.customerPhone || order.user?.phone || '';
  const isParcel = order.taxi?.serviceType === 'parcel';
  return (
    <div className="flex items-start justify-between mb-5 pb-4 border-b border-gray-50 gap-2">
      <div className="flex gap-3 min-w-0 flex-1">
        <div className="w-14 h-14 shrink-0 bg-[#F0FDF4] rounded-2xl flex items-center justify-center shadow-lg shadow-black/5 overflow-hidden border border-green-100 text-[#16A34A] font-black text-xl">
          {order.user?.profileImage ? (
            <img src={order.user.profileImage} alt={name} className="w-full h-full object-cover" />
          ) : (
            String(name).slice(0, 1).toUpperCase()
          )}
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-widest text-[#16A34A]">
            {isParcel ? 'Parcel delivery' : 'Taxi ride'}
          </p>
          <h3 className="text-gray-950 text-lg sm:text-xl font-bold break-words">{name}</h3>
          <p className="text-gray-500 text-[10px] font-bold uppercase tracking-widest mt-1">{subtitle}</p>
        </div>
      </div>
      <div className="flex gap-2 shrink-0">
        {phone && (
          <button
            onClick={() => { window.location.href = `tel:${phone}`; }}
            className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center text-green-600 border border-green-100"
            aria-label="Call passenger"
          >
            <Phone className="w-5 h-5" />
          </button>
        )}
        {destinationAddress && (
          <button
            onClick={() =>
              window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destinationAddress)}`, '_blank')
            }
            className="w-10 h-10 rounded-full bg-gray-900 flex items-center justify-center text-white shadow-lg"
            aria-label="Navigate"
          >
            <Navigation className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );
};

const AddressRow = ({ label, address, accent = 'bg-[#16A34A]' }) => (
  <div className="flex gap-3 mb-3 min-w-0">
    <div className={`w-3 h-3 rounded-full ${accent} mt-1.5 shrink-0`} />
    <div className="min-w-0">
      <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{label}</p>
      <p className="text-sm font-bold text-gray-900 break-words [overflow-wrap:anywhere]">{address || 'Address not available'}</p>
    </div>
  </div>
);

/** Photo of the parcel (pickup / handover). Uploads, then records it on the ride. */
const ParcelPhoto = ({ order, stage, done, onSaved }) => {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);

  const handleFile = async (file) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image size should be less than 5MB');
      return;
    }
    setBusy(true);
    try {
      const up = await uploadAPI.uploadMedia(file, { folder: 'appzeto/delivery/parcels' });
      const url = up?.data?.data?.url || up?.data?.data?.secure_url;
      if (!url) throw new Error('Upload failed');
      const saved = await taxiDeliveryAPI.uploadParcelProof(order._id, stage, url);
      onSaved?.(saved?.data?.data?.order);
      toast.success('Parcel photo saved');
    } catch (error) {
      toast.error(error?.response?.data?.message || 'Could not save the parcel photo');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="flex items-center gap-2 py-3 px-4 rounded-2xl bg-green-50 text-green-700 text-xs font-bold border border-green-100">
        <CheckCircle2 className="w-4 h-4" /> Parcel photo saved
      </div>
    );
  }
  if (busy) {
    return (
      <div className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-gray-50 text-gray-400 font-bold text-xs uppercase tracking-widest">
        <Loader2 className="w-4 h-4 animate-spin" /> Uploading...
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 w-full">
      <button
        onClick={() => openCamera({ onSelectFile: handleFile, fileNamePrefix: `parcel-${stage}-${order._id}` })}
        className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl bg-gray-900 text-white font-bold text-xs uppercase tracking-widest shadow-lg active:scale-95 transition-all"
      >
        <Camera className="w-5 h-5" /> Camera
      </button>
      <button
        onClick={() => inputRef.current?.click()}
        className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl bg-green-50 text-green-700 border border-green-100 font-bold text-xs uppercase tracking-widest active:scale-95 transition-all"
      >
        <ImageIcon className="w-5 h-5" /> Gallery
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          handleFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
};

/** The four digits the passenger reads out at pickup. */
const RideCodeInput = ({ digits, onChange }) => {
  const refs = [useRef(), useRef(), useRef(), useRef()];
  useEffect(() => {
    const t = setTimeout(() => refs[0].current?.focus(), 300);
    return () => clearTimeout(t);
  }, []);

  const set = (index, raw) => {
    const digit = String(raw || '').slice(-1);
    if (digit && !/^\d$/.test(digit)) return;
    const next = [...digits];
    next[index] = digit;
    onChange(next);
    if (digit && index < 3) refs[index + 1].current?.focus();
  };

  return (
    <div className="flex justify-center gap-3">
      {[0, 1, 2, 3].map((i) => (
        <input
          key={i}
          ref={refs[i]}
          inputMode="numeric"
          maxLength={1}
          value={digits[i] || ''}
          onChange={(e) => set(i, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !digits[i] && i > 0) refs[i - 1].current?.focus();
          }}
          className="w-14 h-16 text-center text-2xl font-black rounded-2xl border-2 border-gray-200 focus:border-[#16A34A] focus:outline-none bg-gray-50"
        />
      ))}
    </div>
  );
};

export const TaxiTripSheet = ({
  order,
  status,
  isWithinRange,
  distanceToTarget,
  eta,
  onReachedPickup,
  onStartRide,
  onReachedDrop,
  onComplete,
  onMinimize,
}) => {
  const [digits, setDigits] = useState(['', '', '', '']);
  const code = digits.join('');
  const [starting, setStarting] = useState(false);
  const [collectedVia, setCollectedVia] = useState('cash');
  const [parcel, setParcel] = useState(order?.taxi?.parcel || null);

  useEffect(() => {
    setParcel(order?.taxi?.parcel || null);
  }, [order?._id, order?.taxi?.parcel]);

  if (!order) return null;

  const taxi = order.taxi || {};
  const isParcel = taxi.serviceType === 'parcel';
  const isCash = String(order.paymentMethod || taxi.paymentMethod || '').toLowerCase() === 'cash';
  const fare = Number(taxi.fare ?? order.pricing?.total ?? 0);
  const earning = Number(order.riderEarning || 0);
  const pickupProof = Boolean(parcel?.pickupProof?.url);
  const deliveryProof = Boolean(parcel?.deliveryProof?.url);
  const pickupAddress = order.restaurantAddress || taxi.pickupAddress;
  const dropAddress = order.customerAddress || taxi.dropAddress;
  const heading = `${formatKm(distanceToTarget)} km • ${eta || '--'} min`;

  const startRide = async () => {
    if (code.length < 4) {
      toast.error('Enter the 4-digit ride code from the passenger');
      return;
    }
    setStarting(true);
    try {
      await onStartRide(code);
    } finally {
      setStarting(false);
    }
  };

  // ---- PICKING_UP ----------------------------------------------------------------------------
  if (status === 'PICKING_UP') {
    return (
      <Shell onMinimize={onMinimize}>
        <PassengerHeader order={order} subtitle={`${heading} to pickup`} destinationAddress={pickupAddress} />
        <AddressRow label="Pickup" address={pickupAddress} />
        <AddressRow label="Drop" address={dropAddress} accent="bg-[#0A1F0A]" />
        <p className={`text-center text-[10px] font-bold uppercase tracking-widest my-4 ${isWithinRange ? 'text-green-600' : 'text-orange-500 animate-pulse'}`}>
          {isWithinRange ? 'Ready — swipe when you reach the passenger' : 'Heading to the passenger'}
        </p>
        <ActionSlider
          key="taxi-reach"
          label="Slide: Reached pickup"
          successLabel="Reached!"
          disabled={!isWithinRange}
          onConfirm={onReachedPickup}
          color="bg-green-600"
        />
      </Shell>
    );
  }

  // ---- REACHED_PICKUP ------------------------------------------------------------------------
  if (status === 'REACHED_PICKUP') {
    const needsParcelPhoto = isParcel && !pickupProof;
    return (
      <Shell onMinimize={onMinimize}>
        <PassengerHeader order={order} subtitle="Waiting at pickup" destinationAddress={dropAddress} />
        {isParcel && (
          <div className="mb-5 space-y-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Photo of the parcel</p>
            <ParcelPhoto
              order={order}
              stage="pickup"
              done={pickupProof}
              onSaved={(next) => next?.taxi?.parcel && setParcel(next.taxi.parcel)}
            />
          </div>
        )}
        <div className="flex items-center justify-center gap-2 mb-3 text-[#16A34A]">
          <ShieldCheck className="w-5 h-5" />
          <p className="text-xs font-black uppercase tracking-widest">Ask the passenger for their ride code</p>
        </div>
        <RideCodeInput digits={digits} onChange={setDigits} />
        <button
          onClick={startRide}
          disabled={starting || code.length < 4 || needsParcelPhoto}
          className="mt-6 w-full py-4 rounded-2xl bg-[#16A34A] text-white font-black text-sm uppercase tracking-widest shadow-lg shadow-green-600/30 disabled:opacity-40 active:scale-95 transition-all flex items-center justify-center gap-2"
        >
          {starting ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
          {needsParcelPhoto ? 'Add the parcel photo first' : 'Start ride'}
        </button>
      </Shell>
    );
  }

  // ---- PICKED_UP -----------------------------------------------------------------------------
  if (status === 'PICKED_UP') {
    return (
      <Shell onMinimize={onMinimize}>
        <PassengerHeader order={order} subtitle={`${heading} to drop`} destinationAddress={dropAddress} />
        <AddressRow label="Drop" address={dropAddress} accent="bg-[#0A1F0A]" />
        <div className="grid grid-cols-2 gap-2.5 my-4">
          <div className="p-3 bg-[#F0FDF4] rounded-2xl border border-[#E8F0E8]">
            <span className="text-[10px] text-[#5D6D5D] font-bold uppercase tracking-widest">Fare</span>
            <p className="text-sm font-bold text-[#0A1F0A]">{money(fare)}</p>
          </div>
          <div className="p-3 bg-[#F0FDF4] rounded-2xl border border-[#E8F0E8]">
            <span className="text-[10px] text-[#5D6D5D] font-bold uppercase tracking-widest">You earn</span>
            <p className="text-sm font-bold text-[#16A34A]">{money(earning)}</p>
          </div>
        </div>
        <p className={`text-center text-[10px] font-bold uppercase tracking-widest mb-3 ${isWithinRange ? 'text-green-600' : 'text-orange-500 animate-pulse'}`}>
          {isWithinRange ? 'Ready — swipe when you reach the destination' : 'Ride in progress'}
        </p>
        <ActionSlider
          key="taxi-drop"
          label="Slide: Reached destination"
          successLabel="Arrived ✓"
          disabled={!isWithinRange}
          onConfirm={onReachedDrop}
          color="bg-green-600"
        />
      </Shell>
    );
  }

  // ---- REACHED_DROP --------------------------------------------------------------------------
  const needsHandoverPhoto = isParcel && !deliveryProof;
  return (
    <Shell onMinimize={onMinimize}>
      <PassengerHeader order={order} subtitle="Reached destination" destinationAddress={dropAddress} />
      <div className="rounded-3xl bg-[#0A1F0A] text-white p-5 mb-5 text-center">
        <p className="text-white/60 text-[10px] font-bold uppercase tracking-widest mb-1">
          {isCash ? 'Collect from passenger' : 'Fare'}
        </p>
        <p className="text-4xl font-black tracking-tight text-[#16A34A]">{money(fare)}</p>
        <p className="text-white/60 text-[11px] font-semibold mt-2">
          {isCash ? 'Cash ride' : 'Paid online — nothing to collect'} · You earn {money(earning)}
        </p>
      </div>

      {isCash && (
        <div className="mb-5">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">How did the passenger pay?</p>
          <div className="grid grid-cols-2 gap-3">
            {[
              { id: 'cash', label: 'Cash', Icon: Wallet },
              { id: 'upi', label: 'UPI', Icon: CreditCard },
            ].map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => setCollectedVia(id)}
                className={`flex items-center justify-center gap-2 py-3 rounded-2xl border-2 font-bold text-sm transition-all ${
                  collectedVia === id ? 'border-[#16A34A] bg-[#F0FDF4] text-[#16A34A]' : 'border-gray-200 text-gray-500'
                }`}
              >
                <Icon className="w-4 h-4" /> {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {isParcel && (
        <div className="mb-5 space-y-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Photo of the delivered parcel</p>
          <ParcelPhoto
            order={order}
            stage="delivery"
            done={deliveryProof}
            onSaved={(next) => next?.taxi?.parcel && setParcel(next.taxi.parcel)}
          />
        </div>
      )}

      <ActionSlider
        key="taxi-complete"
        label={needsHandoverPhoto ? 'Add the parcel photo first' : 'Slide: Complete ride'}
        successLabel="Ride completed ✓"
        disabled={needsHandoverPhoto}
        onConfirm={() => onComplete({ collectedVia: isCash ? collectedVia : undefined })}
        color="bg-green-600"
      />
    </Shell>
  );
};

export default TaxiTripSheet;
