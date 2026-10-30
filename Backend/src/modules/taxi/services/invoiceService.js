import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import { Ride } from '../user/models/Ride.js';
import { AdminBusinessSetting } from '../admin/models/AdminBusinessSetting.js';
import { getLandingContent } from '../admin/services/landingContentService.js';
import { sendEmail } from './mailService.js';
import { describeRidePayment, invoiceNumber } from './paymentLedgerService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Trip invoice & payment receipt PDF generator for Buddy Taxi.
 * Features:
 *  - Official Buddy logo embedding
 *  - Clear user fare breakdown (Base fare, distance/time, platform fee, surge, discounts)
 *  - Admin & Captain payment settlement breakdown
 *  - Clean, modern, executive corporate invoice UI
 */

const PAGE_MARGIN = 36;
const PRIMARY = '#059669'; // Buddy brand green
const PRIMARY_DARK = '#064E3B';
const INK = '#0F172A'; // Slate 900
const TEXT_MUTED = '#64748B'; // Slate 500
const BORDER_COLOR = '#E2E8F0'; // Slate 200
const CARD_BG = '#F8FAFC'; // Slate 50
const ACCENT = '#10B981';

const FONT_CANDIDATES = [
  ['C:/Windows/Fonts/arial.ttf', 'C:/Windows/Fonts/arialbd.ttf'],
  ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'],
  ['/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'],
];

const resolveFonts = () => {
  for (const [regular, bold] of FONT_CANDIDATES) {
    try {
      if (fs.existsSync(regular) && fs.existsSync(bold)) {
        return { regular, bold, unicode: true };
      }
    } catch {
      // try next
    }
  }
  return { regular: 'Helvetica', bold: 'Helvetica-Bold', unicode: false };
};

const FONTS = resolveFonts();

const resolveLogoPath = () => {
  const candidates = [
    path.resolve(process.cwd(), 'src/assets/logo.png'),
    path.resolve(process.cwd(), 'Backend/src/assets/logo.png'),
    path.resolve(__dirname, '../../../assets/logo.png'),
    path.resolve(process.cwd(), 'Frontend/src/assets/logo.png'),
    path.resolve(process.cwd(), '../Frontend/src/assets/logo.png'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      // try next
    }
  }
  return null;
};

const money = (amount, symbol = '₹') => {
  const value = Number(amount || 0);
  const formatted = value.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${symbol} ${formatted}`;
};

const formatDate = (date) =>
  new Date(date || Date.now()).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });

const formatTime = (date) =>
  new Date(date || Date.now()).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });

/** The business's own details and currency, from the admin panel. */
const loadCompany = async () => {
  const [settingsDoc, landing] = await Promise.all([
    AdminBusinessSetting.findOne({ scope: 'default' }).select('general customization').lean(),
    getLandingContent().catch(() => null),
  ]);
  const general = settingsDoc?.general || {};
  const customization = settingsDoc?.customization || {};
  const contact = landing?.contact || {};
  const rawSymbol = String(customization.currency_symbol || '₹').trim() || '₹';
  return {
    symbol: FONTS.unicode ? rawSymbol : 'Rs. ',
    company: {
      name: String(general.app_name || 'Buddy').trim(),
      tagline: String(contact.tagline || 'Reliable rides, simple journeys').trim(),
      address: String(contact.address || 'Office 204, Apollo Premier, Vijay Nagar, Indore, Madhya Pradesh 452010').trim(),
      phone: String(contact.whatsappDisplay || general.contact_phone_1 || '+91 97550 00100').trim(),
      email: String(contact.email || 'support@sooperbuddy.in').trim(),
      city: String(contact.city || 'Indore, Madhya Pradesh').trim(),
      website: 'www.sooperbuddy.in',
    },
  };
};

/** Everything the invoice prints, resolved from the ride and the admin panel. */
export const buildInvoiceModel = async ({ rideId }) => {
  const ride = await Ride.findById(rideId)
    .populate('userId', 'name email phone mobile')
    .populate('driverId', 'name phone mobile vehicleNumber vehicleInfo vehicleModel')
    .populate('vehicleTypeId', 'name icon vehicle_name')
    .lean();

  if (!ride) {
    throw new Error(`Ride ${rideId} not found`);
  }

  const [settingsDoc, landing] = await Promise.all([
    AdminBusinessSetting.findOne({ scope: 'default' }).select('general customization').lean(),
    getLandingContent().catch(() => null),
  ]);

  const general = settingsDoc?.general || {};
  const customization = settingsDoc?.customization || {};
  const contact = landing?.contact || {};

  const rawSymbol = String(customization.currency_symbol || '₹').trim() || '₹';
  const currencySymbol = FONTS.unicode ? rawSymbol : 'Rs. ';

  const fare = Number(ride.fare || 0);
  const baseFare = Number(ride.baseFare || 0);
  const platformFee = Number(ride.pricingSnapshot?.rider_platform_fee || 0);
  const waitingCharge = Number(ride.waitingCharge || 0);
  const waitingMinutes = Number(ride.waitingMinutes || 0);
  const airportFee = Number(ride.trip_category?.airport_fee || 0);
  const discountAmount = Number(ride.promo?.discount_amount || 0);
  const tipAmount = Number(ride.feedback?.tipAmount || 0);
  const surgeMultiplier = Number(ride.surge?.multiplier || 1);

  // Calculate distance & duration
  const distanceKm = Number(((ride.route?.distanceMeters || ride.estimatedDistanceMeters || 0) / 1000).toFixed(2));
  const durationMins = Math.round(ride.route?.durationMinutes || ride.estimatedDurationMinutes || 0);

  // Distance/time fare component
  let distanceFare = 0;
  if (fare > baseFare) {
    distanceFare = Math.max(0, fare - baseFare - platformFee - waitingCharge - airportFee + discountAmount);
  } else if (fare > 0 && baseFare === 0) {
    distanceFare = fare;
  }

  // Admin and driver settlements
  const commission = Number(ride.commissionAmount || 0);
  const driverEarnings = Number(ride.driverEarnings || (fare > commission ? fare - commission : Math.round(fare * 0.85)));
  const finalCommission = commission > 0 ? commission : Math.max(0, fare - driverEarnings);

  const vehicleName = ride.vehicleTypeId?.vehicle_name || ride.vehicleTypeId?.name || ride.vehicleIconType || 'Taxi';
  const vehicleNumber = ride.driverId?.vehicleNumber || ride.driverId?.vehicleInfo?.vehicle_number || '-';

  return {
    invoiceDate: formatDate(ride.completedAt || ride.updatedAt),
    invoiceTime: formatTime(ride.completedAt || ride.updatedAt),
    company: {
      name: String(general.app_name || 'Buddy').trim(),
      tagline: String(contact.tagline || 'Reliable rides, simple journeys').trim(),
      address: String(contact.address || 'Office 204, Apollo Premier, Vijay Nagar, Indore, MP 452010').trim(),
      phone: String(contact.whatsappDisplay || general.contact_phone_1 || '+91 97550 00100').trim(),
      email: String(contact.email || 'support@sooperbuddy.in').trim(),
      city: String(contact.city || 'Indore, Madhya Pradesh').trim(),
      website: 'www.sooperbuddy.in',
    },
    trip: {
      serviceType: String(ride.serviceType || 'Daily Ride').toUpperCase(),
      customerName: String(ride.userId?.name || 'Customer').trim(),
      customerPhone: String(ride.userId?.phone || ride.userId?.mobile || '-').trim(),
      customerEmail: String(ride.userId?.email || '').trim(),
      driverName: String(ride.driverId?.name || '-').trim(),
      driverPhone: String(ride.driverId?.phone || ride.driverId?.mobile || '-').trim(),
      vehicleNumber,
      vehicleName,
      pickup: String(ride.pickupAddress || '-').trim(),
      drop: String(ride.dropAddress || '-').trim(),
      distanceKm,
      durationMins,
      paymentMethod: String(ride.paymentMethod || 'cash').trim(),
    },
    payment: (() => {
      const paid = describeRidePayment(ride);
      return { detail: paid.detail, reference: paid.reference, method: paid.method };
    })(),
    invoiceNumber: invoiceNumber('ride', ride._id),
    fare: {
      symbol: currencySymbol,
      baseFare: baseFare > 0 ? baseFare : (fare > 0 ? Math.max(0, fare - distanceFare) : 0),
      distanceFare,
      platformFee,
      waitingCharge,
      waitingMinutes,
      airportFee,
      discountAmount,
      promoCode: ride.promo?.code || '',
      surgeMultiplier,
      tipAmount,
      tripFare: fare,
      total: fare + tipAmount,
    },
    settlement: {
      driverEarnings,
      commission: finalCommission,
    },
  };
};

export const renderInvoicePdf = (model) =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 32, bottom: 20, left: PAGE_MARGIN, right: PAGE_MARGIN },
    });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const left = PAGE_MARGIN;
    const right = pageWidth - PAGE_MARGIN;
    const contentWidth = right - left;

    // 1. Top Brand Stripe
    doc.rect(0, 0, pageWidth, 5).fillColor(PRIMARY).fill();

    // 2. Header: Logo & Branding on Left, Title & Meta on Right
    let y = PAGE_MARGIN + 2;
    const logoPath = resolveLogoPath();
    if (logoPath) {
      try {
        doc.image(logoPath, left, y, { width: 44, height: 44 });
        doc.font(FONTS.bold).fontSize(18).fillColor(INK).text(model.company.name, left + 52, y + 4);
        doc.font(FONTS.regular).fontSize(8.5).fillColor(TEXT_MUTED).text(model.company.tagline, left + 52, y + 26);
      } catch {
        doc.font(FONTS.bold).fontSize(20).fillColor(PRIMARY).text(model.company.name, left, y + 4);
        doc.font(FONTS.regular).fontSize(8.5).fillColor(TEXT_MUTED).text(model.company.tagline, left, y + 26);
      }
    } else {
      doc.font(FONTS.bold).fontSize(20).fillColor(PRIMARY).text(model.company.name, left, y + 4);
      doc.font(FONTS.regular).fontSize(8.5).fillColor(TEXT_MUTED).text(model.company.tagline, left, y + 26);
    }

    // Right Header: Invoice Title & Meta
    doc.font(FONTS.bold).fontSize(16).fillColor(PRIMARY_DARK).text('TAX & TRIP INVOICE', left, y, { width: contentWidth, align: 'right' });
    if (model.invoiceNumber) {
      doc.font(FONTS.bold).fontSize(9.5).fillColor(INK).text(`Invoice No: ${model.invoiceNumber}`, left, y + 20, { width: contentWidth, align: 'right' });
    }
    doc.font(FONTS.regular).fontSize(8.5).fillColor(TEXT_MUTED).text(`Date: ${model.invoiceDate}, ${model.invoiceTime || ''}`, left, y + 33, { width: contentWidth, align: 'right' });

    // Status Badge: PAID
    const badgeW = 46;
    const badgeH = 15;
    const badgeX = right - badgeW;
    const badgeY = y + 46;
    doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 3).fillColor('#DCFCE7').fill();
    doc.font(FONTS.bold).fontSize(8).fillColor('#15803D').text('PAID', badgeX, badgeY + 3.5, { width: badgeW, align: 'center' });

    y += 66;
    doc.moveTo(left, y).lineTo(right, y).lineWidth(1).strokeColor(BORDER_COLOR).stroke();
    y += 10;

    // 3. Company & Customer Info Grid (Two Cards)
    const colW = (contentWidth - 12) / 2;
    const cardH = 68;

    // Company Box
    doc.roundedRect(left, y, colW, cardH, 4).fillColor(CARD_BG).fill();
    doc.roundedRect(left, y, colW, cardH, 4).lineWidth(0.75).strokeColor(BORDER_COLOR).stroke();

    doc.font(FONTS.bold).fontSize(7.5).fillColor(PRIMARY).text('SERVICE PROVIDER (ISSUED BY)', left + 10, y + 8);
    doc.font(FONTS.bold).fontSize(9.5).fillColor(INK).text(model.company.name, left + 10, y + 19);
    doc.font(FONTS.regular).fontSize(8).fillColor(TEXT_MUTED).text(model.company.address, left + 10, y + 31, { width: colW - 20 });
    doc.font(FONTS.regular).fontSize(8).fillColor(TEXT_MUTED).text(`Helpline: ${model.company.phone}  |  ${model.company.email}`, left + 10, y + 51, { width: colW - 20 });

    // Customer Box
    const custX = left + colW + 12;
    doc.roundedRect(custX, y, colW, cardH, 4).fillColor(CARD_BG).fill();
    doc.roundedRect(custX, y, colW, cardH, 4).lineWidth(0.75).strokeColor(BORDER_COLOR).stroke();

    doc.font(FONTS.bold).fontSize(7.5).fillColor(PRIMARY).text('BILLED TO (PASSENGER)', custX + 10, y + 8);
    doc.font(FONTS.bold).fontSize(9.5).fillColor(INK).text(model.trip.customerName, custX + 10, y + 19);
    doc.font(FONTS.regular).fontSize(8).fillColor(TEXT_MUTED).text(`Mobile: ${model.trip.customerPhone || '-'}`, custX + 10, y + 31);
    doc.font(FONTS.regular).fontSize(8).fillColor(TEXT_MUTED).text(`Email: ${model.trip.customerEmail || 'N/A'}`, custX + 10, y + 41);
    doc.font(FONTS.regular).fontSize(8).fillColor(TEXT_MUTED).text(`Service Type: ${model.trip.serviceType}`, custX + 10, y + 51);

    y += cardH + 10;

    // 4. Trip & Vehicle Details Bar
    const statsH = 34;
    doc.roundedRect(left, y, contentWidth, statsH, 4).fillColor('#F1F5F9').fill();
    doc.roundedRect(left, y, contentWidth, statsH, 4).lineWidth(0.75).strokeColor(BORDER_COLOR).stroke();

    const quadW = contentWidth / 4;
    const drawStat = (idx, label, val) => {
      const sx = left + idx * quadW;
      doc.font(FONTS.bold).fontSize(7).fillColor(TEXT_MUTED).text(label.toUpperCase(), sx + 10, y + 6);
      doc.font(FONTS.bold).fontSize(9).fillColor(INK).text(val, sx + 10, y + 18, { width: quadW - 14, ellipsis: true });
    };
    drawStat(0, 'Captain (Driver)', model.trip.driverName);
    drawStat(1, 'Vehicle Number', model.trip.vehicleNumber);
    drawStat(2, 'Distance Covered', model.trip.distanceKm > 0 ? `${model.trip.distanceKm} km` : '-');
    drawStat(3, 'Ride Duration', model.trip.durationMins > 0 ? `${model.trip.durationMins} mins` : '-');

    y += statsH + 10;

    // 5. Journey Route Box
    const routeH = 54;
    doc.roundedRect(left, y, contentWidth, routeH, 4).fillColor(CARD_BG).fill();
    doc.roundedRect(left, y, contentWidth, routeH, 4).lineWidth(0.75).strokeColor(BORDER_COLOR).stroke();

    // Pickup
    doc.circle(left + 14, y + 16, 4).fillColor(ACCENT).fill();
    doc.font(FONTS.bold).fontSize(7.5).fillColor(PRIMARY).text('PICKUP', left + 24, y + 11);
    doc.font(FONTS.regular).fontSize(8.5).fillColor(INK).text(model.trip.pickup, left + 62, y + 11, { width: contentWidth - 76, ellipsis: true });

    // Connecting line
    doc.moveTo(left + 14, y + 22).lineTo(left + 14, y + 34).lineWidth(1).strokeColor(BORDER_COLOR).stroke();

    // Drop
    doc.circle(left + 14, y + 40, 4).fillColor('#EF4444').fill();
    doc.font(FONTS.bold).fontSize(7.5).fillColor('#DC2626').text('DROP', left + 24, y + 35);
    doc.font(FONTS.regular).fontSize(8.5).fillColor(INK).text(model.trip.drop, left + 62, y + 35, { width: contentWidth - 76, ellipsis: true });

    y += routeH + 12;

    // 6. Fare Breakdown Table
    doc.font(FONTS.bold).fontSize(10).fillColor(PRIMARY_DARK).text('FARE BREAKDOWN & PAYMENT SUMMARY', left, y);
    y += 14;

    // Table Header
    const thH = 20;
    doc.rect(left, y, contentWidth, thH).fillColor('#0F172A').fill();
    doc.font(FONTS.bold).fontSize(8).fillColor('#FFFFFF');
    doc.text('ITEM DESCRIPTION', left + 10, y + 6);
    doc.text('DETAILS / METRICS', left + 220, y + 6);
    doc.text('AMOUNT', right - 90, y + 6, { width: 80, align: 'right' });
    y += thH;

    // Table Rows
    const rows = [
      {
        item: 'Base Ride Fare',
        desc: 'Standard base booking fare',
        amount: model.fare.baseFare > 0 ? model.fare.baseFare : model.fare.tripFare,
      },
    ];

    if (model.fare.distanceFare > 0) {
      rows.push({
        item: 'Distance & Travel Charges',
        desc: model.trip.distanceKm > 0 ? `${model.trip.distanceKm} km route charges` : 'Calculated trip distance fare',
        amount: model.fare.distanceFare,
      });
    }

    if (model.fare.platformFee > 0) {
      rows.push({
        item: 'Rider Platform & Safety Fee',
        desc: 'Technology infrastructure fee',
        amount: model.fare.platformFee,
      });
    }

    if (model.fare.waitingCharge > 0) {
      rows.push({
        item: 'Waiting Charges',
        desc: `${model.fare.waitingMinutes || 0} mins waiting`,
        amount: model.fare.waitingCharge,
      });
    }

    if (model.fare.surgeMultiplier > 1) {
      rows.push({
        item: 'Peak / Surge Factor',
        desc: `${model.fare.surgeMultiplier}x high demand multiplier`,
        amount: 0,
        isCustom: true,
        customText: `${model.fare.surgeMultiplier}x Applied`,
      });
    }

    if (model.fare.airportFee > 0) {
      rows.push({
        item: 'Airport / Toll Parking Fee',
        desc: 'Applicable gate/airport charges',
        amount: model.fare.airportFee,
      });
    }

    if (model.fare.discountAmount > 0) {
      rows.push({
        item: 'Promo / Coupon Discount',
        desc: model.fare.promoCode ? `Coupon: ${model.fare.promoCode}` : 'Promotional savings',
        amount: -model.fare.discountAmount,
        isDiscount: true,
      });
    }

    if (model.fare.tipAmount > 0) {
      rows.push({
        item: 'Captain Tip',
        desc: 'Direct gratuity for captain',
        amount: model.fare.tipAmount,
      });
    }

    rows.forEach((r, idx) => {
      const rowH = 19;
      if (idx % 2 === 1) {
        doc.rect(left, y, contentWidth, rowH).fillColor('#F8FAFC').fill();
      }
      doc.font(FONTS.regular).fontSize(8.5).fillColor(INK).text(r.item, left + 10, y + 4.5);
      doc.font(FONTS.regular).fontSize(8).fillColor(TEXT_MUTED).text(r.desc, left + 220, y + 5);

      if (r.isCustom) {
        doc.font(FONTS.bold).fontSize(8.5).fillColor('#D97706').text(r.customText, right - 90, y + 4.5, { width: 80, align: 'right' });
      } else if (r.isDiscount) {
        doc.font(FONTS.bold).fontSize(8.5).fillColor('#15803D').text(`-${money(Math.abs(r.amount), model.fare.symbol)}`, right - 90, y + 4.5, { width: 80, align: 'right' });
      } else {
        doc.font(FONTS.bold).fontSize(8.5).fillColor(INK).text(money(r.amount, model.fare.symbol), right - 90, y + 4.5, { width: 80, align: 'right' });
      }

      doc.moveTo(left, y + rowH).lineTo(right, y + rowH).lineWidth(0.5).strokeColor(BORDER_COLOR).stroke();
      y += rowH;
    });

    // Total Amount Paid Banner
    y += 3;
    const totalBannerH = 30;
    doc.rect(left, y, contentWidth, totalBannerH).fillColor(PRIMARY).fill();
    doc.font(FONTS.bold).fontSize(9.5).fillColor('#FFFFFF').text('TOTAL AMOUNT PAID', left + 12, y + 9.5);
    doc.font(FONTS.bold).fontSize(13.5).fillColor('#FFFFFF').text(money(model.fare.total, model.fare.symbol), right - 130, y + 7.5, { width: 120, align: 'right' });
    y += totalBannerH + 10;

    // 7. Payment & Admin Settlement Breakdown
    const splitH = 46;
    doc.roundedRect(left, y, contentWidth, splitH, 4).fillColor(CARD_BG).fill();
    doc.roundedRect(left, y, contentWidth, splitH, 4).lineWidth(0.75).strokeColor(BORDER_COLOR).stroke();

    const thirdW = contentWidth / 3;

    // Col 1: Payment Details
    doc.font(FONTS.bold).fontSize(7.5).fillColor(PRIMARY).text('PAYMENT METHOD', left + 10, y + 7);
    doc.font(FONTS.bold).fontSize(9).fillColor(INK).text(model.payment?.detail || 'Cash Payment', left + 10, y + 18, { width: thirdW - 14, ellipsis: true });
    doc.font(FONTS.regular).fontSize(7.5).fillColor(TEXT_MUTED).text(`Status: Verified & Completed`, left + 10, y + 30);

    // Col 2: Driver Share
    const col2X = left + thirdW;
    doc.font(FONTS.bold).fontSize(7.5).fillColor(TEXT_MUTED).text("CAPTAIN'S SHARE (NET EARNINGS)", col2X + 10, y + 7);
    doc.font(FONTS.bold).fontSize(10).fillColor('#15803D').text(money(model.settlement?.driverEarnings || 0, model.fare.symbol), col2X + 10, y + 18);
    doc.font(FONTS.regular).fontSize(7.5).fillColor(TEXT_MUTED).text('Credited to Captain Wallet', col2X + 10, y + 30);

    // Col 3: Admin Commission
    const col3X = left + thirdW * 2;
    doc.font(FONTS.bold).fontSize(7.5).fillColor(TEXT_MUTED).text('PLATFORM / ADMIN COMMISSION', col3X + 10, y + 7);
    doc.font(FONTS.bold).fontSize(10).fillColor(PRIMARY_DARK).text(money(model.settlement?.commission || 0, model.fare.symbol), col3X + 10, y + 18);
    doc.font(FONTS.regular).fontSize(7.5).fillColor(TEXT_MUTED).text('Company Revenue Share', col3X + 10, y + 30);

    y += splitH + 12;

    // 8. Notice & Footer
    doc.font(FONTS.bold).fontSize(8.5).fillColor(INK).text(`Thank you for riding with ${model.company.name}!`, left, y, { width: contentWidth, align: 'center' });
    doc.font(FONTS.regular).fontSize(7.5).fillColor(TEXT_MUTED).text('This is a computer-generated tax invoice and requires no physical signature.', left, y + 12, { width: contentWidth, align: 'center' });

    // Bottom Bar - disable bottom margin check so footer fits cleanly on single page
    doc.page.margins.bottom = 0;
    const botY = pageHeight - 34;
    doc.moveTo(left, botY).lineTo(right, botY).lineWidth(0.75).strokeColor(BORDER_COLOR).stroke();
    doc.font(FONTS.bold).fontSize(8).fillColor(PRIMARY).text(`${model.company.name} • Safe & Simple Mobility`, left, botY + 6, { lineBreak: false });
    doc.font(FONTS.regular).fontSize(7.5).fillColor(TEXT_MUTED).text(`${model.company.email}  |  ${model.company.website}  |  ${model.company.city}`, left, botY + 6, { width: contentWidth, align: 'right', lineBreak: false });

    doc.end();
  });

export const buildRideInvoicePdf = async ({ rideId }) => {
  const model = await buildInvoiceModel({ rideId });
  const buffer = await renderInvoicePdf(model);
  const stamp = model.invoiceDate.replace(/\s+/g, '_');
  const slug = model.company.name.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'Invoice';

  return { buffer, model, filename: `${slug}_Trip_Invoice_${stamp}.pdf` };
};

/**
 * Emails the invoice to the rider.
 */
export const sendRideInvoiceEmail = async ({ rideId }) => {
  try {
    const { buffer, model, filename } = await buildRideInvoicePdf({ rideId });
    const to = model.trip.customerEmail;

    if (!to) {
      return { sent: false, reason: 'no-customer-email' };
    }

    const total = money(model.fare.total, model.fare.symbol);
    const result = await sendEmail({
      to,
      subject: `Your ${model.company.name} trip invoice — ${model.invoiceDate}`,
      text: [
        `Hi ${model.trip.customerName},`,
        '',
        `Thank you for riding with ${model.company.name}.`,
        `Your invoice for ${model.invoiceDate} is attached.`,
        '',
        `Pickup: ${model.trip.pickup}`,
        `Drop:   ${model.trip.drop}`,
        `Total:  ${total}`,
        '',
        'We appreciate your business and wish you a safe journey.',
        model.company.name,
      ].join('\n'),
      html: `
        <div style="font-family:Arial,Helvetica,sans-serif;color:#0F172A;line-height:1.6">
          <p>Hi ${model.trip.customerName},</p>
          <p>Thank you for riding with <strong>${model.company.name}</strong>.
             Your invoice for ${model.invoiceDate} is attached as a PDF.</p>
          <table style="border-collapse:collapse;margin:16px 0">
            <tr><td style="padding:4px 16px 4px 0;color:#64748B">Pickup</td><td>${model.trip.pickup}</td></tr>
            <tr><td style="padding:4px 16px 4px 0;color:#64748B">Drop</td><td>${model.trip.drop}</td></tr>
            <tr><td style="padding:4px 16px 4px 0;color:#64748B">Total</td><td><strong>${total}</strong></td></tr>
          </table>
          <p style="color:#64748B">We appreciate your business and wish you a safe journey.</p>
          <p><strong>${model.company.name}</strong></p>
        </div>`,
      attachments: [{ filename, content: buffer, contentType: 'application/pdf' }],
    });

    if (result?.skipped) {
      return { sent: false, reason: result.reason };
    }

    return { sent: true, to, filename };
  } catch (error) {
    console.error('[invoice] failed to send ride invoice:', error.message);
    return { sent: false, reason: 'error', message: error.message };
  }
};

/**
 * Receipt for a ledger payment (wallet top-up, driver payout, etc.)
 */
export const renderPaymentReceiptPdf = (payment, { company, symbol }) =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 32, bottom: 20, left: PAGE_MARGIN, right: PAGE_MARGIN },
    });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const left = PAGE_MARGIN;
    const right = pageWidth - PAGE_MARGIN;
    const contentWidth = right - left;

    // Top Stripe
    doc.rect(0, 0, pageWidth, 5).fillColor(PRIMARY).fill();

    let y = PAGE_MARGIN + 2;
    const logoPath = resolveLogoPath();
    if (logoPath) {
      try {
        doc.image(logoPath, left, y, { width: 44, height: 44 });
        doc.font(FONTS.bold).fontSize(18).fillColor(INK).text(company.name, left + 52, y + 4);
        doc.font(FONTS.regular).fontSize(8.5).fillColor(TEXT_MUTED).text(company.tagline, left + 52, y + 26);
      } catch {
        doc.font(FONTS.bold).fontSize(20).fillColor(PRIMARY).text(company.name, left, y + 4);
        doc.font(FONTS.regular).fontSize(8.5).fillColor(TEXT_MUTED).text(company.tagline, left, y + 26);
      }
    } else {
      doc.font(FONTS.bold).fontSize(20).fillColor(PRIMARY).text(company.name, left, y + 4);
      doc.font(FONTS.regular).fontSize(8.5).fillColor(TEXT_MUTED).text(company.tagline, left, y + 26);
    }

    doc.font(FONTS.bold).fontSize(16).fillColor(PRIMARY_DARK).text('PAYMENT RECEIPT', left, y, { width: contentWidth, align: 'right' });
    doc.font(FONTS.bold).fontSize(9.5).fillColor(INK).text(`Receipt No: ${payment.invoice_number}`, left, y + 20, { width: contentWidth, align: 'right' });
    doc.font(FONTS.regular).fontSize(8.5).fillColor(TEXT_MUTED).text(`Date: ${formatDate(payment.date)}`, left, y + 33, { width: contentWidth, align: 'right' });

    // Status Badge
    const badgeW = 46;
    const badgeH = 15;
    const badgeX = right - badgeW;
    const badgeY = y + 46;
    doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 3).fillColor('#DCFCE7').fill();
    doc.font(FONTS.bold).fontSize(8).fillColor('#15803D').text('PAID', badgeX, badgeY + 3.5, { width: badgeW, align: 'center' });

    y += 66;
    doc.moveTo(left, y).lineTo(right, y).lineWidth(1).strokeColor(BORDER_COLOR).stroke();
    y += 12;

    const colW = (contentWidth - 12) / 2;
    const cardH = 68;

    // Company Box
    doc.roundedRect(left, y, colW, cardH, 4).fillColor(CARD_BG).fill();
    doc.roundedRect(left, y, colW, cardH, 4).lineWidth(0.75).strokeColor(BORDER_COLOR).stroke();
    doc.font(FONTS.bold).fontSize(7.5).fillColor(PRIMARY).text('SERVICE PROVIDER (ISSUED BY)', left + 10, y + 8);
    doc.font(FONTS.bold).fontSize(9.5).fillColor(INK).text(company.name, left + 10, y + 19);
    doc.font(FONTS.regular).fontSize(8).fillColor(TEXT_MUTED).text(company.address, left + 10, y + 31, { width: colW - 20 });
    doc.font(FONTS.regular).fontSize(8).fillColor(TEXT_MUTED).text(`Helpline: ${company.phone}  |  ${company.email}`, left + 10, y + 51, { width: colW - 20 });

    // Received From Box
    const custX = left + colW + 12;
    doc.roundedRect(custX, y, colW, cardH, 4).fillColor(CARD_BG).fill();
    doc.roundedRect(custX, y, colW, cardH, 4).lineWidth(0.75).strokeColor(BORDER_COLOR).stroke();
    doc.font(FONTS.bold).fontSize(7.5).fillColor(PRIMARY).text('RECEIVED FROM', custX + 10, y + 8);
    doc.font(FONTS.bold).fontSize(9.5).fillColor(INK).text(payment.payer?.name || 'Account Holder', custX + 10, y + 19);
    doc.font(FONTS.regular).fontSize(8).fillColor(TEXT_MUTED).text(`Role: ${payment.payer?.role === 'driver' ? 'Captain (Driver)' : 'Passenger (Rider)'}`, custX + 10, y + 31);
    doc.font(FONTS.regular).fontSize(8).fillColor(TEXT_MUTED).text(`Phone: ${payment.payer?.phone || '-'}`, custX + 10, y + 41);

    y += cardH + 16;

    // Payment Item Table
    doc.font(FONTS.bold).fontSize(10).fillColor(PRIMARY_DARK).text('TRANSACTION SUMMARY', left, y);
    y += 14;

    const thH = 20;
    doc.rect(left, y, contentWidth, thH).fillColor('#0F172A').fill();
    doc.font(FONTS.bold).fontSize(8).fillColor('#FFFFFF');
    doc.text('ITEM DESCRIPTION', left + 10, y + 6);
    doc.text('METHOD / TYPE', left + 220, y + 6);
    doc.text('AMOUNT', right - 90, y + 6, { width: 80, align: 'right' });
    y += thH;

    const rowH = 24;
    doc.rect(left, y, contentWidth, rowH).fillColor('#F8FAFC').fill();
    doc.font(FONTS.bold).fontSize(9).fillColor(INK).text(`${payment.kind_label || 'Payment'}`, left + 10, y + 6);
    doc.font(FONTS.regular).fontSize(8).fillColor(TEXT_MUTED).text(payment.description || '-', left + 220, y + 7, { width: 140, ellipsis: true });
    doc.font(FONTS.bold).fontSize(9).fillColor(INK).text(money(payment.amount, symbol), right - 90, y + 6, { width: 80, align: 'right' });
    doc.moveTo(left, y + rowH).lineTo(right, y + rowH).lineWidth(0.5).strokeColor(BORDER_COLOR).stroke();
    y += rowH + 6;

    // Total Banner
    const totalBannerH = 30;
    doc.rect(left, y, contentWidth, totalBannerH).fillColor(PRIMARY).fill();
    doc.font(FONTS.bold).fontSize(9.5).fillColor('#FFFFFF').text('TOTAL AMOUNT RECEIVED', left + 12, y + 9.5);
    doc.font(FONTS.bold).fontSize(13.5).fillColor('#FFFFFF').text(money(payment.amount, symbol), right - 130, y + 7.5, { width: 120, align: 'right' });
    y += totalBannerH + 14;

    // Payment details box
    const detailH = 38;
    doc.roundedRect(left, y, contentWidth, detailH, 4).fillColor(CARD_BG).fill();
    doc.roundedRect(left, y, contentWidth, detailH, 4).lineWidth(0.75).strokeColor(BORDER_COLOR).stroke();
    doc.font(FONTS.bold).fontSize(7.5).fillColor(PRIMARY).text('PAYMENT CHANNEL', left + 10, y + 6);
    doc.font(FONTS.regular).fontSize(8.5).fillColor(INK).text(`${payment.method_label || 'Online'} · ${payment.detail || 'Completed'}${payment.reference ? ` · Ref: ${payment.reference}` : ''}`, left + 10, y + 18, { width: contentWidth - 20, ellipsis: true });

    y += detailH + 18;

    doc.font(FONTS.bold).fontSize(8.5).fillColor(INK).text(`Thank you for choosing ${company.name}!`, left, y, { width: contentWidth, align: 'center' });
    doc.font(FONTS.regular).fontSize(7.5).fillColor(TEXT_MUTED).text('This is a computer-generated receipt and requires no physical signature.', left, y + 12, { width: contentWidth, align: 'center' });

    // Bottom Bar - disable bottom margin check so footer fits cleanly on single page
    doc.page.margins.bottom = 0;
    const botY = pageHeight - 34;
    doc.moveTo(left, botY).lineTo(right, botY).lineWidth(0.75).strokeColor(BORDER_COLOR).stroke();
    doc.font(FONTS.bold).fontSize(8).fillColor(PRIMARY).text(`${company.name} • Safe & Simple Mobility`, left, botY + 6, { lineBreak: false });
    doc.font(FONTS.regular).fontSize(7.5).fillColor(TEXT_MUTED).text(`${company.email}  |  ${company.website || 'www.sooperbuddy.in'}  |  ${company.city}`, left, botY + 6, { width: contentWidth, align: 'right', lineBreak: false });

    doc.end();
  });

/// Invoice PDF for any row of the payments ledger: the trip invoice for a ride,
/// a receipt for everything else.
export const buildPaymentInvoicePdf = async (payment) => {
  if (payment.kind === 'ride') {
    const { buffer, filename } = await buildRideInvoicePdf({ rideId: payment.record_id });
    return { buffer, filename: filename.replace('.pdf', `_${payment.invoice_number}.pdf`) };
  }
  const company = await loadCompany();
  const buffer = await renderPaymentReceiptPdf(payment, company);
  const slug = company.company.name.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'Receipt';
  return { buffer, filename: `${slug}_Receipt_${payment.invoice_number}.pdf` };
};
