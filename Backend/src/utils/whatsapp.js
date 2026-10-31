import { config } from '../config/env.js';
import { logger } from './logger.js';

const local10 = (phone) => String(phone || '').replace(/\D/g, '').slice(-10);

export const isWhatsappConfigured = () => {
    const w = config.whatsapp;
    return Boolean(w.baseUrl && w.username && w.password && w.sender);
};

/**
 * One BhashSMS WhatsApp call. Returns true only if the provider accepted it; never throws.
 * stype=auth  -> OTP template (Params=OTP)
 * stype=normal -> utility template (Params=comma separated, in {{1}}, {{2}}... order)
 */
const callBhash = async ({ phone, template, params, stype }) => {
    const to = local10(phone);
    if (to.length !== 10) return false;
    if (!isWhatsappConfigured()) {
        logger.warn('[WhatsApp] skipped: BhashSMS is not configured (WHATSAPP_* env).');
        return false;
    }
    const w = config.whatsapp;
    const url = new URL(w.baseUrl);
    url.searchParams.set('user', w.username);
    url.searchParams.set('pass', w.password);
    url.searchParams.set('sender', w.sender);
    url.searchParams.set('phone', to); // without 91, per provider docs
    url.searchParams.set('text', template);
    url.searchParams.set('priority', 'wa');
    url.searchParams.set('stype', stype);
    // shortcut: a comma inside a param would split it into two; names/ids/statuses here never contain one.
    url.searchParams.set('Params', params.map((p) => String(p ?? '').replace(/[,\r\n]+/g, ' ').trim()).join(','));

    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
        const body = (await res.text()).trim();
        const ok = res.ok && !/error|invalid|fail|unauthor|reject|blank|not\s*approved|incorrect|deactivated|insufficient|no\s+sufficient|credit|balance/i.test(body);
        if (!ok) logger.error(`[WhatsApp] ${template} to ${to} rejected: ${res.status} ${body.slice(0, 200)}`);
        return ok;
    } catch (error) {
        logger.error(`[WhatsApp] ${template} to ${to} failed: ${error.message}`);
        return false;
    }
};

export const sendWhatsappOtp = (phone, otp) =>
    callBhash({ phone, template: config.whatsapp.otpTemplate, params: [otp], stype: 'auth' });

/** order_status template: "Hello {{1}}, Your order #{{2}} has been updated. Current Order Status: {{3}} ..." */
export const sendWhatsappOrderStatus = ({ phone, name, orderId, status }) =>
    callBhash({
        phone,
        template: config.whatsapp.orderTemplate,
        params: [name || 'Customer', orderId, status],
        stype: 'normal',
    });
