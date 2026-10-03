import { motion } from "framer-motion";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@food/components/ui/avatar";
import { Card, CardContent } from "@food/components/ui/card";
import { ChevronRight, Power, Trash2 } from "lucide-react";

export default function ProfileUserCard({
  displayName,
  hasValidEmail,
  userProfile,
  avatarInitial,
  activeService,
  stats,
  badgeValues,
}) {
  return (
    <Card className="bg-white dark:bg-[#1a1a1a] rounded-2xl py-0 pt-1 shadow-sm mb-0 border-0 dark:border-gray-800 overflow-hidden">
      <CardContent className="p-4 py-0 pt-2">
        <div className="flex items-start gap-4 mb-2">
          <motion.div whileHover={{ scale: 1.05 }} transition={{ duration: 0.3 }}>
            <Avatar className="h-16 w-16 bg-[var(--profile-accent)]/20 border-0">
              {userProfile?.profileImage && (
                <AvatarImage src={userProfile.profileImage} alt={displayName} />
              )}
              <AvatarFallback
                className="text-white text-2xl font-semibold"
                style={{ backgroundColor: "var(--profile-accent)" }}
              >
                {avatarInitial}
              </AvatarFallback>
            </Avatar>
          </motion.div>
          <div className="flex-1 pt-1">
            <h2 className="text-xl font-bold text-black dark:text-white mb-1">{displayName}</h2>
            {hasValidEmail && (
              <p className="text-sm text-black dark:text-gray-300 mb-1">{userProfile.email}</p>
            )}
            {userProfile?.phone && (
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">{userProfile.phone}</p>
            )}
          </div>
        </div>

      </CardContent>
    </Card>
  );
}

export function ProfileAccountActions({ onLogout, onDelete, isLoggingOut, showDelete = true }) {
  return (
    <div className="space-y-2 mt-4 mb-8 pb-8">
      <div className="profile-section-title">
        <div className="profile-section-bar" />
        <h3 className="text-base font-semibold text-gray-900 dark:text-white">Account</h3>
      </div>
      <Card
        className="profile-menu-card py-0 border-0 dark:border-gray-800"
        onClick={onLogout}
      >
        <CardContent className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-gray-100 dark:bg-gray-800 rounded-full p-2">
              <Power className={`h-5 w-5 text-gray-700 dark:text-gray-300 ${isLoggingOut ? "animate-pulse" : ""}`} />
            </div>
            <span className="text-base font-medium text-gray-900 dark:text-white">
              {isLoggingOut ? "Logging out..." : "Log out"}
            </span>
          </div>
          <ChevronRight className="h-5 w-5 text-gray-400" />
        </CardContent>
      </Card>

      {showDelete && (
        <Card
          className="profile-menu-card py-0 border-0 dark:border-gray-800"
          onClick={onDelete}
        >
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-red-50 dark:bg-red-900/20 rounded-full p-2">
                <Trash2 className="h-5 w-5 text-red-500" />
              </div>
              <span className="text-base font-medium text-red-500">Delete Account</span>
            </div>
            <ChevronRight className="h-5 w-5 text-red-300" />
          </CardContent>
        </Card>
      )}

      {showDelete && (
        <p className="text-center text-[10px] text-slate-400 mt-2 pb-2">
          Account deletion applies to your entire Buddy profile
        </p>
      )}
    </div>
  );
}
