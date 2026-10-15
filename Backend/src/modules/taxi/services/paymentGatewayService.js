import { ApiError } from '../../../utils/ApiError.js';
import { getRazorpayCredentials, isRazorpayConfigured } from '../../food/orders/helpers/razorpay.helper.js';

const PAYMENT_GATEWAY_SPECS = {
  razor_pay: {
    label: 'Razorpay',
    environmentKey: 'environment',
    liveValue: 'live',
    credentialsByEnvironment: {
      test: ['test_api_key', 'test_secret_key'],
      live: ['live_api_key', 'live_secret_key'],
    },
  },
  phone_pay: {
    label: 'PhonePe',
    environmentKey: 'environment',
    liveValue: 'production',
    credentialsByEnvironment: {
      test: ['merchant_id', 'salt_key', 'salt_index'],
      production: ['merchant_id', 'salt_key', 'salt_index'],
    },
  },
  stripe: {
    label: 'Stripe',
    environmentKey: 'environment',
    liveValue: 'live',
    credentialsByEnvironment: {
      test: ['test_secret_key', 'test_publishable_key'],
      live: ['live_secret_key', 'live_publishable_key'],
    },
  },
};

const normalizeString = (value = '') => String(value || '').trim();
const normalizeEnabled = (value) => (String(value ?? '0').trim() === '1' ? '1' : '0');

const PHONEPE_FIELD_ALIASES = {
  merchant_id: ['merchant_id', 'client_id'],
  salt_key: ['salt_key', 'client_secret'],
  salt_index: ['salt_index', 'client_version'],
};

const getFirstConfiguredValue = (config = {}, candidateKeys = []) =>
  candidateKeys
    .map((field) => normalizeString(config?.[field]))
    .find(Boolean) || '';

const normalizePhonePeAliases = (gatewayValue = {}) => {
  const normalized = { ...gatewayValue };

  for (const [canonicalField, candidateKeys] of Object.entries(PHONEPE_FIELD_ALIASES)) {
    const resolvedValue = getFirstConfiguredValue(gatewayValue, candidateKeys);
    if (resolvedValue) {
      normalized[canonicalField] = resolvedValue;
    }
  }

  return normalized;
};

const normalizeGatewayConfig = (gatewayKey, gatewayValue = {}) => {
  const current = gatewayValue && typeof gatewayValue === 'object' ? gatewayValue : {};
  const baseConfig =
    gatewayKey === 'phone_pay'
      ? normalizePhonePeAliases(current)
      : current;
  const normalized = { ...baseConfig, enabled: normalizeEnabled(baseConfig.enabled) };
  const spec = PAYMENT_GATEWAY_SPECS[gatewayKey];

  if (spec?.environmentKey) {
    const fallbackEnvironment = Object.keys(spec.credentialsByEnvironment)[0] || 'test';
    normalized[spec.environmentKey] = normalizeString(current[spec.environmentKey] || fallbackEnvironment).toLowerCase();
  }

  return normalized;
};

const getCredentialFieldLabel = (field) =>
  field
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

export const validateGatewayConfiguration = (gatewayKey, gatewayValue = {}) => {
  const spec = PAYMENT_GATEWAY_SPECS[gatewayKey];
  if (!spec) {
    return normalizeGatewayConfig(gatewayKey, gatewayValue);
  }

  const normalized = normalizeGatewayConfig(gatewayKey, gatewayValue);
  if (normalized.enabled !== '1') {
    return normalized;
  }

  const environment = normalizeString(normalized[spec.environmentKey] || '').toLowerCase();
  const requiredFields = spec.credentialsByEnvironment[environment] || [];
  const missingField = requiredFields.find((field) => !normalizeString(normalized[field]));

  if (missingField) {
    throw new ApiError(
      400,
      `${spec.label} ${getCredentialFieldLabel(missingField)} is required before enabling the gateway`,
    );
  }

  return normalized;
};

export const normalizePaymentSettingsPayload = (currentPaymentSettings = {}, payload = {}) => {
  const merged = {
    ...currentPaymentSettings,
    ...payload,
  };

  for (const gatewayKey of Object.keys(PAYMENT_GATEWAY_SPECS)) {
    merged[gatewayKey] = validateGatewayConfiguration(gatewayKey, merged[gatewayKey] || {});
  }

  const enabledGatewayKeys = Object.keys(PAYMENT_GATEWAY_SPECS).filter(
    (gatewayKey) => merged[gatewayKey]?.enabled === '1',
  );

  if (enabledGatewayKeys.length > 1) {
    const winningGatewayKey = enabledGatewayKeys[enabledGatewayKeys.length - 1];
    for (const gatewayKey of enabledGatewayKeys) {
      merged[gatewayKey] = {
        ...(merged[gatewayKey] || {}),
        enabled: gatewayKey === winningGatewayKey ? '1' : '0',
      };
    }
  }

  return merged;
};

/**
 * Taxi takes payments through the platform's Razorpay account (the same keys Food and Quick
 * Commerce use), so the active gateway is whatever the platform has configured - not a separate
 * per-module setting.
 */
export const getActivePaymentGateway = async () => {
  if (!isRazorpayConfigured()) return null;
  const { environment } = getRazorpayCredentials();
  return {
    slug: 'razor_pay',
    label: PAYMENT_GATEWAY_SPECS.razor_pay.label,
    settings: { enabled: '1', environment },
  };
};

export const getPublicActivePaymentGateway = async () => {
  const activeGateway = await getActivePaymentGateway();

  if (!activeGateway) {
    return {
      activeGateway: null,
    };
  }

  return {
    activeGateway: {
      slug: activeGateway.slug,
      label: activeGateway.label,
      supportsWalletTopUp: ['razor_pay', 'phone_pay'].includes(activeGateway.slug),
      supportsRentalAdvance: ['razor_pay', 'phone_pay'].includes(activeGateway.slug),
      walletTopUpMode:
        activeGateway.slug === 'razor_pay'
          ? 'razorpay_checkout'
          : activeGateway.slug === 'phone_pay'
            ? 'phonepe_redirect'
            : 'unsupported',
      rentalAdvanceMode:
        activeGateway.slug === 'razor_pay'
          ? 'razorpay_checkout'
          : activeGateway.slug === 'phone_pay'
            ? 'phonepe_redirect'
            : 'unsupported',
    },
  };
};

export const resolveConfiguredGatewayCredentials = async (gatewayKey) => {
  if (gatewayKey !== 'razor_pay') {
    throw new ApiError(400, `${PAYMENT_GATEWAY_SPECS[gatewayKey]?.label || 'This'} gateway is not available on this platform`);
  }
  if (!isRazorpayConfigured()) {
    throw new ApiError(403, 'Online payment is not configured');
  }
  const { keyId, keySecret, environment } = getRazorpayCredentials();
  return { keyId, keySecret, environment };
};
