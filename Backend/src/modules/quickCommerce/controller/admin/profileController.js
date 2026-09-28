import { Admin } from "../../../../core/admin/admin.model.js";
import handleResponse from "../../utils/helper.js";

export const getAdminProfile = async (req, res) => {
  try {
    const uid = req.user?.id || req.user?.userId;
    if (!uid) {
      return handleResponse(res, 400, "Missing user ID in session");
    }

    const admin = await Admin.findById(uid).select("-password").lean();
    if (!admin) {
      return handleResponse(res, 404, "Admin not found");
    }

    return handleResponse(res, 200, "Admin profile fetched successfully", {
      _id: admin._id,
      name: admin.name || "",
      email: admin.email || "",
      phone: admin.phone || "",
      role: admin.role || "admin",
      profileImage: admin.profileImage || "",
      isVerified: admin.isVerified !== false,
      servicesAccess: admin.servicesAccess || [],
      createdAt: admin.createdAt,
      updatedAt: admin.updatedAt,
    });
  } catch (error) {
    console.error("[ProfileService] FATAL ERROR:", error);
    return handleResponse(res, 500, error.message);
  }
};

export const updateAdminProfile = async (req, res) => {
  try {
    const { name, email, phone, profileImage } = req.body;
    const uid = req.user?.id || req.user?.userId;

    const admin = await Admin.findById(uid);
    if (!admin) {
      return handleResponse(res, 404, "Admin not found");
    }

    if (name) admin.name = name;
    if (email) admin.email = email;
    if (phone !== undefined) admin.phone = phone;
    if (profileImage !== undefined) admin.profileImage = profileImage;

    const updatedAdmin = await admin.save();
    const sanitized = updatedAdmin.toObject();
    delete sanitized.password;

    return handleResponse(res, 200, "Admin profile updated successfully", sanitized);
  } catch (error) {
    if (error.code === 11000) {
      return handleResponse(res, 400, "Email already in use");
    }
    return handleResponse(res, 500, error.message);
  }
};

export const updateAdminPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const uid = req.user?.id || req.user?.userId;

    const admin = await Admin.findById(uid).select("+password");
    if (!admin) {
      return handleResponse(res, 404, "Admin not found");
    }

    const isMatch = await admin.comparePassword(currentPassword);
    if (!isMatch) {
      return handleResponse(res, 401, "Invalid current password");
    }

    admin.password = newPassword;
    await admin.save();

    return handleResponse(res, 200, "Password updated successfully");
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};
