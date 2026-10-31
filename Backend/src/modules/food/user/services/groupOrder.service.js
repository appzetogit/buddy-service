import crypto from 'crypto';
import mongoose from 'mongoose';
import { FoodGroupOrder } from '../models/foodGroupOrder.model.js';
import { FoodUser } from '../../../../core/users/user.model.js';
import { FoodOrder } from '../../orders/models/order.model.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../../core/auth/errors.js';

export const MAX_MEMBERS = 50;
const MAX_ITEMS_PER_MEMBER = 50;
const MAX_ITEMS_BYTES = 64 * 1024;

// No 0/O/1/I so a code read out loud is not misheard.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from(crypto.randomBytes(6), (b) => ALPHABET[b % ALPHABET.length]).join('');

const nameOf = async (userId) => {
  const u = await FoodUser.findById(userId).select('name').lean();
  return String(u?.name || '').trim() || 'Friend';
};

const load = async (code) => {
  const group = await FoodGroupOrder.findOne({ code: String(code || '').trim().toUpperCase() });
  if (!group) throw new NotFoundError('This group order has ended or the link is wrong');
  return group;
};

const isMember = (group, userId) => group.members.some((m) => String(m.userId) === String(userId));

const toResponse = async (group, userId) => {
  let orderStatus = '';
  if (group.orderId && mongoose.Types.ObjectId.isValid(group.orderId)) {
    const order = await FoodOrder.findById(group.orderId).select('orderStatus').lean();
    orderStatus = order?.orderStatus || '';
  }
  return {
    code: group.code,
    restaurantId: group.restaurantId,
    restaurantName: group.restaurantName,
    hostId: String(group.hostId),
    isHost: String(group.hostId) === String(userId),
    status: group.status,
    orderId: group.orderId,
    orderStatus,
    members: group.members.map((m) => ({
      userId: String(m.userId),
      name: m.name,
      isHost: String(m.userId) === String(group.hostId),
      items: m.items,
      updatedAt: m.updatedAt,
    })),
  };
};

export const createGroupOrder = async (userId, { restaurantId, restaurantName }) => {
  const rid = String(restaurantId || '').trim();
  if (!rid) throw new ValidationError('restaurantId is required');
  const name = await nameOf(userId);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const group = await FoodGroupOrder.create({
        code: newCode(),
        restaurantId: rid,
        restaurantName: String(restaurantName || '').trim(),
        hostId: userId,
        members: [{ userId, name }],
      });
      return toResponse(group, userId);
    } catch (err) {
      if (err?.code !== 11000) throw err; // code collision: try another
    }
  }
  throw new Error('Could not create a group order, please try again');
};

export const getGroupOrder = async (userId, code) => {
  const group = await load(code);
  if (!isMember(group, userId)) throw new ForbiddenError('Join this group order first');
  return toResponse(group, userId);
};

export const joinGroupOrder = async (userId, code) => {
  const group = await load(code);
  if (!isMember(group, userId)) {
    if (group.status !== 'open') throw new ValidationError('This group order is no longer taking items');
    if (group.members.length >= MAX_MEMBERS) throw new ValidationError(`A group order can have up to ${MAX_MEMBERS} people`);
    group.members.push({ userId, name: await nameOf(userId) });
    await group.save();
  }
  return toResponse(group, userId);
};

/** Replaces the caller's own lines; nobody can touch anyone else's. */
export const setMyGroupItems = async (userId, code, items) => {
  if (!Array.isArray(items)) throw new ValidationError('items must be a list');
  if (items.length > MAX_ITEMS_PER_MEMBER) throw new ValidationError('Too many items');
  if (Buffer.byteLength(JSON.stringify(items)) > MAX_ITEMS_BYTES) throw new ValidationError('Items are too large');
  const group = await load(code);
  if (group.status !== 'open') throw new ValidationError('The host has already placed this order');
  const member = group.members.find((m) => String(m.userId) === String(userId));
  if (!member) throw new ForbiddenError('Join this group order first');
  member.items = items.filter((i) => i && typeof i === 'object');
  member.updatedAt = new Date();
  group.markModified('members');
  await group.save();
  return toResponse(group, userId);
};

/** Host only: links the real order so every member can follow it. */
export const markGroupOrderPlaced = async (userId, code, orderId) => {
  const id = String(orderId || '').trim();
  if (!mongoose.Types.ObjectId.isValid(id)) throw new ValidationError('A valid orderId is required');
  const group = await load(code);
  if (String(group.hostId) !== String(userId)) throw new ForbiddenError('Only the host can place the group order');
  const order = await FoodOrder.findOne({ _id: id, userId }).select('_id').lean();
  if (!order) throw new ValidationError('That order does not belong to you');
  group.status = 'placed';
  group.orderId = id;
  await group.save();
  return toResponse(group, userId);
};

/** Host ends the group for everyone; anyone else just leaves it. */
export const leaveGroupOrder = async (userId, code) => {
  const group = await load(code);
  if (String(group.hostId) === String(userId)) {
    group.status = 'closed';
  } else {
    group.members = group.members.filter((m) => String(m.userId) !== String(userId));
  }
  await group.save();
  return { code: group.code, status: group.status };
};
