import express from "express";
import { upload } from "../../../middleware/upload.js";

import {
  approveAdminSellerRequest,
  getAdminSellerRequests,
  createCategory,
  createProduct,
  getAdminCategories,
  getAdminOrders,
  getAdminOrderById,
  getAdminCustomers,
  getAdminCustomerById,
  deleteAdminOrder,
  getAdminProducts,
  getAdminProductById,
  getAdminStats,
  rejectAdminSellerRequest,
  removeCategory,
  removeProduct,
  updateCategory,
  updateProduct,
  getAdminZones,
  getAdminZoneById,
  createAdminZone,
  updateAdminZone,
  deleteAdminZone,
  getAdminExperienceSections,
  createAdminExperienceSection,
  updateAdminExperienceSection,
  deleteAdminExperienceSection,
  reorderAdminExperienceSections,
  getAdminHeroConfig,
  setAdminHeroConfig,
  getAdminOfferSections,
  createAdminOfferSection,
  updateAdminOfferSection,
  deleteAdminOfferSection,
  reorderAdminOfferSections,
  getAdminHomeTiles,
  createAdminHomeTile,
  updateAdminHomeTile,
  deleteAdminHomeTile,
  reorderAdminHomeTiles,
  updateAdminHomeHeadings,
  getAdminFinanceSummary,
  getAdminFinanceLedger,
  getAdminFinancePayouts,
  getAdminSellerWithdrawals,
  getAdminSellerTransactions,
  updateAdminWithdrawalStatus,
  getAdminSellerCouponRequests,
  updateAdminSellerCouponRequestStatus,
  getAdminCoupons,
  createCoupon,
  updateCoupon,
  deleteCoupon,
  toggleCouponStatus,
  getExpiredSellerLicenses,
} from "../controllers/admin.controller.js";
import {
  createOrUpdateFeeSettings,
  getFeeSettings,
} from "../controllers/billing.controller.js";
import {
  getAdminReturnByIdController,
  getReturnFinanceReportController,
  getSellerFinanceLedgerController,
  listAdminReturnsController,
  passReturnQualityCheckController,
  confirmReturnPayoutController,
  processAdminReturnRefundController,
} from "../controllers/return.controller.js";
import {
  getAdminSupportTicketsController,
  updateAdminSupportTicketController,
} from "../controllers/support.controller.js";
import * as notificationBroadcastController from "../../food/admin/controllers/notificationBroadcast.controller.js";
import {
  geocodeAddress,
  reverseGeocode,
  geocodePlaceId,
} from "../controllers/location.controller.js";
import {
  getFaqCategories,
  createFaqCategory,
  deleteFaqCategory,
  getAdminFaqs,
  createFaq,
  updateFaq,
  deleteFaq,
} from "../controllers/faq.controller.js";

// Mounted behind `authMiddleware, requireRoles('ADMIN')` at the router.use() call site
// (routes/index.js) — Buddy only has one admin role (superadmin), so there's no
// per-permission RBAC gate here, unlike Blaze's `checkPermission(...)` + Employee roles.
const router = express.Router();

router.get("/stats", getAdminStats);

// Categories
router.get("/categories", getAdminCategories);
router.post("/categories", upload.single("image"), createCategory);
router.put("/categories/:categoryId", upload.single("image"), updateCategory);
router.delete("/categories/:categoryId", removeCategory);

// Products
router.get("/products", getAdminProducts);
router.get("/products/:productId", getAdminProductById);
router.post(
  "/products",
  upload.fields([
    { name: "mainImage", maxCount: 1 },
    { name: "galleryImages", maxCount: 8 },
    ...Array.from({ length: 5 }, (_, index) => ({
      name: `variantImages_${index}`,
      maxCount: 3,
    })),
  ]),
  createProduct,
);
router.put(
  "/products/:productId",
  upload.fields([
    { name: "mainImage", maxCount: 1 },
    { name: "galleryImages", maxCount: 8 },
    ...Array.from({ length: 5 }, (_, index) => ({
      name: `variantImages_${index}`,
      maxCount: 3,
    })),
  ]),
  updateProduct,
);
router.delete("/products/:productId", removeProduct);

// Orders
router.get("/orders", getAdminOrders);
router.get("/orders/:orderId", getAdminOrderById);
router.delete("/orders/:orderId", deleteAdminOrder);

// Returns
router.get("/returns", listAdminReturnsController);
router.get("/returns/:returnId", getAdminReturnByIdController);
router.post("/returns/:returnId/refund", processAdminReturnRefundController);
router.post("/returns/:returnId/quality-pass", passReturnQualityCheckController);
router.post("/returns/:returnId/confirm-payout", confirmReturnPayoutController);
router.get("/finance/returns/report", getReturnFinanceReportController);
router.get("/finance/sellers/:sellerId/ledger", getSellerFinanceLedgerController);

// Finance
router.get("/finance/summary", getAdminFinanceSummary);
router.get("/finance/ledger", getAdminFinanceLedger);
router.get("/finance/payouts", getAdminFinancePayouts);
router.get("/withdrawals/sellers", getAdminSellerWithdrawals);
router.get("/seller-transactions", getAdminSellerTransactions);
router.patch("/withdrawals/:withdrawalId", updateAdminWithdrawalStatus);

// Customers
router.get("/customers", getAdminCustomers);
router.get("/customers/:id", getAdminCustomerById);

// Support tickets
router.get("/support-tickets", getAdminSupportTicketsController);
router.patch("/support-tickets/:id", updateAdminSupportTicketController);

// Seller requests
router.get("/seller-requests", getAdminSellerRequests);
router.put("/seller-requests/:sellerId/approve", approveAdminSellerRequest);
router.put("/seller-requests/:sellerId/reject", rejectAdminSellerRequest);
router.get("/notifications/license-expired", getExpiredSellerLicenses);

// Zones
router.get("/zones", getAdminZones);
router.get("/zones/:zoneId", getAdminZoneById);
router.post("/zones", createAdminZone);
router.patch("/zones/:zoneId", updateAdminZone);
router.delete("/zones/:zoneId", deleteAdminZone);

// Experience Sections
router.get("/experience/sections", getAdminExperienceSections);
router.post("/experience/sections", createAdminExperienceSection);
router.put("/experience/sections/:id", updateAdminExperienceSection);
router.delete("/experience/sections/:id", deleteAdminExperienceSection);
router.post("/experience/sections/reorder", reorderAdminExperienceSections);
router.get("/experience/hero", getAdminHeroConfig);
router.post("/experience/hero", setAdminHeroConfig);

// Offer Sections
router.get("/offer-sections", getAdminOfferSections);
router.post("/offer-sections", createAdminOfferSection);
router.put("/offer-sections/:id", updateAdminOfferSection);
router.delete("/offer-sections/:id", deleteAdminOfferSection);
router.post("/offer-sections/reorder", reorderAdminOfferSections);

// Home tiles
router.get("/home-tiles", getAdminHomeTiles);
router.post("/home-tiles", upload.single("image"), createAdminHomeTile);
router.put("/home-tiles/:id", upload.single("image"), updateAdminHomeTile);
router.delete("/home-tiles/:id", deleteAdminHomeTile);
router.post("/home-tiles/reorder", reorderAdminHomeTiles);
router.put("/home-headings", updateAdminHomeHeadings);

// Broadcast notifications (reuses Buddy's existing Food broadcast controller)
router.post("/notifications/broadcast", notificationBroadcastController.createBroadcastNotificationController);
router.get("/notifications/broadcast", notificationBroadcastController.getBroadcastNotificationsController);
router.delete("/notifications/broadcast/:id", notificationBroadcastController.deleteBroadcastNotificationController);

// Billing / fee settings
router.get("/fee-settings", getFeeSettings);
router.put("/fee-settings", createOrUpdateFeeSettings);

// Seller coupon requests + coupons
router.get("/seller-coupon-requests", getAdminSellerCouponRequests);
router.patch("/seller-coupon-requests/:id/status", updateAdminSellerCouponRequestStatus);
router.get("/coupons", getAdminCoupons);
router.post("/coupons", createCoupon);
router.put("/coupons/:couponId", updateCoupon);
router.delete("/coupons/:couponId", deleteCoupon);
router.patch("/coupons/:couponId/toggle-status", toggleCouponStatus);

// FAQ management
router.get("/faq-categories", getFaqCategories);
router.post("/faq-categories", createFaqCategory);
router.delete("/faq-categories/:id", deleteFaqCategory);
router.get("/faqs", getAdminFaqs);
router.post("/faqs", createFaq);
router.put("/faqs/:id", updateFaq);
router.delete("/faqs/:id", deleteFaq);

// Location lookups used by the zone-drawing UI
router.get("/location/geocode", geocodeAddress);
router.get("/location/reverse-geocode", reverseGeocode);
router.get("/location/geocode-place", geocodePlaceId);

export default router;
