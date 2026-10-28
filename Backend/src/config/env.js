import dotenv from 'dotenv';

dotenv.config();

export const config = {
    // Basic server config
    port: process.env.PORT || 5000,
    host: process.env.HOST || '0.0.0.0',
    nodeEnv: process.env.NODE_ENV || 'development',

    // Database
    mongodbUri: process.env.MONGO_URI || process.env.MONGODB_URI,

    // JWT
    jwtAccessSecret: process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET,
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
    jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES || '15m',
    jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES || '7d',
    jwtSecret: process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET,
    jwtExpiresIn: process.env.JWT_ACCESS_EXPIRES || '7d',

    // OTP
    otpExpiry: process.env.OTP_EXPIRY || '5m',
    otpMaxAttempts: Number(process.env.OTP_MAX_ATTEMPTS || 5),
    otpExpiryMinutes: Number(process.env.OTP_EXPIRY_MINUTES || 10),
    otpExpirySeconds: Number(process.env.OTP_EXPIRY_SECONDS || 300),
    otpRateLimit: Number(process.env.OTP_RATE_LIMIT || 3),
    otpRateWindow: Number(process.env.OTP_RATE_WINDOW || 600),
    useDefaultOtp: process.env.USE_DEFAULT_OTP === 'true',

    // SMS India Hub
    smsIndiaHubUsername: process.env.SMS_INDIA_HUB_USERNAME,
    smsIndiaHubPassword: process.env.SMS_INDIA_HUB_PASSWORD,
    smsApiKey: process.env.SMS_INDIA_HUB_API_KEY,
    smsSenderId: process.env.SMS_INDIA_HUB_SENDER_ID,
    smsDltTemplateId: process.env.SMS_INDIA_HUB_DLT_TEMPLATE_ID,

    // Rate limiting
    rateLimitWindowMinutes: Number(process.env.RATE_LIMIT_WINDOW || 15),
    rateLimitMaxRequests: Number(process.env.RATE_LIMIT_MAX || 100),
    authRateLimitWindowMinutes: Number(process.env.AUTH_RATE_LIMIT_WINDOW || 15),
    authRateLimitMax: Number(process.env.AUTH_RATE_LIMIT_MAX || 30),

    // Security
    bcryptSaltRounds: Number(process.env.BCRYPT_SALT_ROUNDS || 10),

    // Uploads — served from disk instead of Cloudinary. uploadRoot is where files are written;
    // uploadPublicBaseUrl is the path express.static mounts at; uploadPublicHost is prefixed onto
    // that to build the full absolute URL stored in the DB (every consumer today expects an
    // absolute URL, same as Cloudinary's secure_url).
    uploadRoot: process.env.UPLOAD_ROOT || '/var/www/uploads',
    uploadPublicBaseUrl: process.env.UPLOAD_PUBLIC_BASE_URL || '/uploads',
    uploadPublicHost: (process.env.UPLOAD_PUBLIC_HOST || 'https://sooperbuddy.in').replace(/\/$/, ''),
    uploadPath: process.env.UPLOAD_PATH || 'uploads/',

    // Redis
    redisEnabled: process.env.REDIS_ENABLED === 'true',
    redisUrl: process.env.REDIS_URL,
    /**
     * Namespace for every Redis key this app owns (BullMQ queues + Socket.IO adapter channels).
     *
     * Not optional in practice: a shared Redis is common in dev, and BullMQ queue names here
     * ('order', 'tracking', 'otp', 'notification', 'payment') are generic enough to collide with
     * another project's queues — two apps would then consume each other's jobs. Socket.IO
     * pub/sub channels are NOT scoped by Redis db index, so they need this even when the db
     * index differs.
     */
    redisKeyPrefix: process.env.REDIS_KEY_PREFIX || 'buddy',

    // BullMQ
    bullmqEnabled: process.env.BULLMQ_ENABLED === 'true',

    // Realtime sync (see REALTIME_SYNC_PLAN.md).
    // When false, publish() emits exactly as the old direct io.to().emit() calls did — no
    // extra writes, no payload change. Turn on to start building the per-recipient event log.
    syncCursorEnabled: process.env.SYNC_CURSOR_ENABLED === 'true',
    // 0 disables the TTL index. Set (e.g. 7) once you are happy for the recovery buffer to
    // self-prune; enabling it will delete existing events older than this.
    syncEventTtlDays: Number(process.env.SYNC_EVENT_TTL_DAYS || 0),

    // Cloudinary
    cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME,
    cloudinaryApiKey: process.env.CLOUDINARY_API_KEY,
    cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET,
    cloudinaryFolder: process.env.CLOUDINARY_FOLDER || 'uploads',

    googleMapsApiKey:
        process.env.GOOGLE_MAPS_API_KEY
        || process.env.GOOGLE_MAPS_SERVER_KEY
        || process.env.VITE_GOOGLE_MAPS_API_KEY,

    // Firebase / FCM
    firebaseProjectId: process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID,
    firebaseDatabaseUrl: process.env.VITE_FIREBASE_DATABASE_URL,
    firebaseServiceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
    firebaseServiceAccount: process.env.FIREBASE_SERVICE_ACCOUNT,
    firebaseWebApiKey: process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY,
    firebaseWebAuthDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || process.env.FIREBASE_AUTH_DOMAIN,
    firebaseWebStorageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET,
    firebaseWebMessagingSenderId:
        process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || process.env.FIREBASE_MESSAGING_SENDER_ID,
    firebaseWebAppId: process.env.VITE_FIREBASE_APP_ID || process.env.FIREBASE_APP_ID,
    firebaseWebMeasurementId: process.env.VITE_FIREBASE_MEASUREMENT_ID || process.env.FIREBASE_MEASUREMENT_ID,
    firebaseWebVapidKey: process.env.VITE_FIREBASE_VAPID_KEY || process.env.FIREBASE_VAPID_KEY,

    // Socket.io
    socketCorsOrigin: process.env.SOCKET_CORS_ORIGIN || '*',

    // Razorpay (payments)
    razorpayEnvironment: (process.env.RAZORPAY_ENVIRONMENT || 'test').toLowerCase(),
    razorpayTestApiKey: process.env.RAZORPAY_TEST_API_KEY || process.env.RAZORPAY_KEY_ID,
    razorpayTestSecretKey: process.env.RAZORPAY_TEST_SECRET_KEY || process.env.RAZORPAY_KEY_SECRET,
    razorpayLiveApiKey: process.env.RAZORPAY_LIVE_API_KEY,
    razorpayLiveSecretKey: process.env.RAZORPAY_LIVE_SECRET_KEY,
    razorpayKeyId: process.env.RAZORPAY_KEY_ID,
    razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET,
    razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,

    // Email (SMTP) – for admin forgot password OTP etc.
    emailHost: process.env.MAIL_HOST || process.env.EMAIL_HOST,
    emailPort: Number(process.env.MAIL_PORT || process.env.EMAIL_PORT) || 587,
    emailUser: process.env.MAIL_USERNAME || process.env.EMAIL_USER,
    emailPass: (process.env.MAIL_PASSWORD || process.env.EMAIL_PASS)
        ? String(process.env.MAIL_PASSWORD || process.env.EMAIL_PASS).replace(/\s/g, '')
        : '',
    emailEncryption: process.env.MAIL_ENCRYPTION || process.env.EMAIL_ENCRYPTION || 'tls',
    emailFrom:
        process.env.MAIL_FROM_ADDRESS ||
        process.env.EMAIL_FROM ||
        process.env.MAIL_USERNAME ||
        process.env.EMAIL_USER ||
        'noreply@example.com',
    emailFromName: process.env.MAIL_FROM_NAME || process.env.EMAIL_FROM_NAME || 'Appzeto',
};

export const env = config;
