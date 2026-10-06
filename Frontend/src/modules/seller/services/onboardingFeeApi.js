import apiClient from "@food/api/axios";

export const onboardingFeeAPI = {
  getPublicFees: () => apiClient.get("/common/onboarding-fees/public"),
  createOrder: (body) => apiClient.post("/common/onboarding-fees/public/create-order", body ?? {}),
};
