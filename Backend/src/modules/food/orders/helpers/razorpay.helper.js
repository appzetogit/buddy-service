import crypto from 'crypto';

let Razorpay;
try {
    const mod = await import('razorpay');
    Razorpay = mod.default;
} catch {
    Razorpay = null;
}

import { config } from '../../../../config/env.js';
import { logger } from '../../../../utils/logger.js';

/**
 * Resolve credentials for the configured environment.
 *
 * This module previously read RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET directly and ignored
 * RAZORPAY_ENVIRONMENT, RAZORPAY_LIVE_* and RAZORPAY_TEST_* entirely — so flipping the
 * environment to `live` silently changed nothing and the platform kept transacting on test
 * keys. Every food/wallet/delivery payment path funnels through here, so this is the one
 * place that decision is made.
 */
const ENVIRONMENT = config.razorpayEnvironment === 'live' ? 'live' : 'test';

const EXPECTED_KEY_PREFIX = { live: 'rzp_live_', test: 'rzp_test_' };

const resolveCredentials = () => {
    const raw = ENVIRONMENT === 'live'
        ? { keyId: config.razorpayLiveApiKey, keySecret: config.razorpayLiveSecretKey }
        // config.razorpayTestApiKey already falls back to RAZORPAY_KEY_ID, so existing
        // single-key setups keep working untouched.
        : { keyId: config.razorpayTestApiKey, keySecret: config.razorpayTestSecretKey };

    const keyId = String(raw.keyId || '').trim();
    const keySecret = String(raw.keySecret || '').trim();

    if (!keyId || !keySecret) {
        logger.error(
            `Razorpay ${ENVIRONMENT.toUpperCase()} credentials are missing — payments are DISABLED. ` +
            (ENVIRONMENT === 'live'
                ? 'Set RAZORPAY_LIVE_API_KEY and RAZORPAY_LIVE_SECRET_KEY.'
                : 'Set RAZORPAY_TEST_API_KEY/RAZORPAY_TEST_SECRET_KEY (or RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET).'),
        );
        return { keyId: '', keySecret: '' };
    }

    // Fail CLOSED on a mismatch rather than transacting with the wrong key. Both directions are
    // damaging: a test key in a live environment takes orders that never settle, and a live key
    // in a test environment charges real cards from a staging box.
    const expected = EXPECTED_KEY_PREFIX[ENVIRONMENT];
    if (keyId.startsWith('rzp_') && !keyId.startsWith(expected)) {
        logger.error(
            `Razorpay key/environment mismatch — payments are DISABLED. ` +
            `RAZORPAY_ENVIRONMENT=${ENVIRONMENT} expects a "${expected}…" key but got "${keyId.slice(0, 9)}…". ` +
            `Refusing to transact with the wrong key.`,
        );
        return { keyId: '', keySecret: '' };
    }

    return { keyId, keySecret };
};

const { keyId: KEY_ID, keySecret: KEY_SECRET } = resolveCredentials();

if (KEY_ID) {
    logger.info(`Razorpay configured in ${ENVIRONMENT.toUpperCase()} mode (key ${KEY_ID.slice(0, 12)}…)`);
}

export function isRazorpayConfigured() {
    return Boolean(KEY_ID && KEY_SECRET && Razorpay);
}

export function getRazorpayKeyId() {
    return KEY_ID;
}

/**
 * The resolved key pair, for modules (Taxi) that build their own Razorpay client or verify their own
 * signatures. Same credentials and the same environment rules as every other payment path.
 */
export function getRazorpayCredentials() {
    return { keyId: KEY_ID, keySecret: KEY_SECRET, environment: ENVIRONMENT };
}

/** Which environment the resolved credentials belong to: 'test' | 'live'. */
export function getRazorpayEnvironment() {
    return ENVIRONMENT;
}

/**
 * May we serve the "dev stub" checkout (fake key + fake order id) when Razorpay is unconfigured?
 *
 * Only outside production. In production that stub hands the client a bogus key, so Razorpay
 * checkout opens and fails with an opaque 400 — a misconfiguration surfacing as a broken
 * payment instead of a clear error.
 */
export function canUseRazorpayDevStub() {
    return config.nodeEnv !== 'production';
}

/**
 * Throw a clear, actionable error when payments are unavailable in production.
 * @throws {Error}
 */
export function assertRazorpayAvailableInProduction() {
    if (isRazorpayConfigured() || canUseRazorpayDevStub()) return;
    throw new Error(
        `Payments are unavailable: Razorpay is not configured for ${ENVIRONMENT.toUpperCase()} mode. ` +
        'Check RAZORPAY_ENVIRONMENT and the matching key/secret pair.',
    );
}

export function getRazorpayInstance() {
    if (!isRazorpayConfigured()) return null;
    return new Razorpay({ key_id: KEY_ID, key_secret: KEY_SECRET });
}

export function createRazorpayOrder(amountPaise, currency = 'INR', receipt = '') {
    const instance = getRazorpayInstance();
    if (!instance) return Promise.reject(new Error('Razorpay not configured'));
    return instance.orders.create({
        amount: Math.round(amountPaise),
        currency,
        receipt: receipt || undefined
    });
}

export function createPaymentLink({ amountPaise, currency = 'INR', description, orderId, customerName, customerEmail, customerPhone }) {
    const instance = getRazorpayInstance();
    if (!instance) return Promise.reject(new Error('Razorpay not configured'));
    return instance.paymentLink.create({
        amount: Math.round(amountPaise),
        currency,
        description: description || `Order ${orderId}`,
        customer: {
            name: customerName || 'Customer',
            email: customerEmail || 'customer@example.com',
            contact: customerPhone ? String(customerPhone).replace(/\D/g, '').slice(-10) : '9999999999'
        }
    });
}

export function verifyPaymentSignature(orderId, paymentId, signature) {
    if (!KEY_SECRET) return false;
    const body = `${orderId}|${paymentId}`;
    const expected = crypto.createHmac('sha256', KEY_SECRET).update(body).digest('hex');
    return expected === signature;
}

/**
 * Fetch Razorpay payment (server-side) for additional validation (amount/status/order match).
 * @param {string} paymentId
 */
export async function fetchRazorpayPayment(paymentId) {
    const instance = getRazorpayInstance();
    if (!instance) throw new Error('Razorpay not configured');
    if (!paymentId) throw new Error('paymentId is required');
    return instance.payments.fetch(String(paymentId));
}

/**
 * Fetch Razorpay payment-link to check status (used for Razorpay QR auto verification).
 * @param {string} paymentLinkId
 */
export async function fetchRazorpayPaymentLink(paymentLinkId) {
    const instance = getRazorpayInstance();
    if (!instance) throw new Error('Razorpay not configured');
    if (!paymentLinkId) throw new Error('paymentLinkId is required');
    return instance.paymentLink.fetch(String(paymentLinkId));
}

/**
 * ✅ NEW: Initiate a refund for a successful payment.
 * NON-BREAKING Extension for automated cancellation refunds.
 * @param {string} paymentId - Original Razorpay payment_id (captured)
 * @param {number} amount - Amount to refund (in major unit, e.g., INR 123.45)
 */
export async function initiateRazorpayRefund(paymentId, amount) {
    if (!isRazorpayConfigured()) {
        throw new Error('Razorpay is not configured on this server');
    }
    const instance = getRazorpayInstance();
    try {
        const refund = await instance.payments.refund(paymentId, {
            amount: Math.round(Number(amount) * 100), // convert to paise
            notes: {
                reason: 'Order cancelled by system flow',
                at: new Date().toISOString()
            }
        });
        return {
            success: true,
            refundId: refund.id,
            status: refund.status || 'processed',
            raw: refund
        };
    } catch (err) {
        // Log locally but pass the error to the service to handle status update
        console.error(`Razorpay Refund API Failure [PaymentId: ${paymentId}]:`, err?.message || err);
        return {
            success: false,
            error: err?.message || 'Razorpay refund API error',
            status: 'failed'
        };
    }
}
