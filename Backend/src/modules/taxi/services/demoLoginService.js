import { env } from '../shared/env.js';

/**
 * Phones that log in with a fixed OTP, for app-store review and for testing.
 *
 * Configured as `DEMO_LOGIN_PHONES=9000000001:1234,8000000002:1234`. Read by
 * both the rider and the driver login, so one number can be handed to a
 * reviewer who needs to open both apps without receiving an SMS.
 *
 * This exists because `STATIC_OTP_PHONE`/`STATIC_OTP_CODE` hold exactly one
 * number between the two apps: using it for a review account took away the
 * team's own test number.
 *
 * Only ever an addition - a phone not listed here gets a real OTP as before,
 * and an empty or malformed setting leaves every login untouched.
 */

const normalize = (value) => String(value || '').replace(/\D/g, '').slice(-10);

const parse = (raw) => {
  const map = new Map();

  for (const entry of String(raw || '').split(',')) {
    const [phone, otp] = entry.split(':');
    const normalizedPhone = normalize(phone);
    const normalizedOtp = String(otp || '').trim();

    // Both halves or nothing: a bare phone with no code would otherwise log in
    // with an empty OTP.
    if (normalizedPhone.length === 10 && /^\d{4,8}$/.test(normalizedOtp)) {
      map.set(normalizedPhone, normalizedOtp);
    }
  }

  return map;
};

let cache = { raw: null, map: new Map() };

const getMap = () => {
  const raw = env.sms?.demoLoginPhones || '';
  if (cache.raw !== raw) {
    cache = { raw, map: parse(raw) };
  }
  return cache.map;
};

/** The fixed OTP for this phone, or null when it is an ordinary number. */
export const resolveDemoOtpForPhone = (phone) => getMap().get(normalize(phone)) || null;

export const isDemoLoginPhone = (phone) => Boolean(resolveDemoOtpForPhone(phone));
