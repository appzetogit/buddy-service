import mongoose from 'mongoose';

/**
 * Editable content for the public marketing site.
 *
 * One document, same shape as the other admin settings models: a unique `scope`
 * plus Mixed sections, so sections can gain fields without a migration.
 *
 * The fleet section is deliberately absent — vehicles come from the existing
 * admin vehicle catalog (`/users/vehicle-types`) so there is one place to manage
 * them rather than two that can disagree.
 */
const landingContentSchema = new mongoose.Schema(
  {
    scope: {
      type: String,
      required: true,
      unique: true,
      default: 'default',
    },
    // [{ id, title, desc, icon }] — icon is a lucide name resolved by the client
    services: { type: [mongoose.Schema.Types.Mixed], default: [] },
    // [{ title, desc, icon }]
    valueProps: { type: [mongoose.Schema.Types.Mixed], default: [] },
    // [{ name, photo, rating, trips, experience, vehicle, badge, city }]
    drivers: { type: [mongoose.Schema.Types.Mixed], default: [] },
    // [{ name, subtitle }]
    partners: { type: [mongoose.Schema.Types.Mixed], default: [] },
    // [{ name, note }]
    launchCities: { type: [mongoose.Schema.Types.Mixed], default: [] },
    // { email, whatsapp, whatsappDisplay, tollFree, tollFreeLive, address, addressShort, mapsUrl }
    contact: { type: mongoose.Schema.Types.Mixed, default: {} },
    // { tag, title, subtitle, stats[], founders[], pillars[], headings }
    about: { type: mongoose.Schema.Types.Mixed, default: {} },
    // the four remaining marketing pages
    corporatePage: { type: mongoose.Schema.Types.Mixed, default: {} },
    partnerPage: { type: mongoose.Schema.Types.Mixed, default: {} },
    driverPage: { type: mongoose.Schema.Types.Mixed, default: {} },
    advertisePage: { type: mongoose.Schema.Types.Mixed, default: {} },
    // { tag, title, subtitle, ctaLabel, items[] } - the /services page
    servicesPage: { type: mongoose.Schema.Types.Mixed, default: {} },
    // [{ q, a }] - contact page accordion
    faqs: { type: [mongoose.Schema.Types.Mixed], default: [] },
    // { titleLine1, titleLine2, subtitle, primaryCta, secondaryCta, badges[] }
    hero: { type: mongoose.Schema.Types.Mixed, default: {} },
    // { description, servicesHeading, cabServices[], trustPills[], copyright }
    footer: { type: mongoose.Schema.Types.Mixed, default: {} },
    // { title, description } - applied to document.title at runtime
    seo: { type: mongoose.Schema.Types.Mixed, default: {} },
    // { logo, wordmarkPrimary, wordmarkSecondary, tagline, appBlurb,
    //   playStoreUrl, appStoreUrl, playStoreQr, appStoreQr }
    brand: { type: mongoose.Schema.Types.Mixed, default: {} },
    // { terms: { intro, body }, privacy: {...}, refund: {...} }
    //
    // Served by its own endpoint rather than with the rest of the content: the
    // documents run to six figures of characters and the landing payload is
    // fetched on every visit to the marketing site.
    legal: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    minimize: false,
  },
);

export const LandingContent =
  mongoose.models.TaxiLandingContent || mongoose.model('TaxiLandingContent', landingContentSchema);
