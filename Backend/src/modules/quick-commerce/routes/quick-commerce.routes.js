import express from "express";
import { getPublicFaqs } from "../controllers/faq.controller.js";
import { upload } from "../../../middleware/upload.js";
import {
  getCategories,
  getCoupons,
  applyCoupon,
  getHomeData,
  getBootstrapData,
  getExperienceSectionsLean,
  getHeroConfigLean,
  getOfferSectionsLean,
  getHomeTilesLean,
  getOffers,
  getProductById,
  getProductReviews,
  submitProductReview,
  getProducts,
  getStores,
  getStoreDetails,
} from "../controllers/catalog.controller.js";
import {
  addToCart,
  clearCart,
  getCart,
  previewCheckout,
  removeCartItem,
  updateCartItem,
} from "../controllers/cart.controller.js";
import {
  cancelOrder,
  getMyOrders,
  getOrderById,
  placeOrder,
  verifyPayment,
  submitOrderRatingsController,
} from "../controllers/order.controller.js";
import {
  cancelReturnRequestController,
  createReturnRequestController,
  getAdminReturnByIdController,
  getReturnFinanceReportController,
  getReturnPickupOtpController,
  getReturnStatusController,
  getSellerFinanceLedgerController,
  listAdminReturnsController,
  passReturnQualityCheckController,
  confirmReturnPayoutController,
  processAdminReturnRefundController,
} from "../controllers/return.controller.js";
import { getUserWalletController } from "../../food/user/controllers/userWallet.controller.js";
import {
  addToWishlist,
  getWishlist,
  removeFromWishlist,
  toggleWishlist,
} from "../controllers/wishlist.controller.js";
import {
  createSupportTicketController,
  listMySupportTicketsController,
  getAdminSupportTicketsController,
  updateAdminSupportTicketController,
} from "../controllers/support.controller.js";
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
  listPublicZones,
  detectQuickZonePublic,
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
  getPublicBillingSettings,
} from "../controllers/billing.controller.js";
import * as notificationBroadcastController from "../../food/admin/controllers/notificationBroadcast.controller.js";
import {
  geocodeAddress,
  reverseGeocode,
  geocodePlaceId,
} from "../controllers/location.controller.js";

import { authMiddleware } from "../../../core/auth/auth.middleware.js";
import { requireRoles } from "../../../core/roles/role.middleware.js";
import { verifyAccessToken } from "../../../core/auth/token.util.js";
import { FoodUser } from "../../../core/users/user.model.js";

const optionalAuth = (req, res, next) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.substring(7)
    : null;
  if (!token) {
    return next();
  }
  try {
    const decoded = verifyAccessToken(token);
    // Deactivated customers must not use QC authenticated-optional routes with a live access token.
    if (decoded.role === "USER") {
      FoodUser.findById(decoded.userId)
        .select("isActive")
        .lean()
        .then((doc) => {
          if (!doc || doc.isActive === false) {
            return res.status(401).json({
              success: false,
              message: "User account is deactivated",
            });
          }
          req.user = { userId: decoded.userId, role: decoded.role };
          next();
        })
        .catch(() =>
          res.status(401).json({ success: false, message: "Authentication failed" }),
        );
      return;
    }
    req.user = { userId: decoded.userId, role: decoded.role };
  } catch (e) {
    // ignore guest
  }
  next();
};

const router = express.Router();

router.get("/health", (_req, res) =>
  res.json({ success: true, module: "quick-commerce", status: "ok" }),
);

// ─── Performance: Single bootstrap call for homepage ──────────────────────────────
router.get("/bootstrap", getBootstrapData);

router.get("/home", getHomeData);
// Lean dedicated endpoints (replaces heavy getHomeData bridges)
router.get("/experience", getExperienceSectionsLean);
router.get("/experience/hero", getHeroConfigLean);
router.get("/offer-sections", getOfferSectionsLean);
router.get("/home-tiles", getHomeTilesLean);
router.get("/offers", getOffers);
router.get("/coupons", getCoupons);
router.post("/coupons/apply", applyCoupon);
router.get("/categories", getCategories);
router.get("/products", getProducts);
router.get("/products/:productId/reviews", getProductReviews);
router.post("/products/reviews", optionalAuth, submitProductReview);
router.get("/products/:productId", getProductById);
router.get("/zones/public", listPublicZones);
router.get("/zones/detect", detectQuickZonePublic);
router.get("/billing/settings", getPublicBillingSettings);
router.get("/stores", getStores);
router.get("/stores/:storeId", getStoreDetails);

// Location endpoints
router.get("/location/geocode", geocodeAddress);
router.get("/location/reverse-geocode", reverseGeocode);
router.get("/location/geocode-place", geocodePlaceId);

router.get("/cart", optionalAuth, getCart);
router.post("/cart/preview", optionalAuth, previewCheckout);
router.post("/checkout/preview", optionalAuth, previewCheckout);
router.post("/cart/add", optionalAuth, addToCart);
router.put("/cart/update", optionalAuth, updateCartItem);
router.delete("/cart/remove/:productId", optionalAuth, removeCartItem);
router.delete("/cart/clear", optionalAuth, clearCart);

router.post("/orders", optionalAuth, placeOrder);
router.get("/orders", optionalAuth, getMyOrders);
router.get("/orders/:orderId", optionalAuth, getOrderById);
router.post("/orders/:orderId/verify-payment", optionalAuth, verifyPayment);
router.post("/orders/:orderId/cancel", optionalAuth, cancelOrder);
router.post("/orders/:orderId/returns", authMiddleware, createReturnRequestController);
router.get("/orders/:orderId/returns", authMiddleware, getReturnStatusController);
router.get("/orders/:orderId/returns/pickup-otp", authMiddleware, getReturnPickupOtpController);
router.post("/orders/:orderId/returns/cancel", authMiddleware, cancelReturnRequestController);
router.patch("/orders/:orderId/ratings", authMiddleware, submitOrderRatingsController);
router.get("/wallet/balance", authMiddleware, getUserWalletController);
router.get("/wallet/transactions", authMiddleware, getUserWalletController);
router.post("/support/ticket", optionalAuth, createSupportTicketController);
router.get("/support/my-tickets", optionalAuth, listMySupportTicketsController);

router.get("/wishlist", optionalAuth, getWishlist);
router.post("/wishlist/add", optionalAuth, addToWishlist);
router.delete("/wishlist/remove/:productId", optionalAuth, removeFromWishlist);
router.post("/wishlist/toggle", optionalAuth, toggleWishlist);

router.get("/public/faqs", getPublicFaqs);



export default router;
