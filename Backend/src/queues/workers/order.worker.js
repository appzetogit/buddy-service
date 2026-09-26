import 'dotenv/config';
import { Worker } from 'bullmq';
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { getBullMQConnection } from '../connection.js';
import { ORDER_QUEUE } from '../queue.constants.js';
import { processOrderJob } from '../processors/order.processor.js';
import { connectDB } from '../../config/db.js';
// Dispatch looks up the quick-commerce model by name (`mongoose.model('Order')`),
// which only exists once this file is loaded — the API server gets it via its routes.
import '../../modules/quickCommerce/models/order.js';

const defaultJobOptions = {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 }
};

const startOrderWorker = () => {
    if (!config.bullmqEnabled) {
        logger.info('BullMQ is disabled. Order worker not started.');
        return null;
    }
    const connection = getBullMQConnection();
    if (!connection) {
        logger.error('Order worker: Redis connection unavailable. Exiting.');
        process.exit(1);
    }
    const worker = new Worker(ORDER_QUEUE, processOrderJob, {
        connection,
        // Must match the queue prefix in queues/index.js exactly, or this worker
        // subscribes to keys no producer ever writes.
        prefix: config.redisKeyPrefix,
        concurrency: 5,
        defaultJobOptions
    });
    worker.on('completed', (job) => logger.info(`Order job ${job.id} completed`));
    worker.on('failed', (job, err) => logger.error(`Order job ${job?.id} failed: ${err.message}`));
    worker.on('error', (err) => logger.error(`Order worker error: ${err.message}`));
    logger.info('Order worker started');
    return worker;
};

// DISPATCH_TIMEOUT_CHECK reads and writes orders; without a connection every
// query buffers and times out.
if (config.bullmqEnabled) await connectDB();
const worker = startOrderWorker();
if (worker) {
    const shutdown = async () => {
        await worker.close();
        process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}
