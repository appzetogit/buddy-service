import { sendResponse } from '../../utils/response.js';
import * as svc from './adminAccess.service.js';

const wrap = (fn, status = 200, message = 'OK') => async (req, res, next) => {
    try {
        const data = await fn(req);
        return sendResponse(res, status, message, data);
    } catch (err) {
        return next(err);
    }
};

export const rolesList = wrap(async () => ({ roles: await svc.listRoles() }));
export const roleCreate = wrap(async (req) => ({ role: await svc.createRole(req.body, req.user?.userId) }), 201, 'Role created');
export const roleUpdate = wrap(async (req) => ({ role: await svc.updateRole(req.params.id, req.body) }), 200, 'Role updated');
export const roleDelete = wrap(async (req) => svc.deleteRole(req.params.id), 200, 'Role deleted');

export const employeesList = wrap(async () => ({ employees: await svc.listEmployees() }));
export const employeeCreate = wrap(async (req) => svc.createEmployee(req.body, req.user?.userId), 201, 'Employee created');
export const employeeUpdate = wrap(async (req) => svc.updateEmployee(req.params.id, req.body), 200, 'Employee updated');
export const employeeDelete = wrap(async (req) => svc.deleteEmployee(req.params.id), 200, 'Employee deleted');
export const employeeResend = wrap(async (req) => svc.resendEmployeeCredentials(req.params.id), 200, 'Credentials sent');

export const zonesList = wrap(async () => svc.listAllZones());
export const generatePasswordHandler = wrap(async () => ({ password: svc.generatePassword() }));
/** The signed-in admin's own access (employees: role, pages, zones) - the app refreshes it on load. */
export const accessMe = wrap(async (req) => svc.buildAccessProfile(req.user?.userId));
export const loginRoles = wrap(async () => ({ roles: await svc.listLoginRoles() }));
