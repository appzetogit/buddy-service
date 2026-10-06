import {
  User,
  Wallet,
  Tag,
  MapPin,
  Leaf,
  Palette,
  Bookmark,
  Utensils,
  Building2,
  Settings as SettingsIcon,
  Info,
  HelpCircle,
  FileText,
  ShieldCheck,
} from "lucide-react";
import { ENABLE_DINING } from "@/shared/featureFlags";

/** @typedef {'link' | 'action'} MenuItemType */

/**
 * Shared profile configuration for all end-user modules.
 * Menu items use `type: 'action'` for in-page handlers (see UnifiedProfile).
 * Food-only profile entries.
 */
export const PROFILE_SERVICES = [
  {
    id: "unified",
    label: "Unified Profile",
    accent: "#6366F1",
    accentClass: "profile-accent-unified",
    homePath: "/food/user", // Or root path
    header: {
      title: "My Profile",
      backPath: "/food/user",
      actions: [
        { type: "navigate", icon: SettingsIcon, label: "Settings", path: "/food/user/profile/edit" },
      ],
    },
    sections: [
      {
        title: "Orders & History",
        items: [
          { type: "link", icon: Building2, label: "All Orders", sub: "Food orders", path: "/food/user/orders" },
          ...(ENABLE_DINING
            ? [{ type: "link", icon: Utensils, label: "Dining Bookings", sub: "View table reservations", path: "/food/user/profile/dining-bookings" }]
            : []),
        ],
      },
      {
        title: "Wallets & Finances",
        items: [
          { type: "link", icon: Wallet, label: "Wallet", sub: "Balance & transactions", path: "/food/user/wallet", badgeKey: "foodWallet" },
        ],
      },
      {
        title: "Saved Items",
        items: [
          { type: "action", icon: MapPin, label: "Saved Addresses", subKey: "foodAddressSummary", action: "openLocationSelector", badgeKey: "foodAddressCount" },
          { type: "link", icon: Bookmark, label: "Food Collections", path: "/food/user/profile/favorites" },
        ],
      },
      {
        title: "Preferences & Rewards",
        items: [
          { type: "link", icon: User, label: "Profile Settings", path: "/food/user/profile/edit" },
          { type: "link", icon: Tag, label: "Your Coupons", path: "/food/user/profile/coupons" },
          { type: "action", icon: Leaf, label: "Veg Mode", action: "openVegMode", valueKey: "vegMode" },
          { type: "action", icon: Palette, label: "Appearance", action: "openAppearance", valueKey: "appearance" },
        ],
      },
      {
        title: "Help & Legal",
        items: [
          { type: "link", icon: HelpCircle, label: "Help & Support", path: "/food/user/profile/support" },
          { type: "link", icon: FileText, label: "Terms & Conditions", path: "/food/user/profile/terms" },
          { type: "link", icon: ShieldCheck, label: "Privacy Policy", path: "/food/user/profile/privacy" },
          { type: "link", icon: Info, label: "About Us", path: "/food/user/profile/about" },
        ],
      },
    ],
  },
];

export const PROFILE_SERVICE_IDS = PROFILE_SERVICES.map((s) => s.id);

export const DEFAULT_PROFILE_SERVICE = "unified";

export const PROFILE_STORAGE_KEY = "profile_active_service";
