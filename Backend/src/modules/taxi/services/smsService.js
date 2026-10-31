import { env } from '../shared/env.js';
import { ApiError } from '../../../utils/ApiError.js';
import { sendWhatsappOtp } from '../../../utils/whatsapp.js';

const isTruthy = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());

/** Taxi login OTP, delivered on WhatsApp (BhashSMS). Name kept so callers are unchanged. */
export const sendOtpSms = async ({ phone, otp, purpose = 'otp' }) => {
  if (isTruthy(env.sms.useDefaultOtp)) {
    return { mode: 'debug', message: 'Default OTP mode enabled' };
  }

  if (!(await sendWhatsappOtp(phone, otp))) {
    throw new ApiError(502, `WhatsApp ${purpose} could not be sent. Please try again.`);
  }

  return { mode: 'live', message: 'OTP sent successfully' };
};
