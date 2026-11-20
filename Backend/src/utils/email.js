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

const escapeHtml = (v) =>
    String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Login details for a new (or password-reset) admin employee. The password is the one the main
 * admin set; the employee is asked to change it after the first sign-in.
 * @returns {Promise<boolean>} true if sent
 */
export async function sendEmployeeCredentialsEmail({ to, name, roleName, password, loginUrl, isReset = false }) {
    const trans = getTransporter();
    if (!trans) {
        logger.warn('Employee credentials email skipped: SMTP not configured');
        return false;
    }
    const from = config.emailFrom || config.emailUser;
    const subject = isReset
        ? 'Your Buddy Services admin password was reset'
        : 'Welcome to Buddy Services - your admin panel login';
    const safe = { name: escapeHtml(name || 'there'), role: escapeHtml(roleName), email: escapeHtml(to), pw: escapeHtml(password), url: escapeHtml(loginUrl) };
    const row = (label, value, mono = false) =>
        `<tr><td style="padding:10px 14px;color:#6b7280;font-size:13px;width:34%;border-bottom:1px solid #eef2f7;">${label}</td>` +
        `<td style="padding:10px 14px;font-size:15px;font-weight:600;color:#111827;border-bottom:1px solid #eef2f7;${mono ? 'font-family:Consolas,Menlo,monospace;letter-spacing:.5px;' : ''}">${value}</td></tr>`;
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px;"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
      <tr><td style="background:linear-gradient(135deg,#16a34a,#0f172a);padding:26px 28px;color:#ffffff;">
        <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;opacity:.85;">Buddy Services</div>
        <div style="font-size:22px;font-weight:700;margin-top:6px;">${isReset ? 'Password reset' : 'Welcome aboard'}</div>
      </td></tr>
      <tr><td style="padding:26px 28px;">
        <p style="margin:0 0 12px;font-size:16px;">Hi ${safe.name},</p>
        <p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#374151;">
          ${isReset ? 'Your admin panel password was reset by an administrator.' : 'You have been added to the Buddy Services admin panel.'}
          Use the details below to sign in.
        </p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eef2f7;border-radius:12px;overflow:hidden;">
          ${row('Login ID (email)', safe.email)}
          ${row('Password', safe.pw, true)}
          ${row('Role', safe.role)}
        </table>
        <div style="text-align:center;margin:24px 0 8px;">
          <a href="${safe.url}" style="display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 30px;border-radius:10px;">Open admin login</a>
        </div>
        <p style="margin:14px 0 0;font-size:12px;color:#6b7280;text-align:center;word-break:break-all;">${safe.url}</p>
        <div style="margin-top:22px;padding:12px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;font-size:13px;color:#92400e;line-height:1.5;">
          On the login page choose your role (<b>${safe.role}</b>), then sign in. For your security, change this password after your first login and do not share it with anyone.
        </div>
      </td></tr>
      <tr><td style="padding:16px 28px;background:#f9fafb;border-top:1px solid #eef2f7;font-size:12px;color:#9ca3af;text-align:center;">
        This is an automated message from Buddy Services. If you were not expecting it, please contact your administrator.
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
    const text = [
        `Hi ${name || 'there'},`,
        isReset ? 'Your admin panel password was reset by an administrator.' : 'You have been added to the Buddy Services admin panel.',
        '',
        `Login URL: ${loginUrl}`,
        `Login ID (email): ${to}`,
        `Password: ${password}`,
        `Role: ${roleName}`,
        '',
        'On the login page choose your role, then sign in. Please change your password after your first login.',
    ].join('\n');
    try {
        await trans.sendMail({
            from: typeof from === 'string' && from.includes('<') ? from : `Buddy Services <${from}>`,
            to,
            subject,
            text,
            html,
        });
        logger.info(`Employee credentials email sent to ${to}`);
        return true;
    } catch (err) {
        logger.error(`Failed to send employee credentials email to ${to}: ${err.message}`);
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
