import express from 'express';
import { upload } from '../../../middleware/upload.js';
import { cacheResponse } from '../../../middleware/cache.js';
import {
    getPublicHomeConfigController,
    listHomeItemsController,
    createHomeItemController,
    updateHomeItemController,
    deleteHomeItemController,
} from '../controllers/homeConfig.controller.js';

// Public: the apps read the home screen from here (no login needed). Mounted at /v1/common/home-config.
export const homeConfigPublicRouter = express.Router();
homeConfigPublicRouter.get('/', cacheResponse(60, 'home_config'), getPublicHomeConfigController);

// Admin only (auth + ADMIN role are applied where it is mounted). Mounted at /v1/common/admin/home-config.
export const homeConfigAdminRouter = express.Router();
homeConfigAdminRouter.get('/', listHomeItemsController);
homeConfigAdminRouter.post('/', upload.single('image'), createHomeItemController);
homeConfigAdminRouter.put('/:id', upload.single('image'), updateHomeItemController);
homeConfigAdminRouter.delete('/:id', deleteHomeItemController);
