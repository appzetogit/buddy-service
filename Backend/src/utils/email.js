import nodemailer from 'nodemailer';
import { config } from '../config/env.js';
import { logger } from './logger.js';

let transporter = null;

function getTransporter() {
    if (transporter) return transporter;
    const { emailHost, emailPort, emailUser, emailPass } = config;
    if (!emailHost || !emailUser || !emailPass) {
        logger.warn('Email not configured: EMAIL_HOST, EMAIL_USER, EMAIL_PASS required');
        return null;
    }
    transporter = nodemailer.createTransport({
        host: emailHost,
        port: emailPort || 587,
        secure: emailPort === 465,
        auth: {
            user: emailUser,
            pass: emailPass
        }
    });
    return transporter;
}

/**
 * Send OTP email for admin forgot password.
 * @param {string} to - Recipient email
 * @param {string} otp - 6-digit OTP
 * @returns {Promise<boolean>} true if sent, false if skipped/failed
 */
export async function sendAdminResetOtpEmail(to, otp) {
    const trans = getTransporter();
    if (!trans) {
        logger.warn('Admin OTP email skipped: SMTP not configured');
        return false;
    }
    const from = config.emailFrom || config.emailUser;
    const subject = 'Your password reset code – Appzeto Admin';
    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 480px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #111;">Password reset code</h2>
  <p>Use the code below to reset your admin password. It is valid for 10 minutes.</p>
  <p style="font-size: 24px; font-weight: bold; letter-spacing: 4px; background: #f5f5f5; padding: 12px 16px; border-radius: 8px;">${otp}</p>
  <p style="color: #666; font-size: 14px;">If you did not request this, you can ignore this email.</p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
  <p style="color: #999; font-size: 12px;">Appzeto Admin</p>
</body>
</html>`;
    const text = `Your password reset code is: ${otp}. It is valid for 10 minutes. If you did not request this, ignore this email.`;

    try {
        await trans.sendMail({
            from: typeof from === 'string' && from.includes('<') ? from : `Appzeto <${from}>`,
            to,
            subject,
            text,
            html
        });
        logger.info(`Admin reset OTP email sent to ${to}`);
        return true;
    } catch (err) {
        logger.error(`Failed to send admin OTP email to ${to}:`, err.message);
        return false;
    }
}

function asSafeText(value, fallback = "there") {
    const text = String(value || "").trim();
    return text || fallback;
}

/**
 * Send seller onboarding/profile approval or rejection email (Quick Commerce sellers).
 * @param {string} to
 * @param {object} payload
 * @returns {Promise<boolean>}
 */
export async function sendSellerStatusEmail(to, payload = {}) {
    const trans = getTransporter();
    if (!trans) {
        logger.warn("Seller status email skipped: SMTP not configured");
        return false;
    }
    const recipient = String(to || "").trim();
    if (!recipient) return false;

    const from = config.emailFrom || config.emailUser;
    const sellerName = asSafeText(payload.name, "Seller");
    const shopName = asSafeText(payload.shopName, "");
    const heading = asSafeText(
        payload.title,
        payload.status === "rejected" ? "Seller application update" : "Seller application approved"
    );
    const body = asSafeText(payload.message, "There is an update on your seller account.");
    const shopLine = shopName ? `Shop: ${shopName}` : "";
    const subject = heading;
    const text = [`Hi ${sellerName},`, shopLine, body, "Open the seller app to see the latest status."]
        .filter(Boolean)
        .join("\n");
    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 520px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #111; margin: 0 0 12px;">${heading}</h2>
  <p>Hi ${sellerName},</p>
  ${shopName ? `<p>Shop: <strong>${shopName}</strong></p>` : ""}
  <p>${body}</p>
  <p>Open the seller app to see the latest status.</p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 18px 0;">
  <p style="color: #999; font-size: 12px;">Appzeto Team</p>
</body>
</html>`;

    try {
        await trans.sendMail({
            from: typeof from === "string" && from.includes("<") ? from : `Appzeto <${from}>`,
            to: recipient,
            subject,
            text,
            html,
        });
        logger.info(`Seller status email sent to ${recipient}`);
        return true;
    } catch (err) {
        logger.error(`Failed to send seller status email to ${recipient}:`, err.message);
        return false;
    }
}
