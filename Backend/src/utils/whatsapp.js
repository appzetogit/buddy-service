import https from 'node:https';
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

    // BhashSMS takes 5-10 s to open a NEW connection (TLS), then answers in under a second. Node's
    // fetch gives up on a connection after 10 s ("fetch failed"), so the OTP was often never sent.
    // Plain https waits up to 30 s, and the keep-alive agent reuses an open connection (the provider
    // keeps it 5 s), so back-to-back messages are fast. One retry if the connection itself fails.
    for (let attempt = 1; attempt <= 2; attempt += 1) {
        const started = Date.now();
        try {
            const { status, body } = await httpsGet(url, 30000);
            const ok = status >= 200 && status < 300 && !/error|invalid|fail|unauthor|reject|blank|not\s*approved|incorrect|deactivated|insufficient|no\s+sufficient|credit|balance/i.test(body);
            if (!ok) logger.error(`[WhatsApp] ${template} to ${to} rejected: ${status} ${body.slice(0, 200)}`);
            else if (Date.now() - started > 8000) logger.warn(`[WhatsApp] ${template} to ${to} slow provider: ${Date.now() - started} ms`);
            return ok;
        } catch (error) {
            logger.error(`[WhatsApp] ${template} to ${to} failed (try ${attempt}, ${Date.now() - started} ms): ${error.message}`);
            // A timeout after the request went out may still be delivered: don't send it twice.
            if (error?.code === 'REQUEST_TIMEOUT' || attempt === 2) return false;
        }
    }
    return false;
};

const keepAliveAgent = new https.Agent({ keepAlive: true, maxSockets: 10 });

/** GET over a reusable connection. Resolves { status, body }; rejects on a network error or timeout. */
const httpsGet = (url, timeoutMs) =>
    new Promise((resolve, reject) => {
        const req = https.get(url, { agent: keepAliveAgent }, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => resolve({ status: res.statusCode || 0, body: body.trim() }));
            res.on('error', reject);
        });
        // Connected = the request reached the provider; a timeout after that is not retried.
        let connected = false;
        req.on('socket', (socket) => {
            if (!socket.connecting) connected = true;
            else socket.once('secureConnect', () => { connected = true; });
        });
        req.setTimeout(timeoutMs, () => {
            const err = new Error(`no answer in ${timeoutMs} ms`);
            err.code = connected ? 'REQUEST_TIMEOUT' : 'CONNECT_TIMEOUT';
            req.destroy(err);
        });
        req.on('error', reject);
    });

/**
 * Keeps one connection to BhashSMS open while someone is on a login screen, so "Send OTP" goes out
 * over a ready connection (~0.5 s) instead of paying the provider's 5-10 s connection setup.
 * The provider closes idle connections after 5 s, so a light request is made every 4 s until
 * WARM_WINDOW_MS after the last login screen asked for it. One loop for the whole server.
 */
const WARM_WINDOW_MS = 3 * 60 * 1000;
let warmUntil = 0;
let warmTimer = null;
export const warmWhatsappConnection = () => {
    if (!isWhatsappConfigured()) return;
    warmUntil = Date.now() + WARM_WINDOW_MS;
    if (warmTimer) return;
    const ping = () => {
        if (Date.now() > warmUntil) {
            warmTimer = null;
            return;
        }
        // No credentials: the provider answers with an error page, which is all that is needed.
        httpsGet(new URL(config.whatsapp.baseUrl), 30000)
            .catch(() => {})
            .finally(() => { warmTimer = setTimeout(ping, 4000); });
    };
    warmTimer = setTimeout(ping, 0);
};

export const sendWhatsappOtp = (phone, otp) =>
    callBhash({ phone, template: config.whatsapp.otpTemplate, params: [otp], stype: 'auth' });

/** order_status template: "Hello {{1}}, Your order #{{2}} has been updated. Current Order Status: {{3}} ..." */
export const sendWhatsappOrderStatus = ({ phone, name, orderId, status, template }) =>
    callBhash({
        phone,
        template: template || config.whatsapp.orderTemplate,
        params: [name || 'Customer', orderId, status],
        stype: 'normal',
    });
