/**
 * Taxi cash-on-delivery with an advance (see modules/common/cod/cod.service.js for the contract).
 *
 * A COD ride is booked as paymentMethod 'cash' with a `cod` block. The advance was paid up front (wallet
 * and/or online) and stays with the platform; the driver collects only the rest in cash. These helpers are
 * the single place that knows what is owed / collected, so settlement, reports and the apps agree.
 */
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export const hasCod = (ride) => ride?.cod?.enabled === true;

/** The advance the platform is holding for this ride (0 once refunded or never paid). */
export const codAdvanceHeld = (ride) =>
  hasCod(ride) && ride.cod.advanceStatus === 'paid' ? round2(ride.cod.advanceAmount || 0) : 0;

/** The part of the advance that pays for the fare (a fare that ended below the advance keeps only the fare). */
export const codAdvanceApplied = (ride) => Math.min(codAdvanceHeld(ride), round2(ride?.fare || 0));

/** What the customer still owes for this ride: the whole fare for a normal ride, fare minus advance for COD. */
export const rideAmountDue = (ride) => {
  const fare = round2(ride?.fare || 0);
  return hasCod(ride) ? Math.max(0, round2(fare - codAdvanceHeld(ride))) : fare;
};

const paidInApp = (ride) => String(ride?.driverPaymentCollection?.status || '').toLowerCase() === 'paid';

/** Cash that actually changed hands with the driver on a settled ride. */
export const rideCashPortion = (ride) => {
  if (hasCod(ride)) return paidInApp(ride) ? 0 : rideAmountDue(ride);
  return String(ride?.paymentMethod || 'cash').toLowerCase() === 'cash' && !paidInApp(ride) ? round2(ride?.fare || 0) : 0;
};

/** The `cod` block as the apps / admin see it. */
export const serializeCod = (ride) => {
  if (!hasCod(ride)) return null;
  const c = ride.cod;
  return {
    enabled: true,
    percent: Number(c.percent || 0),
    advanceAmount: round2(c.advanceAmount || 0),
    advanceWalletAmount: round2(c.advanceWalletAmount || 0),
    advanceOnlineAmount: round2(c.advanceOnlineAmount || 0),
    remainingAmount: rideAmountDue(ride),
    advanceStatus: c.advanceStatus || 'none',
    refundedAmount: round2(c.refundedAmount || 0),
    refundedAt: c.refundedAt || null,
    collectedAmount: round2(c.collectedAmount || 0),
    collectedAt: c.collectedAt || null,
  };
};
