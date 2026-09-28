/**
 * Quick Commerce Socket Handlers — Chat, Tickets, QC Order updates.
 */
import mongoose from "mongoose";
import Ticket from "../models/ticket.js";

const deliverySockets = new Map();

export const setupQCSocketHandlers = (socket, io) => {
    // Normalizing roles between Buddy Service and Quick Commerce
    // Buddy: DELIVERY_PARTNER, RESTAURANT, USER, ADMIN
    // QC: delivery, seller, customer, admin
    const userId = socket.user?.userId || socket.user?.id;
    let role = (socket.user?.role || "").toLowerCase();
    
    if (role === "delivery_partner") role = "delivery";
    if (role === "restaurant") role = "seller";
    if (role === "user") role = "customer";

    if (!userId) return;

    // Join QC-specific rooms
    if (role === "delivery") {
        const dId = userId.toString();
        deliverySockets.set(dId, socket.id);
        socket.join("delivery:online");
        socket.join(`delivery:${dId}`);
    } else if (role === "seller") {
        socket.join(`seller:${userId}`);
    } else if (role === "customer") {
        socket.join(`customer:${userId}`);
    } else if (role === "admin") {
        socket.join("admin:orders");
        socket.join("admin:support");
    }

    // QC Order Events
    socket.on("join_order", (orderId) => {
        if (!orderId || typeof orderId !== "string") return;
        socket.join(`order:${orderId}`);
    });

    socket.on("leave_order", (orderId) => {
        if (!orderId) return;
        socket.leave(`order:${orderId}`);
    });

    // QC Support Ticket Events
    socket.on("join_ticket", async (ticketId) => {
        const raw = typeof ticketId === "string" ? ticketId.trim() : "";
        if (!raw || !mongoose.Types.ObjectId.isValid(raw)) return;

        if (role === "admin") {
            socket.join(`ticket:${raw}`);
            return;
        }

        try {
            const ticket = await Ticket.findById(raw).select("userId").lean();
            if (!ticket?.userId) return;
            if (ticket.userId.toString() !== userId.toString()) return;
            socket.join(`ticket:${raw}`);
        } catch {
            /* ignore */
        }
    });

    socket.on("leave_ticket", (ticketId) => {
        if (!ticketId) return;
        socket.leave(`ticket:${String(ticketId).trim()}`);
    });

    socket.on("register_delivery", (deliveryId) => {
        if (deliveryId && role === "delivery") {
            deliverySockets.set(deliveryId.toString(), socket.id);
        }
    });

    // Handle QC-specific disconnection logic
    socket.on("disconnect", () => {
        if (role === "delivery") {
            deliverySockets.delete(userId.toString());
        }
    });
};

// Compatibility for existing QC service calls
let _io = null;
export const setQCIO = (io) => { _io = io; };
export const getIO = () => _io;

export const notifyDeliveryPartners = (orderData) => {
    if (!_io) return;
    _io.to("delivery:online").emit("new_order_packed", orderData);
};

