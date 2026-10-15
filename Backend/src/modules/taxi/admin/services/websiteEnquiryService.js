import { WebsiteEnquiry } from '../models/WebsiteEnquiry.js';
import { ApiError } from '../../../../utils/ApiError.js';

/**
 * Leads from the public marketing forms.
 *
 * Submission is unauthenticated, so everything is treated as hostile: fields are
 * length-capped, the type must be one we know, and only whitelisted extras are
 * kept rather than storing whatever the client posted.
 */

const TYPES = ['corporate', 'partner', 'driver', 'advertise', 'contact'];

// Per-form extras worth keeping. Anything not listed here is dropped.
const DETAIL_FIELDS = {
  corporate: ['company', 'monthlyRides'],
  partner: ['city', 'vehicleCategory'],
  driver: ['city', 'experience'],
  advertise: ['company', 'placement'],
  contact: ['subject'],
};

const clean = (value, max) => String(value ?? '').trim().slice(0, max);
const digits = (value) => String(value ?? '').replace(/\D/g, '');

export const createWebsiteEnquiry = async (payload = {}) => {
  const type = clean(payload.type, 20).toLowerCase();
  if (!TYPES.includes(type)) {
    throw new ApiError(400, 'Unknown enquiry type');
  }

  const name = clean(payload.name, 120);
  if (!name) throw new ApiError(400, 'Name is required');

  const phone = digits(payload.phone).slice(-10);
  const email = clean(payload.email, 160);
  // Every form collects at least one way to reach the person.
  if (phone.length !== 10 && !email) {
    throw new ApiError(400, 'A 10-digit phone number or an email address is required');
  }

  const details = {};
  for (const field of DETAIL_FIELDS[type] || []) {
    const value = clean(payload[field], 200);
    if (value) details[field] = value;
  }

  const enquiry = await WebsiteEnquiry.create({
    type,
    name,
    phone,
    email,
    message: clean(payload.message, 4000),
    details,
  });

  return {
    referenceId: `ENQ_${String(enquiry._id).slice(-8).toUpperCase()}`,
    id: String(enquiry._id),
  };
};

export const listWebsiteEnquiries = async (query = {}) => {
  const filter = {};
  if (TYPES.includes(String(query.type || '').toLowerCase())) {
    filter.type = String(query.type).toLowerCase();
  }
  if (['new', 'contacted', 'closed'].includes(String(query.status || ''))) {
    filter.status = String(query.status);
  }
  const search = clean(query.search, 120);
  if (search) {
    const pattern = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: pattern }, { phone: pattern }, { email: pattern }];
  }

  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 25));

  const [results, total, newCount] = await Promise.all([
    WebsiteEnquiry.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    WebsiteEnquiry.countDocuments(filter),
    WebsiteEnquiry.countDocuments({ status: 'new' }),
  ]);

  return {
    results,
    newCount,
    paginator: {
      total,
      current_page: page,
      per_page: limit,
      last_page: Math.max(1, Math.ceil(total / limit)),
    },
  };
};

export const updateWebsiteEnquiry = async (id, payload = {}) => {
  const update = {};
  if (['new', 'contacted', 'closed'].includes(String(payload.status || ''))) {
    update.status = payload.status;
  }
  if (payload.notes !== undefined) {
    update.notes = clean(payload.notes, 2000);
  }
  if (!Object.keys(update).length) {
    throw new ApiError(400, 'Nothing to update');
  }

  const enquiry = await WebsiteEnquiry.findByIdAndUpdate(id, { $set: update }, { new: true }).lean();
  if (!enquiry) throw new ApiError(404, 'Enquiry not found');
  return enquiry;
};
