import PDFDocument from 'pdfkit';
import { FoodUser } from '../../../core/users/user.model.js';
import { Seller } from '../seller/models/seller.model.js';
import {
  FONTS,
  formatDate,
  formatTime,
  loadCompany,
  money,
  resolveLogoPath,
} from '../../taxi/services/invoiceService.js';

const PRIMARY_DARK = '#064E3B';
const INK = '#0F172A';
const MUTED = '#64748B';
const BORDER = '#E2E8F0';

const PAY_LABEL = {
  razorpay: 'Online (UPI / Card)',
  wallet: 'Sooper Buddy Wallet',
  cash: 'Cash on delivery',
};

/** How the order was paid, as the customer would say it. */
export const quickPaymentLabel = (payment = {}) => {
  const wallet = Number(payment.walletAmount || 0);
  const online = Number(payment.onlineAmount || 0);
  if (wallet > 0 && online > 0) return 'Wallet + Online (UPI / Card)';
  return PAY_LABEL[payment.method] || String(payment.method || '');
};

/** A one-page invoice for a QC order, built only from the stored order. */
export const buildQuickInvoicePdf = async (order) => {
  const sellerId = order.items?.find((i) => i?.type === 'quick')?.sourceId || order.items?.[0]?.sourceId;
  const [{ company, symbol }, customer, seller] = await Promise.all([
    loadCompany(),
    order.userId ? FoodUser.findById(order.userId).select('name phone').lean() : null,
    sellerId ? Seller.findById(sellerId).select('shopName name').lean().catch(() => null) : null,
  ]);
  return renderQuickInvoicePdf(order, { company, symbol, customer, seller });
};

/** Draws the invoice from data already loaded (no database here). */
export const renderQuickInvoicePdf = (order, { company, symbol, customer, seller }) => {
  const p = order.pricing || {};
  const addr = order.deliveryAddress || {};
  const rows = [
    ['Item total', p.subtotal],
    ['Delivery fee', p.deliveryFee],
    ['Platform fee', p.platformFee],
    ['Handling fee', p.handlingFee],
    ['Packaging fee', p.packagingFee],
    ['Taxes', p.tax],
  ].filter(([, v]) => Number(v) > 0);
  const discount = Number(p.discount || 0);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.registerFont('r', FONTS.regular);
    doc.registerFont('b', FONTS.bold);

    const left = 40;
    const width = doc.page.width - 80;
    let y = 40;

    const logo = resolveLogoPath();
    if (logo) {
      try {
        doc.image(logo, left, y, { height: 34 });
      } catch {
        // no logo is fine
      }
    }
    doc.font('b').fontSize(16).fillColor(PRIMARY_DARK).text('INVOICE', left, y, { width, align: 'right' });
    doc.font('r').fontSize(9).fillColor(MUTED)
      .text(`Invoice No: INV-${order.orderId}`, left, y + 20, { width, align: 'right' })
      .text(`Date: ${formatDate(order.createdAt)}, ${formatTime(order.createdAt)}`, left, y + 32, { width, align: 'right' });
    y += 56;
    doc.font('b').fontSize(11).fillColor(INK).text(company.name, left, y);
    doc.font('r').fontSize(8.5).fillColor(MUTED).text([company.address, company.phone, company.email].filter(Boolean).join('  ·  '), left, y + 14, { width });
    y += 40;
    doc.moveTo(left, y).lineTo(left + width, y).strokeColor(BORDER).stroke();
    y += 12;

    // Billed to / sold by
    const half = width / 2 - 10;
    doc.font('b').fontSize(9).fillColor(MUTED).text('BILLED TO', left, y).text('SOLD BY', left + half + 20, y);
    y += 13;
    const addressLine = [addr.street, addr.additionalDetails, addr.city, addr.state, addr.zipCode].filter(Boolean).join(', ');
    doc.font('b').fontSize(10).fillColor(INK).text(customer?.name || 'Customer', left, y, { width: half });
    doc.font('b').fontSize(10).fillColor(INK).text(seller?.shopName || seller?.name || '', left + half + 20, y, { width: half });
    doc.font('r').fontSize(8.5).fillColor(MUTED)
      .text([customer?.phone || addr.phone, addressLine].filter(Boolean).join('\n'), left, y + 14, { width: half });
    doc.text(`Order #${order.orderId}`, left + half + 20, y + 14, { width: half });
    y += 70;

    // Items
    const cols = [left, left + width * 0.6, left + width * 0.75];
    doc.rect(left, y, width, 20).fill('#F8FAFC');
    doc.font('b').fontSize(9).fillColor(INK)
      .text('Item', cols[0] + 6, y + 6)
      .text('Qty', cols[1], y + 6, { width: width * 0.15, align: 'center' })
      .text('Amount', cols[2], y + 6, { width: width * 0.25 - 6, align: 'right' });
    y += 24;
    for (const it of order.items || []) {
      const name = [it.name, it.variantName].filter(Boolean).join(' - ');
      const h = Math.max(16, doc.font('r').fontSize(9).heightOfString(name, { width: width * 0.6 - 12 }) + 4);
      doc.fillColor(INK).text(name, cols[0] + 6, y, { width: width * 0.6 - 12 });
      doc.text(String(it.quantity || 1), cols[1], y, { width: width * 0.15, align: 'center' });
      doc.text(money(Number(it.price || 0) * Number(it.quantity || 1), symbol), cols[2], y, { width: width * 0.25 - 6, align: 'right' });
      y += h;
      if (y > doc.page.height - 200) {
        doc.addPage();
        y = 40;
      }
    }
    y += 6;
    doc.moveTo(left, y).lineTo(left + width, y).strokeColor(BORDER).stroke();
    y += 10;

    // Bill
    const line = (label, value, bold = false) => {
      doc.font(bold ? 'b' : 'r').fontSize(bold ? 11 : 9.5).fillColor(INK)
        .text(label, left + width * 0.45, y, { width: width * 0.3 })
        .text(value, left + width * 0.75, y, { width: width * 0.25 - 6, align: 'right' });
      y += bold ? 20 : 15;
    };
    for (const [label, v] of rows) line(label, money(v, symbol));
    if (discount > 0) line(`Discount${p.couponCode ? ` (${p.couponCode})` : ''}`, `- ${money(discount, symbol)}`);
    y += 4;
    line('Total', money(p.total, symbol), true);

    const pay = order.payment || {};
    const parts = [`Paid via ${quickPaymentLabel(pay)}`];
    if (Number(pay.walletAmount) > 0 && Number(pay.onlineAmount) > 0) {
      parts.push(`Wallet ${money(pay.walletAmount, symbol)} + Online ${money(pay.onlineAmount, symbol)}`);
    }
    if (pay.status === 'refunded' || pay.refund?.status === 'processed') {
      parts.push(`Refunded ${money(pay.refund?.amount || p.total, symbol)}`);
    }
    doc.font('r').fontSize(9).fillColor(MUTED).text(parts.join('  ·  '), left, y + 6, { width, align: 'right' });

    doc.font('r').fontSize(7.5).fillColor(MUTED)
      .text('This is a computer-generated invoice and needs no signature.', left, doc.page.height - 60, { width, align: 'center' });
    doc.end();
  });
};
