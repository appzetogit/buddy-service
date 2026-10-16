/**
 * Rooms a connected taxi participant joins, so the admin dashboard can count who is online
 * (e.g. connected riders) without caring which feature they are using.
 */
export const getPresenceRoleRoom = (role) => `presence:role:${role}`;

export const getPresenceParticipantRoom = (role, entityId) => `presence:participant:${role}:${entityId}`;
