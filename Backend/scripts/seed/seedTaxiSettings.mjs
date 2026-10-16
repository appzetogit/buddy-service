/**
 * Fills the Taxi admin "Settings" groups with real data:
 *   Business Settings: General (+ branding)
 *   Website Content:   Landing Page (rewritten for Buddy / Indore) and Enquiries
 * Customization, Transport Ride, Bidding, Tip and Ride Voice already hold complete values.
 *
 *   node scripts/seed/seedTaxiSettings.mjs
 * Idempotent: values are merged / matched by name, so a re-run changes nothing further.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.resolve(HERE, '../../../Frontend/src');
const URLS_FILE = path.join(HERE, '.cache', 'taxi-urls.json');
const urls = fs.existsSync(URLS_FILE) ? JSON.parse(fs.readFileSync(URLS_FILE, 'utf8')) : {};

await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });
const { uploadImageBuffer } = await import('../../src/services/cloudinary.service.js');
const svc = await import('../../src/modules/taxi/admin/services/adminService.js');
const landing = await import('../../src/modules/taxi/admin/services/landingContentService.js');
const { createWebsiteEnquiry } = await import('../../src/modules/taxi/admin/services/websiteEnquiryService.js');
const { WebsiteEnquiry } = await import('../../src/modules/taxi/admin/models/WebsiteEnquiry.js');
const { Vehicle } = await import('../../src/modules/taxi/admin/models/Vehicle.js');

async function upload(rel, folder, root = ASSETS) {
  const key = `${folder}|${rel}`;
  if (urls[key]) return urls[key];
  urls[key] = await uploadImageBuffer(fs.readFileSync(path.join(root, rel)), folder);
  fs.writeFileSync(URLS_FILE, JSON.stringify(urls, null, 1));
  return urls[key];
}
const vehicleImg = (rel) => upload(rel, 'taxi/vehicle-types', path.join(ASSETS, 'modules/taxi/assets'));

// ------------------------------------------------------------------ General (branding, contact, footer)
const logo = await upload('assets/logo.png', 'taxi/branding');
await svc.updateGeneralSettings('general', {
  settings: {
    app_name: 'Buddy',
    contact_phone_1: '9755000101',
    contact_phone_2: '9755000102',
    contact_booking_number: '9755000100',
    footer_1: '2026 © Buddy.',
    footer_2: 'Design & Develop by Buddy',
    default_lat: '22.7196',
    default_lng: '75.8577',
    logo,
    favicon: logo,
  },
});
await svc.updateGeneralSettings('customize', { settings: { landing_theme_color: '#1BD961' } });
console.log('general settings saved');

// ------------------------------------------------------------------ Landing page content
const current = await landing.getLandingContent({ fresh: true, includeLegal: true });
const strip = (o) => JSON.parse(JSON.stringify(o));
const c = strip(current);
delete c._id; delete c.__v; delete c.createdAt; delete c.updatedAt;

const CITIES = 'Indore, Ujjain and Bhopal';
const cabs = {
  auto: await vehicleImg('icons/auto.png'),
  sedan: await vehicleImg('icons/Premium.png'),
  hatch: await vehicleImg('icons/Hatchback.png'),
  suv: await vehicleImg('icons/SUV.png'),
  airport: urls['commons|taxi/user-app|Indore airport terminal'],
};

c.about = {
  ...c.about,
  title: 'Redefining Everyday Mobility Across Madhya Pradesh',
  subtitle: `Built on trust, safety and reliability. Seamless city, outstation and airport rides, now live in ${CITIES}.`,
  stats: [
    { label: 'Successful Rides', count: 100000, suffix: '+' },
    { label: 'Customer Rating', value: '4.8 ★' },
    { label: 'Launch Cities', count: 3 },
    { label: 'Verified Drivers', count: 500, suffix: '+' },
  ],
  founders: [],
};
c.brand = {
  ...c.brand,
  logo,
  wordmarkPrimary: 'BUD',
  wordmarkSecondary: 'DY',
  appBlurb: 'Book rides in seconds, track drivers live and manage your trips with the Buddy app.',
};
c.contact = {
  email: 'support@sooperbuddy.in',
  whatsapp: '919755000100',
  whatsappDisplay: '+91 97550 00100',
  tollFree: '',
  tollFreeLive: false,
  address: 'Office 204, Apollo Premier, Vijay Nagar, Indore, Madhya Pradesh 452010',
  addressShort: 'Apollo Premier, Vijay Nagar, Indore',
  mapsUrl: 'https://www.google.com/maps/search/?api=1&query=Apollo+Premier+Vijay+Nagar+Indore',
};
c.corporatePage = { ...c.corporatePage, benefitsHeading: 'Why 50+ Indore Businesses Choose Buddy' };
c.drivers = [
  { name: 'Ramesh Chouhan', photo: '', rating: 4.9, trips: '3,200+ trips', experience: '8 years experience', vehicle: 'Maruti Suzuki Dzire · MP 09 CA 4821', badge: 'Top Driver', city: 'Indore' },
  { name: 'Suresh Malviya', photo: '', rating: 4.8, trips: '2,100+ trips', experience: '6 years experience', vehicle: 'Toyota Innova Crysta · MP 13 CB 7710', badge: 'Verified', city: 'Ujjain' },
  { name: 'Mahesh Patel', photo: '', rating: 5, trips: '1,450+ trips', experience: '5 years experience', vehicle: 'Maruti Suzuki Ertiga · MP 04 CD 3392', badge: 'Top Driver', city: 'Bhopal' },
  { name: 'Imran Khan', photo: '', rating: 4.9, trips: '2,800+ trips', experience: '10 years experience', vehicle: 'Toyota Fortuner · MP 09 CE 1156', badge: 'Verified', city: 'Indore' },
];
c.footer = {
  ...c.footer,
  description: `Buddy is a cab, parcel and delivery platform with safe, transparent and 24x7 verified rides, now live in ${CITIES}.`,
};
c.launchCities = [
  { name: 'Indore', note: 'Head Office & Launch City' },
  { name: 'Ujjain', note: 'Pilgrimage & Mahakal Darshan Routes' },
  { name: 'Bhopal', note: 'Capital Region Operations' },
];
c.partners = [
  { name: 'Radisson Blu', subtitle: 'HOTEL INDORE' },
  { name: 'Sayaji Hotel', subtitle: 'VIJAY NAGAR' },
  { name: 'Brilliant Convention Centre', subtitle: 'INDORE' },
  { name: 'Treasure Island Mall', subtitle: 'MG ROAD' },
  { name: 'C21 Mall', subtitle: 'VIJAY NAGAR' },
  { name: 'Devi Ahilya Bai Holkar Airport', subtitle: 'INDORE' },
];
c.seo = {
  title: 'Buddy - Cabs, Parcels & Delivery in Indore',
  description: `Buddy offers city, outstation and airport cabs plus parcel delivery with verified drivers and 24x7 support in ${CITIES}.`,
};
c.faqs = [
  ...c.faqs,
  { q: 'Can I book a cab for Ujjain or Omkareshwar darshan?', a: 'Yes. Pick a pilgrimage package from Indore with a fixed fare, driver waiting time during darshan and an SUV or sedan of your choice.' },
  { q: 'Can I send a parcel with Buddy?', a: 'Yes. Choose Parcel in the app, add the pickup and drop address and a delivery partner on a bike collects it within minutes.' },
  { q: 'How do I become a Buddy driver?', a: 'Open the Drive With Us page, submit your details and documents, and our team verifies them and activates your account, usually within 24 hours.' },
];
c.servicesPage = {
  ...c.servicesPage,
  items: c.servicesPage.items.map((item) => {
    const image = {
      auto: cabs.auto, city: cabs.hatch, outstation: cabs.suv, sedan: cabs.sedan, suv: cabs.suv, airport: cabs.airport || item.image,
    }[item.id];
    return image ? { ...item, image } : item;
  }),
};
await landing.updateLandingContent(c);
console.log('landing page content saved');

// ------------------------------------------------------------------ Website enquiries
const DAY = 86400000;
const ENQUIRIES = [
  { type: 'corporate', name: 'Ankit Joshi', phone: '9826010001', email: 'ankit.joshi@infotechindore.in', company: 'InfoTech Solutions Indore', monthlyRides: '300-500', message: 'We need cabs for 150 employees on night shifts with roster-based pickups.', status: 'contacted', days: 9 },
  { type: 'corporate', name: 'Preeti Sharma', phone: '9826010002', email: 'preeti@sharmatravelsmp.com', company: 'Sharma Industries', monthlyRides: '100-300', message: 'Looking for monthly invoicing and GST bills for executive airport transfers.', status: 'new', days: 2 },
  { type: 'partner', name: 'Dilip Rathore', phone: '9826010003', email: '', city: 'Indore', vehicleCategory: 'Sedan', message: 'I own 6 Dzire cabs and want to attach them to Buddy.', status: 'contacted', days: 7 },
  { type: 'partner', name: 'Rizwan Ansari', phone: '9826010004', email: 'rizwan.fleet@gmail.com', city: 'Bhopal', vehicleCategory: 'SUV', message: 'Have 3 Ertigas and 2 Innova Crysta. What is the commission structure?', status: 'new', days: 1 },
  { type: 'driver', name: 'Sandeep Yadav', phone: '9826010005', email: '', city: 'Indore', experience: '6 years', message: 'Own a hatchback, want to start driving with Buddy.', status: 'closed', days: 12 },
  { type: 'driver', name: 'Mohit Solanki', phone: '9826010006', email: '', city: 'Ujjain', experience: '3 years', message: 'Bike taxi driver with a valid licence, need onboarding help.', status: 'new', days: 3 },
  { type: 'advertise', name: 'Neha Agrawal', phone: '9826010007', email: 'neha@palatecafeindore.in', company: 'Palate Cafe', placement: 'Home Screen Banners', message: 'Want to promote our new cafe at Vijay Nagar for two weeks.', status: 'contacted', days: 5 },
  { type: 'advertise', name: 'Karan Mehta', phone: '9826010008', email: 'karan@mehtajewellers.in', company: 'Mehta Jewellers', placement: 'Push Notifications', message: 'Diwali campaign for Indore users, please share the media kit.', status: 'new', days: 1 },
  { type: 'contact', name: 'Divya Patidar', phone: '9826010009', email: 'divya.p@gmail.com', subject: 'Invoice request', message: 'Please send me the invoice for my airport trip on 12 October.', status: 'closed', days: 4 },
  { type: 'contact', name: 'Harsh Vyas', phone: '9826010010', email: 'harsh.vyas@yahoo.com', subject: 'Lost item', message: 'I left a laptop bag in an Auto yesterday evening near Rajwada. Please help me reach the driver.', status: 'contacted', days: 1 },
];
if ((await WebsiteEnquiry.countDocuments()) === 0) {
  for (const { status, days, ...payload } of ENQUIRIES) {
    const { id } = await createWebsiteEnquiry(payload);
    const at = new Date(Date.now() - days * DAY);
    await WebsiteEnquiry.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(id) },
      { $set: { status, createdAt: at, updatedAt: at, notes: status === 'closed' ? 'Resolved by support team.' : status === 'contacted' ? 'Called back, follow-up pending.' : '' } },
    );
  }
  console.log('enquiries created:', ENQUIRIES.length);
}

await mongoose.disconnect();
process.exit(0);
