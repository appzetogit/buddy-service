import express from 'express';
import { requireMainAdmin } from './adminAccess.middleware.js';
import * as c from './adminAccess.controller.js';

/** Mounted at /v1/common/admin/access behind authMiddleware + requireRoles('ADMIN'). */
const router = express.Router();

router.get('/me', c.accessMe); // any signed-in admin

router.use(requireMainAdmin); // everything below: main admin only
router.get('/zones', c.zonesList);
router.get('/generate-password', c.generatePasswordHandler);
router.get('/roles', c.rolesList);
router.post('/roles', c.roleCreate);
router.patch('/roles/:id', c.roleUpdate);
router.delete('/roles/:id', c.roleDelete);
router.get('/employees', c.employeesList);
router.post('/employees', c.employeeCreate);
router.patch('/employees/:id', c.employeeUpdate);
router.delete('/employees/:id', c.employeeDelete);
router.post('/employees/:id/resend-credentials', c.employeeResend);

export default router;
