import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ShieldCheck, DollarSign, CheckCircle2, 
  QrCode, Loader2, Info, X, RefreshCw, Package,
  Users, PhoneCall, Scale
} from 'lucide-react';
import { useDeliveryStore } from '@/modules/DeliveryV2/store/useDeliveryStore';
import { deliveryAPI as foodDeliveryAPI } from '@food/api';
import { quickDeliveryAPI, isQuickDeliveryOrder } from '@quickCommerce/delivery/quickDeliveryApi';
import { toast } from 'sonner';
import { ActionSlider } from '@/modules/DeliveryV2/components/ui/ActionSlider';
import {
  getCurrentRiderId,
  getMyLeg,
  isDualLegOrder,
  resolveCoDriver,
  toPartnerId,
  getPartnerWaitMessage,
} from '@/modules/DeliveryV2/utils/partnerIdentity';

const Backdrop = ({ onClose }) => (
  <motion.div 
    initial={{ opacity: 0 }} 
    animate={{ opacity: 1 }} 
    exit={{ opacity: 0 }}
    className="absolute inset-0 bg-black/40 -z-10 pointer-events-auto" 
    onClick={onClose}
  />
);

const DeliveryInstructionsPanel = ({ note }) => {
  const text = String(note || '').trim()
  if (!text) return null

  return (
    <div className="w-full rounded-3xl mb-6 overflow-hidden border border-orange-100 shadow-sm">
      <div className="bg-linear-to-r from-orange-500 to-amber-500 px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 bg-white/20 rounded-2xl flex items-center justify-center text-white">
            <Package className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[10px] font-black text-white uppercase tracking-[0.2em]">
              Delivery instruction
            </p>
            <p className="text-[11px] font-semibold text-white/90">
              Read before handover
            </p>
          </div>
        </div>
      </div>
      <div className="bg-orange-50 px-5 py-4">
        <p className="text-sm font-bold text-gray-950 leading-relaxed wrap-break-word">
          “{text}”
        </p>
      </div>
    </div>
  )
}

const OtpModal = ({ order, onVerified, onClose }) => {
  const [otp, setOtp] = useState(['', '', '', '']);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [isOtpVerified, setIsOtpVerified] = useState(false);
  const inputRefs = [useRef(), useRef(), useRef(), useRef()];
  const currentRiderId = getCurrentRiderId();
  const myLeg = getMyLeg(order, currentRiderId);
  const isDualLeg = isDualLegOrder(order);
  // Dual-leg: each driver verifies only THEIR leg OTP — never the shared order-level flag.
  const isAlreadyVerified = isDualLeg
    ? Boolean(myLeg?.otpVerified)
    : Boolean(order?.deliveryVerification?.dropOtp?.verified);

  useEffect(() => {
    if (isAlreadyVerified) {
      setIsOtpVerified(true);
    }
    const timer = setTimeout(() => {
      inputRefs[0].current?.focus();
    }, 500);
    return () => clearTimeout(timer);
  }, [isAlreadyVerified]);

  // Quick Commerce rider routes are keyed by the Mongo id; Food's accept the human order number.
  const deliveryAPI = isQuickDeliveryOrder(order) ? quickDeliveryAPI : foodDeliveryAPI;
  const orderId = isQuickDeliveryOrder(order)
    ? (order._id || order.orderMongoId || order.orderId)
    : (order.orderId || order._id || 'ORD');

  const handleOtpChange = (index, value) => {
    if (value && !/^\d+$/.test(value)) return;
    const newOtp = [...otp];
    newOtp[index] = value.substring(value.length - 1);
    setOtp(newOtp);
    if (value && index < 3) inputRefs[index + 1].current?.focus();
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) inputRefs[index - 1].current?.focus();
  };

  const verifyOtp = async () => {
    const otpString = otp.join('');
    if (otpString.length < 4) return;
    setIsVerifyingOtp(true);
    try {
      const res = await deliveryAPI.verifyDropOtp(orderId, otpString);
      if (res?.data?.success) {
        setIsOtpVerified(true);
        setTimeout(() => onVerified(otpString, res.data?.data?.order), 600);
      }
    } catch (err) {
      toast.error(
        err?.response?.data?.error ||
          err?.response?.data?.message ||
          "Invalid OTP entered",
      );
      throw err;
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[2000] p-0 sm:p-4 flex items-end justify-center pointer-events-none">
      <Backdrop onClose={onClose} />
      <motion.div 
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        className="w-full max-w-md sm:max-w-lg bg-white rounded-t-3xl sm:rounded-t-[2.5rem] shadow-[0_-20px_60px_rgba(0,0,0,0.3)] p-4 sm:p-6 pb-[120px] sm:pb-[140px] pointer-events-auto max-h-[84vh] overflow-y-auto"
      >
        <div className="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mb-6" />
        <div className="flex justify-between items-center mb-6">
           <div className="flex items-center gap-3">
             <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${isOtpVerified ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500'}`}>
               <ShieldCheck className="w-7 h-7" />
             </div>
             <div>
               <h2 className="text-xl font-bold text-gray-900">Handover Code</h2>
               <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                 {isDualLeg ? 'Your delivery OTP · Step 1' : 'Step 1 of Verification'}
               </p>
             </div>
           </div>
           <button onClick={onClose} className="p-2 bg-gray-50 rounded-full text-gray-400 hover:text-gray-600"><X className="w-5 h-5"/></button>
        </div>

        <DeliveryInstructionsPanel note={order?.note} />

        {isDualLeg && (
          <div className="mb-4 rounded-2xl bg-indigo-50 border border-indigo-100 px-4 py-3">
            <p className="text-[11px] font-bold text-indigo-800 leading-snug">
              Ask the customer for <span className="underline">your</span> OTP only — each driver has a separate code.
            </p>
          </div>
        )}

        <div className="flex justify-center gap-2.5 sm:gap-3 mb-6 sm:mb-8">
          {otp.map((digit, i) => (
            <input
              key={i}
              ref={inputRefs[i]}
              type="number"
              disabled={isOtpVerified || isAlreadyVerified}
              value={digit}
              onChange={(e) => handleOtpChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              className={`w-12 sm:w-14 h-16 sm:h-18 bg-gray-50 border-2 rounded-2xl text-center text-2xl sm:text-3xl font-bold transition-all ${
                isOtpVerified || isAlreadyVerified ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-200 focus:border-green-600 text-gray-700'
              }`}
            />
          ))}
        </div>

        <ActionSlider 
          key="action-otp"
          label={isVerifyingOtp ? "Verifying..." : isAlreadyVerified ? "Code already verified ✓" : "Slide to Verify OTP"} 
          successLabel="Verified!"
          disabled={otp.some(d => !d) || isVerifyingOtp || isOtpVerified || isAlreadyVerified}
          onConfirm={isAlreadyVerified ? async () => onVerified('VERIFIED') : verifyOtp}
          color="bg-gray-900"
        />
      </motion.div>
    </div>
  );
};

const PaymentModal = ({ order, otpString, onComplete, onClose }) => {
  const [showQrModal, setShowQrModal] = useState(false);
  const [collectQrLink, setCollectQrLink] = useState(null);
  const [isGeneratingQr, setIsGeneratingQr] = useState(false);
  const isInitialPaid = ['paid', 'captured', 'authorized'].includes(String(order.payment?.status || "").toLowerCase());
  const [paymentStatus, setPaymentStatus] = useState(isInitialPaid ? 'paid' : 'idle');
  const [isSyncing, setIsSyncing] = useState(false);
  const pollingRef = useRef(null);
  const { profile } = useDeliveryStore();
  const currentRiderId = getCurrentRiderId();
  const primaryId = toPartnerId(order.dispatch?.deliveryPartnerId);
  const secondaryId = toPartnerId(order.dispatch?.sharedPartnerId);

  const isPrimaryRider = Boolean(currentRiderId) && primaryId === String(currentRiderId);
  const isSharedRider = Boolean(currentRiderId) && secondaryId === String(currentRiderId);
  const partnerJoined = Boolean(secondaryId);
  const isDualLeg = isDualLegOrder(order) && partnerJoined;
  // Searching alone is not a dual-driver delivery yet
  const isShared = partnerJoined;

  const otherPartner = resolveCoDriver(order, currentRiderId);
  const waitMessage = getPartnerWaitMessage(order, currentRiderId);

  const handleCallPartner = () => {
    const phone = otherPartner?.phoneNumber || otherPartner?.phone;
    if (phone) window.open(`tel:${phone}`);
    else toast.error('Partner phone number not available');
  };

  const deliveryAPI = isQuickDeliveryOrder(order) ? quickDeliveryAPI : foodDeliveryAPI;
  const orderId = order._id || order.orderId || 'ORD';
  const amountToCollect = order.pricing?.total || order.amountToCollect || 0;
  const isSplitConfirmed = !!order.deliveryState?.isSplitConfirmed || isDualLeg;

  // Always show driver earnings (even when customer delivery fee is free / admin-borne)
  const isSalaryPartner =
    profile?.employmentType === 'salary' ||
    order.earningDisplayMode === 'salary' ||
    order.employmentType === 'salary' ||
    (isSharedRider
      ? order.settlementBreakdown?.driver?.sharedEmploymentType === 'salary'
      : order.settlementBreakdown?.driver?.employmentType === 'salary');
  const primaryShare = Number(order.riderEarning || 0) || 0;
  const sharedShare = Number(order.sharedRiderEarning || 0) || 0;
  const myEarning = isSalaryPartner
    ? 0
    : isSharedRider
      ? sharedShare
      : primaryShare;
  const [isConfirmingSplit, setIsConfirmingSplit] = useState(false);

  const handleConfirmSplit = async () => {
    if (!isPrimaryRider) return;
    try {
      setIsConfirmingSplit(true);
      await deliveryAPI.confirmSplit(orderId);
      toast.success("Earnings split confirmed!");
    } catch (err) {
      toast.error(err.message || "Failed to confirm split");
    } finally {
      setIsConfirmingSplit(false);
    }
  };

  const checkPaymentSync = useCallback(async () => {
    try {
      const res = await foodDeliveryAPI.getPaymentStatus(orderId);
      const data = res?.data?.data || res?.data || {};
      const status = String(data?.payment?.status || "").toLowerCase();
      if (['paid', 'captured', 'authorized'].includes(status)) {
        setPaymentStatus('paid');
        if (pollingRef.current) clearInterval(pollingRef.current);
        setShowQrModal(false);
      }
    } catch (e) {}
  }, [orderId]);

  const handleManualCheck = async () => {
    setIsSyncing(true);
    await checkPaymentSync();
    setTimeout(() => setIsSyncing(false), 800);
  };

  useEffect(() => {
    if (paymentStatus === 'pending' || (amountToCollect > 0 && paymentStatus !== 'paid')) {
      pollingRef.current = setInterval(checkPaymentSync, 5000);
    }
    return () => clearInterval(pollingRef.current);
  }, [paymentStatus, amountToCollect, checkPaymentSync]);

  const generateQr = async () => {
    setIsGeneratingQr(true);
    try {
      const res = await foodDeliveryAPI.createCollectQr(orderId, {
        name: order.userName || 'Customer',
        phone: order.userPhone || ''
      });
      const link = res?.data?.data?.shortUrl || res?.data?.shortUrl || null;
      if (link) {
        setCollectQrLink(link);
        setPaymentStatus('pending');
        setShowQrModal(true);
      } else {
        toast.error("Could not generate QR code");
      }
    } catch (e) {
      toast.error("QR Generation failed");
    } finally {
      setIsGeneratingQr(false);
    }
  };

  const isPaid = paymentStatus === 'paid';
  const [isCashPayment, setIsCashPayment] = useState(false);

  const handleCashSelection = () => {
    setIsCashPayment(true);
  };

  const handleQrSelection = () => {
    setIsCashPayment(false);
    generateQr();
  };

  return (
    <>
      <div className="fixed inset-0 z-[2000] p-0 sm:p-4 flex items-end justify-center pointer-events-none">
        <Backdrop onClose={onClose} />
        <motion.div 
          initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
          className="w-full max-w-md sm:max-w-lg bg-white rounded-t-3xl sm:rounded-t-[2.5rem] shadow-[0_-20px_60px_rgba(0,0,0,0.3)] p-4 sm:p-6 pb-[120px] sm:pb-[140px] pointer-events-auto max-h-[84vh] overflow-y-auto"
        >
          <div className="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mb-6" />
          <div className="flex justify-between items-center mb-6">
             <div className="flex items-center gap-3">
               <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${isPaid ? 'bg-green-100 text-green-600' : 'bg-amber-100 text-amber-600'}`}>
                 <DollarSign className="w-7 h-7" />
               </div>
               <div>
                 <h2 className="text-xl font-bold text-gray-900">Collect Payment</h2>
                 <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Step 2 of Verification</p>
               </div>
             </div>
             <button onClick={onClose} className="p-2 bg-gray-50 rounded-full text-gray-400 hover:text-gray-600"><X className="w-5 h-5"/></button>
          </div>

          <DeliveryInstructionsPanel note={order?.note} />

          {/* Always show this driver's payout (incl. when customer delivery is free) */}
          <div className="mb-6 rounded-2xl border border-emerald-100 bg-emerald-50 p-4 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">
                {isSalaryPartner ? 'Status' : 'Your Payout'}
              </p>
              <p className="text-[11px] font-medium text-emerald-800/80 mt-0.5">
                {isSalaryPartner
                  ? 'You are on salary — no per-order payout'
                  : Number(order.pricing?.deliveryDiscount || order.pricing?.platformSubsidy || 0) > 0
                    ? 'Customer delivery free · admin bears delivery cost'
                    : 'Delivery earning for this trip'}
              </p>
            </div>
            {isSalaryPartner ? (
              <p className="text-sm font-black text-emerald-900 text-right">On salary</p>
            ) : (
              <p className="text-xl font-black text-emerald-900">₹{Number(myEarning || 0).toFixed(0)}</p>
            )}
          </div>

          {/* Mutual contact once second driver has joined */}
          {partnerJoined && otherPartner && (
            <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
                <Users className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold text-indigo-700 uppercase tracking-widest mb-0.5">
                  Delivery Partner
                </p>
                <p className="text-xs font-bold text-indigo-900 truncate">
                  {otherPartner.fullName || otherPartner.name || 'Delivery Partner'}
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
          )}

          {waitMessage && (
            <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 flex gap-3 items-start mb-6">
              <Loader2 className="w-5 h-5 text-amber-600 animate-spin shrink-0 mt-0.5" />
              <div>
                <p className="text-[10px] font-bold text-amber-700 uppercase tracking-widest mb-1">
                  {waitMessage.title}
                </p>
                <p className="text-xs font-medium text-amber-900 leading-tight">
                  {waitMessage.body}
                </p>
              </div>
            </div>
          )}

          {/* Earnings Split Section */}
          {isShared && (
            <div className={`p-5 rounded-3xl border-2 transition-all mb-6 ${isSplitConfirmed ? 'bg-emerald-50 border-emerald-100' : 'bg-indigo-50 border-indigo-100 shadow-lg'}`}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className={`p-2 rounded-xl ${isSplitConfirmed ? 'bg-emerald-500' : 'bg-indigo-500'}`}>
                    <Scale className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <h4 className={`text-xs font-black uppercase tracking-wider ${isSplitConfirmed ? 'text-emerald-900' : 'text-indigo-900'}`}>Earnings Split</h4>
                    <p className={`text-[10px] font-bold ${isSplitConfirmed ? 'text-emerald-600' : 'text-indigo-600'}`}>
                      {isDualLeg
                        ? 'Equal split · each driver completes independently'
                        : isSplitConfirmed
                          ? 'Confirmation Received ✓'
                          : 'Manual Confirmation Required'}
                    </p>
                  </div>
                </div>
                <Users className={`w-5 h-5 ${isSplitConfirmed ? 'text-emerald-400' : 'text-indigo-400'}`} />
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className={`p-3 rounded-2xl ${isSplitConfirmed ? 'bg-emerald-100/50' : 'bg-white'}`}>
                  <p className="text-[9px] font-black text-gray-400 uppercase mb-1">Primary Rider</p>
                  <p className="text-sm font-black text-gray-900">₹{primaryShare.toFixed(2)}</p>
                </div>
                <div className={`p-3 rounded-2xl ${isSplitConfirmed ? 'bg-emerald-100/50' : 'bg-white'}`}>
                  <p className="text-[9px] font-black text-gray-400 uppercase mb-1">Shared Rider</p>
                  <p className="text-sm font-black text-gray-900">₹{sharedShare.toFixed(2)}</p>
                </div>
              </div>

              {!isDualLeg && !isSplitConfirmed ? (
                isPrimaryRider ? (
                  <button 
                    onClick={handleConfirmSplit}
                    disabled={isConfirmingSplit}
                    className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl shadow-indigo-500/20 active:scale-95 transition-all flex items-center justify-center gap-2"
                  >
                    {isConfirmingSplit ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    Confirm Split Amount
                  </button>
                ) : (
                  <div className="py-3 px-4 bg-white/60 border border-indigo-100 rounded-2xl text-center">
                    <p className="text-[10px] font-bold text-indigo-700">
                      Waiting for Primary Partner to confirm split...
                    </p>
                  </div>
                )
              ) : (
                <div className="flex items-center justify-center gap-2 py-1">
                   <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                   <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-widest">System Ready</p>
                </div>
              )}
            </div>
          )}

          <div className="bg-amber-50 rounded-3xl p-4 sm:p-6 border border-amber-100 mb-6 sm:mb-8">
             <div className="flex justify-between items-center mb-6">
               <div>
                 <p className="text-amber-700 text-[10px] font-bold uppercase tracking-widest mb-1">
                    {isPaid ? "Amount Paid Online" : "Cash to Collect"}
                 </p>
                 <p className="text-amber-950 text-3xl sm:text-4xl font-bold">₹{amountToCollect.toFixed(2)}</p>
               </div>
               {isPaid && <div className="bg-green-500 text-white px-4 py-2 rounded-full text-[10px] font-bold">PAID ✓</div>}
             </div>

              {!isPaid && (
                <div className="space-y-3">
                  {/* Dual-leg shared rider: primary collects customer cash; they still complete their own delivery */}
                  {isDualLeg && isSharedRider ? (
                    <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 flex gap-3 items-start">
                      <Info className="w-5 h-5 text-indigo-500 shrink-0" />
                      <p className="text-[11px] font-bold text-indigo-700 leading-tight">
                        Primary partner collects customer payment. Complete your own delivery with OTP below — you can call your partner anytime.
                      </p>
                    </div>
                  ) : (
                    <>
                      <button 
                        onClick={handleQrSelection}
                        disabled={isGeneratingQr}
                        className={`w-full py-3.5 sm:py-4 border-2 rounded-2xl font-bold text-[11px] sm:text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${
                          !isCashPayment && paymentStatus === 'pending'
                            ? 'bg-amber-100 border-amber-400 text-amber-900 shadow-inner'
                            : 'bg-white border-amber-200 text-amber-800'
                        }`}
                      >
                        {isGeneratingQr ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-5 h-5" />}
                        {paymentStatus === 'pending' && !isCashPayment ? 'QR Active - Waiting...' : 'Show Payment QR'}
                      </button>

                      <button 
                        onClick={handleCashSelection}
                        className={`w-full py-3.5 sm:py-4 border-2 rounded-2xl font-bold text-[11px] sm:text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${
                          isCashPayment
                            ? 'bg-amber-600 border-amber-600 text-white shadow-lg'
                            : 'bg-white border-amber-200 text-amber-800'
                        }`}
                      >
                        <DollarSign className="w-5 h-5" />
                        Cash Payment
                      </button>
                    </>
                  )}
                </div>
              )}
          </div>

          {/* Both drivers complete independently on dual-leg */}
          <ActionSlider 
            key="action-payment"
            label={
              isDualLeg && isSharedRider
                ? "Slide to Complete Your Delivery"
                : isCashPayment
                  ? "Slide to Confirm Cash"
                  : "Slide to Complete Order"
            }
            successLabel="Delivered! ✓"
            disabled={
              isDualLeg && isSharedRider
                ? false
                : ((!isPaid && !isCashPayment) || (isShared && !isDualLeg && !isSplitConfirmed))
            }
            onConfirm={async () => {
                try {
                    await onComplete(otpString, isCashPayment ? 'cash' : 'qr');
                } catch (e) {
                    throw e;
                }
            }}
            color="bg-green-600"
          />
        </motion.div>
      </div>

      <AnimatePresence>
        {showQrModal && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[3000] bg-black/80 flex items-center justify-center p-4 sm:p-6 pointer-events-auto"
            onClick={() => setShowQrModal(false)}
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }}
              className="bg-white w-full max-w-sm rounded-3xl p-5 sm:p-8 flex flex-col items-center text-center shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <h3 className="text-gray-950 font-bold text-xl mb-2">Scan to Pay</h3>
              <p className="text-gray-500 text-sm mb-8 font-medium">Order Total: ₹{amountToCollect.toFixed(2)}</p>
              
              <div className="flex flex-col items-center gap-6 bg-gray-50 rounded-3xl border-2 border-gray-100 p-6 mb-8 w-full">
                 <img 
                   src={`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(collectQrLink)}`} 
                   alt="Razorpay QR"
                   className="w-44 h-44 sm:w-56 sm:h-56 mix-blend-multiply"
                 />
                 <button 
                    onClick={handleManualCheck}
                    disabled={isSyncing}
                    className="flex gap-2 items-center bg-green-500 hover:bg-green-600 text-white px-6 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-green-500/20 active:scale-95 transition-all"
                 >
                    {isSyncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} 
                    Check Payment Status
                 </button>
              </div>

              <button 
                onClick={() => setShowQrModal(false)}
                className="w-full py-4 bg-gray-100 text-gray-500 rounded-2xl font-bold text-xs uppercase tracking-widest"
              >
                Close QR
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export const DeliveryVerificationModal = ({ order, onComplete, onClose }) => {
  const currentRiderId = getCurrentRiderId();
  const myLeg = getMyLeg(order, currentRiderId);
  const isDualLeg = isDualLegOrder(order);
  // Dual-leg: only skip OTP if THIS driver's leg is already verified
  const alreadyVerified = isDualLeg
    ? Boolean(myLeg?.otpVerified)
    : !!order?.deliveryVerification?.dropOtp?.verified;
  const paymentMethod = (
    order?.paymentMethod ||
    order?.payment?.method ||
    order?.transaction?.payment?.method ||
    order?.transaction?.paymentMethod ||
    'cod'
  ).toLowerCase();
  const isCod = ['cash', 'cod', 'cash_on_delivery', 'razorpay_qr'].includes(paymentMethod);

  // Determine initial step: skip OTP if already verified
  const [step, setStep] = useState(() => {
    if (alreadyVerified) {
      return isCod ? 'payment' : 'complete';
    }
    return 'otp';
  });
  const [verifiedOtp, setVerifiedOtp] = useState(() => {
    if (alreadyVerified) return 'VERIFIED';
    return '';
  });

  const handleOtpVerified = (otpValue, updatedOrder) => {
    setVerifiedOtp(otpValue || 'VERIFIED');
    if (updatedOrder) {
      try {
        useDeliveryStore.getState().setActiveOrder?.({
          ...(useDeliveryStore.getState().activeOrder || order),
          ...updatedOrder,
        });
      } catch {}
    }
    setStep(isCod ? 'payment' : 'complete');
  };

  // If OTP was already verified on mount and it's a non-COD order, auto-complete
  useEffect(() => {
    if (step === 'complete' && !isCod) {
      onComplete(verifiedOtp);
    }
  }, []); // only on mount

  if (!order) return null;

  return (
    <AnimatePresence mode="wait">
      {step === 'otp' && (
        <OtpModal 
          key="otp-modal" 
          order={order} 
          onVerified={handleOtpVerified} 
          onClose={onClose || (() => {})} 
        />
      )}
      {step === 'payment' && (
        <PaymentModal 
          key="payment-modal" 
          order={order} 
          otpString={verifiedOtp} 
          onComplete={onComplete} 
          onClose={onClose || (() => {})} 
        />
      )}
      {step === 'complete' && (
        <div className="fixed inset-0 z-[2000] p-0 sm:p-4 flex items-end justify-center pointer-events-none">
          <Backdrop onClose={onClose || (() => {})} />
          <motion.div 
            key="complete-modal"
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            className="w-full max-w-md sm:max-w-lg bg-white rounded-t-3xl sm:rounded-t-[2.5rem] shadow-[0_-20px_60px_rgba(0,0,0,0.3)] p-4 sm:p-6 pb-[120px] sm:pb-[140px] pointer-events-auto max-h-[84vh] overflow-y-auto"
          >
            <div className="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mb-6" />
            <div className="flex items-center gap-3 mb-8">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center bg-green-100 text-green-600">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">OTP Verified</h2>
                <p className="text-[10px] font-bold uppercase tracking-widest text-green-600">Payment Received Online</p>
              </div>
            </div>

            {order.dispatch?.sharedPartnerId && (
              <div className="bg-indigo-50 border border-indigo-100 rounded-3xl p-5 mb-8">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-indigo-100 rounded-2xl flex items-center justify-center text-indigo-600">
                    <Users className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-indigo-700 uppercase tracking-widest">Earnings Split Active</p>
                    <p className="text-xs font-bold text-indigo-900">Shared Order Benefits</p>
                  </div>
                </div>
                
                <div className="space-y-3">
                   <div className="flex justify-between items-center text-xs">
                      <span className="text-indigo-600 font-bold uppercase tracking-tight">Total Payout</span>
                      <span className="text-gray-900 font-black">₹{(Number(order.riderEarning || 0) + Number(order.sharedRiderEarning || 0)).toFixed(2)}</span>
                   </div>
                   <div className="h-px bg-indigo-100 w-full" />
                   <div className="flex justify-between items-center text-xs">
                      <span className="text-indigo-600 font-bold uppercase tracking-tight">Your Share (50%)</span>
                      <span className="text-[#16A34A] font-black">₹{Number(order.dispatch?.deliveryPartnerId?._id === currentRiderId ? (order.riderEarning || 0) : (order.sharedRiderEarning || 0)).toFixed(2)}</span>
                   </div>
                   <div className="flex justify-between items-center text-xs">
                      <span className="text-indigo-400 font-bold uppercase tracking-tight">Partner Share</span>
                      <span className="text-gray-500 font-black">₹{Number(order.dispatch?.deliveryPartnerId?._id === currentRiderId ? (order.sharedRiderEarning || 0) : (order.riderEarning || 0)).toFixed(2)}</span>
                   </div>
                </div>

                <div className="mt-5 pt-4 border-t border-indigo-100">
                   <p className="text-[10px] font-bold text-indigo-500 italic leading-tight text-center">
                      Earnings will be credited to both wallets automatically upon completion.
                   </p>
                </div>
              </div>
            )}

            <ActionSlider 
              key="action-complete"
              label="Slide to Complete Delivery" 
              successLabel="Delivered! ✓"
              onConfirm={async () => {
                await onComplete(verifiedOtp);
              }}
              color="bg-green-600"
            />
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

