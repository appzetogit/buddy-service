import mongoose from 'mongoose';
import dns from 'dns';
import { config } from './env.js';
import { logger } from '../utils/logger.js';

// Override default DNS servers with Google DNS & Cloudflare DNS to ensure SRV record resolution
dns.setServers(['8.8.8.8', '1.1.1.1']);


export const connectDB = async () => {
    try {
        const poolSize = Number(process.env.MONGO_MAX_POOL_SIZE || 10);
        const conn = await mongoose.connect(config.mongodbUri, {
            maxPoolSize: Number.isFinite(poolSize) && poolSize > 0 ? poolSize : 10,
            serverSelectionTimeoutMS: Number(process.env.MONGO_CONNECT_TIMEOUT_MS || 10000),
            socketTimeoutMS: Number(process.env.MONGO_SOCKET_TIMEOUT_MS || 45000),
        });
        logger.info(`MongoDB connected: ${conn.connection.host}`);
    } catch (error) {
        logger.error(`MongoDB connection error: ${error.message}`);
        process.exit(1);
    }
};

/**
 * Close MongoDB connection (e.g. graceful shutdown).
 * @returns {Promise<void>}
 */
export const disconnectDB = async () => {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed');
};
