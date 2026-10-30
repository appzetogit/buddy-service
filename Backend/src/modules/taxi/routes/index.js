import { Router } from 'express';
import { taxiDeliveryRouter } from '../delivery/taxiDelivery.routes.js';
import { adminModuleRouter } from '../admin/routes/index.js';
import { supportModuleRouter } from '../support/routes/index.js';
import { userModuleRouter } from '../user/routes/index.js';
import { commonRouter } from '../common/routes/commonRoutes.js';
import { errorHandler } from '../middlewares/errorMiddleware.js';

/**
 * Taxi HTTP API, mounted by the platform router at /api/v1/taxi.
 *
 * Rider and admin endpoints only; the driver API and the marketing / careers endpoints of the
 * original service are not part of this platform. Errors raised inside this router are answered
 * by the taxi error handler, so the platform-wide handler (and Food / Quick Commerce) is untouched.
 */
export const taxiRouter = Router();

// Riders (delivery partners) taking rides - same login as the rest of the delivery app.
taxiRouter.use('/delivery', taxiDeliveryRouter);
taxiRouter.use('/driver', taxiDeliveryRouter);
taxiRouter.use(adminModuleRouter);
taxiRouter.use(userModuleRouter);
taxiRouter.use(supportModuleRouter);
taxiRouter.use(commonRouter);

taxiRouter.get('/', (_req, res) => {
  res.json({
    success: true,
    message: 'Taxi API is mounted',
    routes: { admin: '/admin', users: '/users', rides: '/rides', deliveries: '/deliveries' },
  });
});

taxiRouter.use(errorHandler);
