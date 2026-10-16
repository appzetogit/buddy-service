import { ADMIN_SIDEBAR_SECTIONS } from './adminSidebar';

/**
 * Admin access, at two levels.
 *
 * The backend authorises API calls with coarse permissions - `settings.view`,
 * `drivers.view` - one per area. The sidebar has well over a hundred menus and
 * sub-menus inside those areas, and the client needs to grant them one by one:
 * Bidding without the rest of Settings, Push Notifications without Promo Codes.
 *
 * So each menu has its own key, `menu:<path>`, and choosing a menu also grants
 * the coarse permission its page calls the API with. An admin saved before
 * menu keys existed has only coarse ones, and keeps seeing every menu in the
 * areas they were given - exactly what they saw before.
 */

export const MENU_PERMISSION_PREFIX = 'menu:';

export const menuPermissionKey = (path) => `${MENU_PERMISSION_PREFIX}${path}`;

const isSuperadmin = (adminInfo = {}) => {
  const type = String(adminInfo?.admin_type || adminInfo?.role || '').toLowerCase();
  const permissions = Array.isArray(adminInfo?.permissions) ? adminInfo.permissions : [];
  return type === 'superadmin' || permissions.includes('*');
};

export const hasAdminPermission = (adminInfo = {}, permission) => {
  if (isSuperadmin(adminInfo)) return true;
  const permissions = Array.isArray(adminInfo?.permissions) ? adminInfo.permissions : [];
  return permissions.includes(permission);
};

/** Whether this admin may see one sidebar entry. */
export const isMenuAllowed = (adminInfo = {}, item = {}) => {
  if (isSuperadmin(adminInfo)) return true;

  const permissions = Array.isArray(adminInfo?.permissions) ? adminInfo.permissions : [];
  const usesMenuKeys = permissions.some((key) => String(key).startsWith(MENU_PERMISSION_PREFIX));

  if (usesMenuKeys && item.path) {
    return permissions.includes(menuPermissionKey(item.path));
  }

  // An admin from before menu keys: their coarse permissions decide, as they
  // always did.
  return !item.permission || permissions.includes(item.permission);
};

/**
 * The sidebar as a tree of grantable menus: section -> menu -> sub-menus.
 * A menu with no sub-menus is a group of one, so every row in the picker has
 * the same shape.
 */
export const buildMenuPermissionTree = (sections = ADMIN_SIDEBAR_SECTIONS) => {
  const toLeaf = (item) => ({
    key: menuPermissionKey(item.path),
    label: item.label,
    path: item.path,
    permission: item.permission || null,
  });

  return sections
    .map((section) => ({
      title: section.title,
      groups: (section.items || [])
        .map((item) => {
          if (Array.isArray(item.subItems) && item.subItems.length > 0) {
            return {
              label: item.label,
              leaves: item.subItems.filter((sub) => sub.path).map(toLeaf),
            };
          }
          return item.path ? { label: item.label, leaves: [toLeaf(item)] } : null;
        })
        .filter((group) => group && group.leaves.length > 0),
    }))
    .filter((section) => section.groups.length > 0);
};

/** Every menu key, for "select all". */
export const ALL_MENU_PERMISSION_KEYS = [
  ...new Set(buildMenuPermissionTree().flatMap((s) => s.groups.flatMap((g) => g.leaves.map((l) => l.key)))),
];

/**
 * What to save for a set of chosen menus: the menu keys themselves, plus the
 * coarse permission each one's page needs from the API. Without the coarse
 * ones an admin would see a menu and get "forbidden" on opening it.
 */
export const expandMenuPermissions = (menuKeys = []) => {
  const chosen = new Set(menuKeys.filter((key) => String(key).startsWith(MENU_PERMISSION_PREFIX)));
  const coarse = new Set();

  for (const section of buildMenuPermissionTree()) {
    for (const group of section.groups) {
      for (const leaf of group.leaves) {
        if (chosen.has(leaf.key) && leaf.permission) coarse.add(leaf.permission);
      }
    }
  }

  return [...chosen, ...coarse];
};

/**
 * The menus to show as ticked when editing an admin. One saved before menu
 * keys existed gets every menu their coarse permissions already allowed, so
 * saving them again changes nothing they can do.
 */
export const menuKeysForAdmin = (permissions = []) => {
  const list = Array.isArray(permissions) ? permissions : [];
  const menuKeys = list.filter((key) => String(key).startsWith(MENU_PERMISSION_PREFIX));
  if (menuKeys.length > 0) return menuKeys;

  const coarse = new Set(list);
  return buildMenuPermissionTree().flatMap((s) =>
    s.groups.flatMap((g) => g.leaves.filter((l) => !l.permission || coarse.has(l.permission)).map((l) => l.key)),
  );
};

/*
 * The coarse areas, as the backend knows them. Still exported for anything
 * that checks an area rather than a menu.
 */
export const ADMIN_PERMISSION_GROUPS = [
  {
    title: 'Core Access',
    items: [
      { key: 'dashboard.view', label: 'Dashboard' },
      { key: 'earnings.view', label: 'Admin Earnings' },
      { key: 'promotions.view', label: 'Promotions' },
      { key: 'subadmins.manage', label: 'Subadmins' },
    ],
  },
  {
    title: 'Operations',
    items: [
      { key: 'trips.view', label: 'Trip Requests' },
      { key: 'deliveries.view', label: 'Delivery Requests' },
      { key: 'ongoing.view', label: 'Ongoing Requests' },
      { key: 'drivers.view', label: 'Drivers' },
      { key: 'users.view', label: 'Customers' },
      { key: 'wallet.view', label: 'Wallet' },
      { key: 'support.view', label: 'Support' },
      { key: 'reports.view', label: 'Reports' },
    ],
  },
  {
    title: 'Website & Settings',
    items: [
      { key: 'landing_content.view', label: 'Website Content (CMS)' },
      { key: 'enquiries.view', label: 'Website Enquiries' },
      { key: 'settings.view', label: 'Settings' },
    ],
  },
  {
    title: 'Pricing Scope',
    items: [
      { key: 'service_locations.view', label: 'Service Locations' },
      { key: 'zones.view', label: 'Zones' },
      { key: 'airports.view', label: 'Airports' },
      { key: 'vehicle_types.view', label: 'Vehicle Types' },
      { key: 'set_prices.view', label: 'Set Prices' },
      { key: 'goods_types.view', label: 'Goods Types' },
      { key: 'geofencing.view', label: 'Geofencing' },
    ],
  },
];

export const ALL_ADMIN_PERMISSIONS = ADMIN_PERMISSION_GROUPS.flatMap((group) => group.items.map((item) => item.key));
