import nodemailer from 'nodemailer';

/**
 * SMTP comes from the EMAIL_* environment variables (host defaults to smtp.gmail.com, as before).
 */
const readMailSettings = async () => {
  const mail = {};
  const pick = (value, fallback) => {
    const trimmed = String(value ?? '').trim();
    return trimmed || fallback || '';
  };

  const port = Number(pick(mail.mail_port, process.env.EMAIL_PORT) || 587);
  const encryption = pick(mail.mail_encryption, '').toLowerCase();

  return {
    host: pick(mail.mail_host, process.env.EMAIL_HOST || 'smtp.gmail.com'),
    port,
    // Implicit TLS is 465; 587 upgrades via STARTTLS and must not set secure.
    secure: encryption === 'ssl' || port === 465,
    user: pick(mail.mail_username, process.env.EMAIL_USER),
    pass: pick(mail.mail_password, process.env.EMAIL_PASS),
    fromName: pick(mail.mail_from_name, process.env.APP_NAME || 'Buddy'),
    fromAddress: pick(mail.mail_from_address, process.env.EMAIL_FROM || process.env.EMAIL_USER),
  };
};

export const getMailConfigStatus = async () => {
  const config = await readMailSettings();
  const missing = ['host', 'user', 'pass', 'fromAddress'].filter((key) => !config[key]);

  return { configured: missing.length === 0, missing, host: config.host, port: config.port };
};

export const sendEmail = async ({ to, subject, text, html, attachments = [] }) => {
  const config = await readMailSettings();

  if (!config.host || !config.user || !config.pass) {
    // Not an error: a deployment with no SMTP set up should not fail the action
    // that triggered the mail. Callers decide whether that matters.
    console.warn('[mail] SMTP not configured; skipping email to', to);
    return { skipped: true, reason: 'smtp-not-configured' };
  }

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
  });

  const info = await transporter.sendMail({
    from: config.fromName ? `"${config.fromName}" <${config.fromAddress}>` : config.fromAddress,
    to,
    subject,
    text,
    html,
    attachments,
  });

  console.log(`[mail] sent ${info.messageId} to ${to}`);
  return info;
};
