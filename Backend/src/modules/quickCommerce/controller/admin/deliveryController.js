import Delivery from "../../models/delivery.js";
import Order from "../../models/order.js";
import handleResponse from "../../utils/helper.js";
import getPagination from "../../utils/pagination.js";
import { getJoinRequests, approveDriverService, rejectDriverService } from "../../../../core/identity/driverOnboardingAdmin.service.js";

export const getDeliveryPartners = async (req, res) => {
  try {
    const { status, verified } = req.query;

    if (verified === "false") {
      const { requests } = await getJoinRequests("quickCommerce", {
        status: status === "rejected" ? "rejected" : "pending",
        search: req.query.search,
        page: req.query.page,
        limit: req.query.limit,
      });

      const items = requests.map((row) => ({
        _id: row._id,
        identityId: row.identityId,
        name: row.name,
        phone: row.phone,
        email: row.email,
        currentArea: row.zone,
        vehicleType: row.vehicleType,
        isVerified: row.serviceStatus === "approved",
        status: row.serviceStatus,
        services: row.services,
        servicesLabel: row.servicesLabel,
        rejectionReason: row.rejectionReason,
        createdAt: row.createdAt,
      }));

      return handleResponse(res, 200, "Delivery partners fetched successfully", {
        items,
        page: Number(req.query.page) || 1,
        limit: Number(req.query.limit) || 25,
        total: items.length,
        totalPages: 1,
      });
    }

    const query = {};

    if (status === "online") {
      query.isOnline = true;
    } else if (status === "offline") {
      query.isOnline = false;
    }

    if (verified === "true") {
      query.isVerified = true;
    } else if (verified === "false") {
      query.isVerified = false;
    }

    const { page, limit, skip } = getPagination(req, {
      defaultLimit: 25,
      maxLimit: 200,
    });

    const [deliveryPartners, total] = await Promise.all([
      Delivery.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Delivery.countDocuments(query),
    ]);

    return handleResponse(res, 200, "Delivery partners fetched successfully", {
      items: deliveryPartners,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    });
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

export const approveDeliveryPartner = async (req, res) => {
  try {
    const { id } = req.params;
    const row = await approveDriverService(id, req.body?.service || "quickCommerce");

    if (!row) {
      return handleResponse(res, 404, "Rider not found");
    }

    return handleResponse(res, 200, "Rider approved successfully", row);
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

export const rejectDeliveryPartner = async (req, res) => {
  try {
    const { id } = req.params;
    const reason = req.body?.reason || req.body?.rejectionReason || "";
    const row = await rejectDriverService(id, req.body?.service || "quickCommerce", reason);

    if (!row) {
      return handleResponse(res, 404, "Rider not found");
    }

    return handleResponse(
      res,
      200,
      "Rider application rejected",
      row,
    );
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

export const getActiveFleet = async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req, {
      defaultLimit: 25,
      maxLimit: 200,
    });

    const query = {
      deliveryBoy: { $ne: null },
      status: {
        $in: ["confirmed", "packed", "shipped", "out_for_delivery"],
      },
    };

    const [activeOrders, total] = await Promise.all([
      Order.find(query)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("deliveryBoy", "name phone documents vehicleType")
        .populate("seller", "shopName address name")
        .populate("customer", "name phone")
        .lean(),
      Order.countDocuments(query),
    ]);

    const fleetData = activeOrders.map((order) => ({
      id: order.orderId,
      status:
        order.status === "out_for_delivery"
          ? "On the Way"
          : order.status === "packed"
            ? "At Pickup"
            : order.status === "shipped"
              ? "In Transit"
              : "Assigned",
      deliveryBoy: {
        name: order.deliveryBoy?.name || "Unknown",
        phone: order.deliveryBoy?.phone || "N/A",
        id: order.deliveryBoy?._id || "N/A",
        vehicle: order.deliveryBoy?.vehicleType || "N/A",
        image:
          order.deliveryBoy?.documents?.profileImage ||
          "https://via.placeholder.com/200",
      },
      seller: {
        name: order.seller?.shopName || order.seller?.name || "Unknown",
      },
      customer: {
        name: order.customer?.name || "Guest",
        phone: order.customer?.phone || "N/A",
      },
      lastUpdate: order.updatedAt,
    }));

    return handleResponse(res, 200, "Active fleet fetched successfully", {
      items: fleetData,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    });
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};
