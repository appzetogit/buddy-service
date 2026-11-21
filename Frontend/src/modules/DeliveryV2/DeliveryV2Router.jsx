import React, { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import Loader from "@food/components/Loader";

import DeliveryHomeV2 from './pages/DeliveryHomeV2';
import { PocketBalanceV2 } from './pages/pocket/PocketBalanceV2';
import { ProfileBankV2 } from './pages/profile/ProfileBankV2';
import { ProfileDocsV2 } from './pages/profile/ProfileDocsV2';
import { SupportTicketsV2 } from './pages/help/SupportTicketsV2';
import { CreateSupportTicketV2 } from './pages/help/CreateSupportTicketV2';
import { ViewSupportTicketV2 } from './pages/help/ViewSupportTicketV2';
import ShowIdCardV2 from './pages/help/ShowIdCardV2';
import { ProfileDetailsV2 } from './pages/profile/ProfileDetailsV2';
import TermsAndConditionsV2 from './pages/TermsAndConditionsV2';
import PrivacyPolicyV2 from './pages/PrivacyPolicyV2';
import NotificationsV2 from './pages/NotificationsV2';
import GigDayV2 from './pages/GigDayV2';

const DeliveryV2Router = () => {
  return (
    <Suspense fallback={<Loader />}>
      <Routes>
        <Route path="welcome" element={<Navigate to="/driver/login" replace />} />
        <Route path="login" element={<Navigate to="/driver/login" replace />} />
        <Route path="otp" element={<Navigate to="/driver/login" replace />} />
        <Route path="signup" element={<Navigate to="/driver/login" replace />} />
        <Route path="signup/details" element={<Navigate to="/driver/onboarding" replace />} />
        <Route path="signup/documents" element={<Navigate to="/driver/onboarding" replace />} />
        <Route path="terms" element={<TermsAndConditionsV2 />} />

        <Route path="/" element={<ProtectedRoute><DeliveryHomeV2 tab="feed" /></ProtectedRoute>} />
        <Route path="/feed" element={<ProtectedRoute><DeliveryHomeV2 tab="feed" /></ProtectedRoute>} />
        <Route path="/pocket" element={<ProtectedRoute><DeliveryHomeV2 tab="pocket" /></ProtectedRoute>} />
        <Route path="/history" element={<ProtectedRoute><DeliveryHomeV2 tab="history" /></ProtectedRoute>} />
        <Route path="/gigs" element={<ProtectedRoute><DeliveryHomeV2 tab="gigs" /></ProtectedRoute>} />
        <Route path="/gigs/:date" element={<ProtectedRoute><GigDayV2 /></ProtectedRoute>} />
        <Route path="/profile" element={<Navigate to="/driver/profile" replace />} />
        <Route path="/notifications" element={<ProtectedRoute><NotificationsV2 /></ProtectedRoute>} />
        <Route path="/profile/details" element={<ProtectedRoute><ProfileDetailsV2 /></ProtectedRoute>} />
        <Route path="/profile/bank" element={<ProtectedRoute><ProfileBankV2 /></ProtectedRoute>} />
        <Route path="/profile/documents" element={<ProtectedRoute><ProfileDocsV2 /></ProtectedRoute>} />

        <Route path="/help/tickets" element={<ProtectedRoute><SupportTicketsV2 /></ProtectedRoute>} />
        <Route path="/help/tickets/create" element={<ProtectedRoute><CreateSupportTicketV2 /></ProtectedRoute>} />
        <Route path="/help/tickets/:ticketId" element={<ProtectedRoute><ViewSupportTicketV2 /></ProtectedRoute>} />
        <Route path="/help/id-card" element={<ProtectedRoute><ShowIdCardV2 /></ProtectedRoute>} />
        <Route path="/profile/terms" element={<ProtectedRoute><TermsAndConditionsV2 /></ProtectedRoute>} />
        <Route path="/profile/privacy" element={<ProtectedRoute><PrivacyPolicyV2 /></ProtectedRoute>} />

        <Route path="/pocket/withdraw" element={<ProtectedRoute><PocketBalanceV2 /></ProtectedRoute>} />
        <Route path="/pocket/balance" element={<ProtectedRoute><PocketBalanceV2 /></ProtectedRoute>} />
        <Route path="/pocket/payout" element={<Navigate to="/food/delivery/pocket" replace />} />
        <Route path="/pocket/statement" element={<Navigate to="/food/delivery/pocket" replace />} />
        <Route path="/pocket/deductions" element={<Navigate to="/food/delivery/pocket" replace />} />
        <Route path="/pocket/limit-settlement" element={<Navigate to="/food/delivery/pocket" replace />} />
        <Route path="/pocket/cash-limit" element={<Navigate to="/food/delivery/pocket" replace />} />
        <Route path="/pocket/details" element={<Navigate to="/food/delivery/pocket" replace />} />

        <Route path="/taxi/*" element={<Navigate to="/food/delivery" replace />} />

        <Route path="*" element={<Navigate to="/food/delivery" replace />} />
      </Routes>
    </Suspense>
  );
};

export default DeliveryV2Router;
