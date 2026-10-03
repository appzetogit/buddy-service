import { useEffect, useState, useMemo, useCallback } from "react";
import { useProfile } from "@food/context/ProfileContext";
import { userAPI } from "@food/api";
import { useCompanyName } from "@food/hooks/useCompanyName";

const validGenders = ["male", "female", "other", "prefer-not-to-say"];

function isDateFilled(dateField) {
  if (!dateField) return false;
  if (dateField instanceof Date) return !isNaN(dateField.getTime());
  if (typeof dateField === "string") {
    const trimmed = dateField.trim();
    if (!trimmed || trimmed === "null" || trimmed === "undefined") return false;
    const date = new Date(trimmed);
    return !isNaN(date.getTime());
  }
  return false;
}

function calculateProfileCompletion(userProfile) {
  if (!userProfile) return 0;

  const hasName = !!(userProfile.name && String(userProfile.name).trim());
  const hasPhone = !!(userProfile.phone && String(userProfile.phone).trim());
  const hasValidEmail =
    userProfile?.email &&
    String(userProfile.email).trim() !== "" &&
    String(userProfile.email).includes("@");
  const hasContact = hasPhone || hasValidEmail;
  const hasImage = !!(
    userProfile.profileImage &&
    String(userProfile.profileImage).trim() &&
    userProfile.profileImage !== "null"
  );
  const hasDateOfBirth = isDateFilled(userProfile.dateOfBirth);
  const hasGender = !!(
    userProfile.gender &&
    validGenders.includes(String(userProfile.gender).trim().toLowerCase())
  );

  const completed = [hasName, hasContact, hasImage, hasDateOfBirth, hasGender].filter(Boolean).length;
  return Math.round((completed / 5) * 100);
}

export function useUnifiedProfileData() {
  const { userProfile, vegMode, addresses, getDefaultAddress } = useProfile();
  const companyName = useCompanyName();
  const [masterData, setMasterData] = useState(null);
  const [loadingMaster, setLoadingMaster] = useState(true);
  const [appearance, setAppearance] = useState(() => localStorage.getItem("appTheme") || "light");

  useEffect(() => {
    const root = document.documentElement;
    if (appearance === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    localStorage.setItem("appTheme", appearance);
  }, [appearance]);

  useEffect(() => {
    let mounted = true;
    userAPI
      .getMasterProfile()
      .then((res) => {
        if (mounted) {
          setMasterData(res?.data?.data || res?.data || null);
          setLoadingMaster(false);
        }
      })
      .catch(() => {
        if (mounted) setLoadingMaster(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const defaultAddress = getDefaultAddress?.();
  const savedAddressSummary = defaultAddress
    ? [
        defaultAddress.street,
        defaultAddress.additionalDetails,
        defaultAddress.city,
        defaultAddress.state,
        defaultAddress.zipCode,
      ]
        .filter(Boolean)
        .join(", ")
    : "No address saved. Tap to save Home, Work, or Other.";

  const displayName = userProfile?.name || userProfile?.phone || "User";
  const hasValidEmail =
    userProfile?.email &&
    String(userProfile.email).trim() !== "" &&
    String(userProfile.email).includes("@");

  const profileCompletion = calculateProfileCompletion(userProfile);

  const badgeValues = useMemo(() => {
    const foodWallet = Number(masterData?.wallets?.food_qc_balance ?? 0);
    const referralReward = Number(masterData?.referrals?.food_reward ?? 0);

    return {
      foodWallet: `₹${foodWallet.toFixed(0)}`,
      foodReferral: referralReward > 0 ? `Earn ₹${referralReward}` : null,
      foodAddressCount: String(addresses?.length || 0),
      foodAddressSummary: savedAddressSummary,
      foodProfileCompletion: `${profileCompletion}% completed`,
      vegMode: vegMode ? "ON" : "OFF",
      appearance,
    };
  }, [masterData, addresses, savedAddressSummary, profileCompletion, vegMode, appearance]);

  const avatarInitial =
    userProfile?.name?.charAt(0)?.toUpperCase() ||
    userProfile?.phone?.charAt(1)?.toUpperCase() ||
    "U";

  const getItemBadge = useCallback(
    (badgeKey) => {
      if (!badgeKey) return null;
      const value = badgeValues[badgeKey];
      if (value == null || value === "" || value === "0") return null;
      return value;
    },
    [badgeValues],
  );

  const getItemValue = useCallback(
    (valueKey) => {
      if (!valueKey) return null;
      return badgeValues[valueKey] ?? null;
    },
    [badgeValues],
  );

  const getItemSub = useCallback(
    (item) => {
      if (item.sub) return item.sub;
      if (item.subKey) return badgeValues[item.subKey] ?? "";
      return null;
    },
    [badgeValues],
  );

  return {
    userProfile,
    companyName,
    masterData,
    loadingMaster,
    displayName,
    hasValidEmail,
    avatarInitial,
    profileCompletion,
    isProfileComplete: profileCompletion === 100,
    appearance,
    setAppearance,
    vegMode,
    badgeValues,
    getItemBadge,
    getItemValue,
    getItemSub,
  };
}
