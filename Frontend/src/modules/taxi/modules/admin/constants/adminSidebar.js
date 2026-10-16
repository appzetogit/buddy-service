import {
  Briefcase,
  Car,
  Clock,
  FileText,
  Gavel,
  Globe,
  Home,
  IndianRupee,
  Receipt,
  Layers,
  MapPin,
  MessageCircle,
  Monitor,
  Package,
  Settings,
  Settings2,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  TrendingUp,
  UserCog,
  Users,
  Wallet,
} from 'lucide-react';

/**
 * The admin sidebar: every menu, sub-menu and the permission each needs.
 *
 * Kept out of AdminLayout so the admin-account permission picker can build
 * its list from exactly this. The picker used to have its own hand-written
 * list of 30 coarse modules, so most of the 130-odd menus could not be
 * granted or withheld one by one, and any menu added here never appeared
 * there.
 */
export const ADMIN_SIDEBAR_SECTIONS = [
  {
    title: 'Home',
    items: [
      {
        icon: UserCog,
        label: 'Admin Management',
        subItems: [
          { label: 'Admins', path: '/admin/management/admins', permission: 'subadmins.manage' },
        ],
      },
      { icon: Home, label: 'Dashboard', path: '/admin/dashboard', permission: 'dashboard.view' },
      { icon: IndianRupee, label: 'Admin Earnings', path: '/admin/earnings', permission: 'earnings.view' },
      { icon: Receipt, label: 'Payments', path: '/admin/payments', permission: 'earnings.view' },
      {
        icon: TrendingUp,
        label: 'Promotions Management',
        subItems: [
          { label: 'Promo Code', path: '/admin/promotions/promo-codes', permission: 'promotions.view' },
          { label: 'Push Notifications', path: '/admin/promotions/send-notification', permission: 'promotions.view' },
          { label: 'Banner Image', path: '/admin/promotions/banner-image', permission: 'promotions.view' },
        ],
      },
      {
        icon: IndianRupee,
        label: 'Price Management',
        subItems: [
          { label: 'Service Location', path: '/admin/pricing/service-location', permission: 'service_locations.view' },
          { label: 'Zone', path: '/admin/pricing/zone', permission: 'zones.view' },
          { label: 'Airport', path: '/admin/pricing/airport', permission: 'airports.view' },
          { label: 'Set Price', path: '/admin/pricing/set-price', permission: 'set_prices.view' },
          //{ label: 'Goods Types', path: '/admin/pricing/goods-types', permission: 'goods_types.view' },
        ],
      },
      { icon: Gavel, label: 'Bidding', path: '/admin/settings/business/bid-ride', permission: 'settings.view' },
      {
        icon: TrendingUp,
        label: 'Price Hike',
        subItems: [
          { label: 'Hike Slots', path: '/admin/pricing/price-hike', permission: 'set_prices.view' },
        ],
      },
      {
        icon: IndianRupee,
        label: 'Package Pricing',
        subItems: [
          { label: 'Set Prices', path: '/admin/pricing/package-pricing', permission: 'set_prices.view' },
        ],
      },
      {
        icon: MapPin,
        label: 'Geofencing',
        subItems: [
          { label: 'Heat Map', path: '/admin/geo/heatmap', permission: 'geofencing.view' },
          { label: "God's Eye", path: '/admin/geo/gods-eye', permission: 'geofencing.view' },
        ],
      },
      { icon: ShieldAlert, label: 'SOS', path: '/admin/safety', permission: 'dashboard.view' },
      { icon: Car, label: 'Trip Requests', path: '/admin/trips', permission: 'trips.view' },
      { icon: Package, label: 'Delivery Requests', path: '/admin/deliveries', permission: 'deliveries.view' },
      { icon: Clock, label: 'Ongoing Requests', path: '/admin/ongoing', permission: 'ongoing.view' },
    ],
  },
  {
    title: 'Users',
    items: [
      {
        icon: Users,
        label: 'Customer Management',
        subItems: [
          { label: 'User List', path: '/admin/users', permission: 'users.view' },
          { label: 'Delete Request Users', path: '/admin/users/delete-requests', permission: 'users.view' },
          { label: 'User Bulk Upload', path: '/admin/users/bulk-upload', permission: 'users.view' },
        ],
      },
      { icon: Wallet, label: 'Wallet Payment', path: '/admin/wallet/payment', permission: 'wallet.view' },
      {
        icon: Car,
        label: 'Driver Management',
        subItems: [
          { label: 'Pending Drivers', path: '/admin/drivers/pending', permission: 'drivers.view' },
          { label: 'Approved Drivers', path: '/admin/drivers', permission: 'drivers.view' },
          { label: 'Active Drivers', path: '/admin/drivers/active', permission: 'drivers.view' },
          { label: 'Drivers Ratings', path: '/admin/drivers/ratings', permission: 'drivers.view' },
          {
            label: 'Driver Wallet',
            subItems: [
              { label: 'Withdrawal Requests', path: '/admin/drivers/wallet/withdrawals', permission: 'wallet.view' },
              { label: 'Negative Balance Drivers', path: '/admin/drivers/wallet/negative', permission: 'wallet.view' },
            ],
          },
          { label: 'Delete Request Drivers', path: '/admin/drivers/delete-requests', permission: 'drivers.view' },
          { label: 'Driver Needed Documents', path: '/admin/drivers/documents', permission: 'drivers.view' },
          //  { label: 'Driver Bulk Upload', path: '/admin/drivers/bulk-upload', permission: 'drivers.view' },
          { label: 'Payment Methods', path: '/admin/drivers/payment-methods', permission: 'wallet.view' },
          { label: 'Driver Wallet Managment', path: '/admin/settings/app/wallet', permission: 'settings.view' },
        ],
      },
      {
        icon: FileText,
        label: 'Report',
        subItems: [
          { label: 'User Report', path: '/admin/reports/user', permission: 'reports.view' },
          { label: 'Driver Report', path: '/admin/reports/driver', permission: 'reports.view' },
          { label: 'Driver Duty Report', path: '/admin/reports/driver-duty', permission: 'reports.view' },
          { label: 'Finance Report', path: '/admin/reports/finance', permission: 'reports.view' },
        ],
      },
      {
        icon: ShieldCheck,
        label: 'Support Management',
        subItems: [
          { label: 'Ticket Title', path: '/admin/support/ticket-title', permission: 'support.view' },
          { label: 'Support Tickets', path: '/admin/support/tickets', permission: 'support.view' },
        ],
      },
    ],
  },
  {
    title: 'Masters',
    items: [
      { icon: Globe, label: 'Language', path: '/admin/masters/languages', permission: 'settings.view' },
      // { icon: Star, label: 'Preferences', path: '/admin/masters/preferences' },
      // { icon: ShieldCheck, label: 'Roles', path: '/admin/masters/roles' },
    ],
  },
  {
    title: 'Settings',
    items: [
      {
        icon: Settings,
        label: 'Business Settings',
        permission: 'settings.view',
        subItems: [
          { label: 'General Settings', path: '/admin/settings/business/general', permission: 'settings.view' },
          { label: 'Transport Ride Settings', path: '/admin/settings/business/transport-ride', permission: 'settings.view' },
        ],
      },
      {
        icon: Smartphone,
        label: 'App Settings',
        permission: 'settings.view',
        subItems: [
          { label: 'Wallet Settings', path: '/admin/settings/app/wallet', permission: 'settings.view' },
          { label: 'Tip Settings', path: '/admin/settings/app/tip', permission: 'settings.view' },
          { label: 'Ride Voice Announcements', path: '/admin/settings/app/ride-voice', permission: 'settings.view' },
          // { label: 'Mobile App Landing/Onboard Screens Settings', path: '/admin/settings/app/onboard', permission: 'settings.view' },
        ],
      },
      {
        icon: Layers,
        label: 'User App Management',
        permission: 'settings.view',
        subItems: [
          { label: 'App Modules', path: '/admin/pricing/app-modules', permission: 'settings.view' },
          { label: 'Vehicle Type', path: '/admin/pricing/vehicle-type', permission: 'vehicle_types.view' },
          { label: 'Home Sections', path: '/admin/settings/user-app/home-sections', permission: 'settings.view' },
          { label: 'Everything In Minutes', path: '/admin/settings/user-app/everything-in-minutes', permission: 'settings.view' },
          { label: 'Explore Cards', path: '/admin/settings/user-app/explore-cards', permission: 'settings.view' },
          { label: 'Promo Banners', path: '/admin/settings/user-app/promo-banners', permission: 'settings.view' },
          { label: 'Go Places', path: '/admin/settings/user-app/go-places', permission: 'settings.view' },
          { label: 'Footer Content', path: '/admin/settings/user-app/footer-content', permission: 'settings.view' },
        ],
      },
      // {
      //   icon: PlusCircle,
      // },
      // Only the sections that are actually editable are listed. The rest of
      // the marketing site is still hardcoded in modules/landing; add entries
      // here as those sections move into the CMS.
      {
        icon: Monitor,
        label: 'Website Content',
        permission: 'landing_content.view',
        subItems: [
          { label: 'Landing Page', path: '/admin/settings/cms/landing', permission: 'landing_content.view' },
          { label: 'Enquiries', path: '/admin/settings/cms/enquiries', permission: 'enquiries.view' },
        ],
      },
    ],
  },
];
