import { useEffect, useState } from 'react';
import { paymentOptionsAPI } from '@food/api';

/**
 * Taxi cash on delivery with an advance.
 *
 * The admin turns COD on for Taxi and sets the advance %. The customer pays that share when booking (wallet
 * and/or online) and the rest in cash after the ride. If the ride is cancelled the advance returns to the wallet.
 */

const roundMoney = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Same rule as the server (computeCodSplit): percent of the fare, at least Rs 1, never above the fare. */
export const splitCodFare = (fare, percent) => {
  const bill = Math.max(0, roundMoney(fare));
  const pct = Math.min(100, Math.max(0, Number(percent) || 0));
  let advance = roundMoney((bill * pct) / 100);
  if (pct > 0 && advance < 1) advance = Math.min(1, bill);
  advance = Math.min(bill, advance);
  return { advanceAmount: advance, remainingAmount: roundMoney(bill - advance) };
};

/** { enabled, advancePercent, split } for the fare; COD is hidden unless the admin switched it on for Taxi. */
export const useTaxiCodOption = (fare) => {
  const [config, setConfig] = useState({ enabled: false, advancePercent: 0 });

  useEffect(() => {
    let active = true;
    paymentOptionsAPI
      .get('taxi')
      .then((res) => {
        const cod = res?.data?.data?.cod || res?.data?.cod || res?.cod || null;
        if (active && cod) setConfig({ enabled: cod.enabled === true, advancePercent: Number(cod.advancePercent) || 0 });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const split = splitCodFare(Number(fare) || 0, config.advancePercent);
  return { enabled: config.enabled && Number(fare) > 0, advancePercent: config.advancePercent, ...split };
};

const loadRazorpayScript = () =>
  new Promise((resolve) => {
    if (window.Razorpay) {
      resolve(true);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });

/** What the booking call answered when the advance still has to be paid (the ride is not booked yet). */
export const pendingAdvanceOf = (response) => {
  const first = response?.data || response;
  if (first?.data?.requiresPayment) return first.data;
  if (first?.requiresPayment) return first;
  return null;
};

/**
 * Opens Razorpay for the advance and, once paid, calls the verify endpoint, which books the ride.
 * Resolves with the verify response (same shape as a normal booking response). Rejects if the rider closes the
 * payment sheet or the payment fails - nothing is booked and nothing is charged in that case.
 */
export const payCodAdvance = async ({ api, pending, verifyPath, config, appName = 'Buddy', userInfo = {} }) => {
  const scriptLoaded = await loadRazorpayScript();
  if (!scriptLoaded) throw new Error('Razorpay SDK failed to load');
  const rz = pending?.razorpay;
  if (!rz?.keyId || !rz?.orderId) throw new Error('Unable to start the advance payment');

  return new Promise((resolve, reject) => {
    const checkout = new window.Razorpay({
      key: rz.keyId,
      amount: rz.amount,
      currency: rz.currency || 'INR',
      name: appName,
      description: `Advance for your booking (Rs ${pending.advanceAmount})`,
      order_id: rz.orderId,
      prefill: {
        name: userInfo?.name || '',
        email: userInfo?.email || '',
        contact: userInfo?.phone ? `+91${userInfo.phone}` : '',
      },
      modal: { ondismiss: () => reject(new Error('Advance payment was cancelled. Your ride was not booked.')) },
      handler: async (paymentResponse) => {
        try {
          resolve(await api.post(verifyPath, { checkoutId: pending.checkoutId, ...paymentResponse }, config));
        } catch (error) {
          reject(new Error(error?.message || 'Advance payment verification failed'));
        }
      },
      theme: { color: '#0f172a' },
    });
    checkout.on('payment.failed', (event) => reject(new Error(event?.error?.description || event?.error?.reason || 'Advance payment failed')));
    checkout.open();
  });
};
