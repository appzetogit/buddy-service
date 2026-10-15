/**
 * Taxi module configuration, derived from the platform config.
 *
 * The taxi code expects an `env` object with its own shape (it was written as a standalone
 * service). Rather than a second dotenv load and a second set of required variables, this reads
 * the platform `config` (JWT, Redis, Firebase) and falls back to process.env only for the few
 * taxi-specific knobs that have no platform equivalent. Nothing here is required to boot.
 */
import { config } from '../../../config/env.js';

const readEnv = (...keys) => {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

const positiveNumber = (value, fallback) =>
  Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;

export const env = {
  nodeEnv: config.nodeEnv,
  port: Number(config.port) || 5000,
  mongoUri: config.mongodbUri,
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
  jwtSecret: config.jwtSecret,
  jwtExpiresIn: config.jwtExpiresIn,
  corsOrigin: process.env.CORS_ORIGIN || process.env.FRONTEND_URL || '*',
  publicFrontendUrl:
    process.env.PUBLIC_FRONTEND_URL ||
    process.env.APP_FRONTEND_URL ||
    process.env.FRONTEND_PUBLIC_URL ||
    process.env.FRONTEND_URL ||
    '',
  publicBackendUrl:
    process.env.PUBLIC_BACKEND_URL ||
    process.env.APP_BACKEND_URL ||
    process.env.BACKEND_PUBLIC_URL ||
    process.env.BACKEND_URL ||
    '',
  phonePeRedirectBaseUrl:
    process.env.PHONEPE_REDIRECT_BASE_URL ||
    process.env.PHONEPE_CALLBACK_BASE_URL ||
    process.env.PUBLIC_PHONEPE_REDIRECT_URL ||
    '',
  uploads: {
    folder: process.env.TAXI_UPLOAD_FOLDER || 'taxi',
    maxBytes: process.env.UPLOAD_MAX_BYTES || '',
  },
  firebase: {
    databaseURL: process.env.FIREBASE_DATABASE_URL || '',
    serviceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '',
    serviceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT || '',
  },
  sms: {
    useDefaultOtp: process.env.USE_DEFAULT_OTP || 'false',
    staticOtpPhone: readEnv('STATIC_OTP_PHONE'),
    staticOtpCode: readEnv('STATIC_OTP_CODE'),
    demoLoginPhones: readEnv('DEMO_LOGIN_PHONES'),
    otpExpiryMinutes: positiveNumber(process.env.OTP_EXPIRY_MINUTES, 10),
    indiaHub: {
      username: readEnv('SMS_INDIA_HUB_USERNAME'),
      password: readEnv('SMS_INDIA_HUB_PASSWORD'),
      apiKey: readEnv('SMS_INDIA_HUB_API_KEY'),
      apiKeyOverride: readEnv('SMS_INDIA_HUB_API_KEY_OVERRIDE'),
      senderId: readEnv('SMS_INDIA_HUB_SENDER_ID'),
      dltTemplateId: readEnv('SMS_INDIA_HUB_DLT_TEMPLATE_ID'),
    },
  },
  driverWallet: {
    joiningBonus: Number.isFinite(Number(process.env.DRIVER_JOINING_BONUS)) ? Number(process.env.DRIVER_JOINING_BONUS) : 100,
    defaultCashLimit: Number.isFinite(Number(process.env.DRIVER_WALLET_DEFAULT_CASH_LIMIT))
      ? Number(process.env.DRIVER_WALLET_DEFAULT_CASH_LIMIT)
      : 500,
    commissionPercent: Number.isFinite(Number(process.env.DRIVER_COMMISSION_PERCENT))
      ? Number(process.env.DRIVER_COMMISSION_PERCENT)
      : 20,
  },
  redis: {
    url: config.redisUrl || '',
    enabled: Boolean(config.redisEnabled),
    rateLimitEnabled: !['false', '0', 'off'].includes(String(process.env.REDIS_RATE_LIMIT_ENABLED || 'true').trim().toLowerCase()),
    connectTimeoutMs: positiveNumber(process.env.REDIS_CONNECT_TIMEOUT_MS, 2000),
    commandTimeoutMs: positiveNumber(process.env.REDIS_COMMAND_TIMEOUT_MS, 500),
  },
};
