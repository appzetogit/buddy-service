import mongoose from 'mongoose';

/**
 * Leads submitted from the public marketing site.
 *
 * The corporate, partner, driver, advertise and contact forms previously called
 * setSubmitted(true) and nothing else — every submission was discarded, and the
 * contact form told the sender a confirmation email had been sent. This is where
 * they land now.
 *
 * `details` is Mixed because each form asks for different things (monthly ride
 * volume, vehicle category, driving experience, preferred ad placement…) and the
 * set will keep changing; the fields every form shares are columns so they can
 * be listed, searched and indexed.
 */
const websiteEnquirySchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      enum: ['corporate', 'partner', 'driver', 'advertise', 'contact'],
      index: true,
    },
    name: { type: String, default: '', trim: true },
    phone: { type: String, default: '', trim: true, index: true },
    email: { type: String, default: '', trim: true },
    message: { type: String, default: '', trim: true },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      default: 'new',
      enum: ['new', 'contacted', 'closed'],
      index: true,
    },
    notes: { type: String, default: '', trim: true },
  },
  { timestamps: true },
);

// The admin list is "newest first, optionally filtered by type and status".
websiteEnquirySchema.index({ status: 1, createdAt: -1 });
websiteEnquirySchema.index({ type: 1, createdAt: -1 });

export const WebsiteEnquiry =
  mongoose.models.TaxiWebsiteEnquiry || mongoose.model('TaxiWebsiteEnquiry', websiteEnquirySchema);
