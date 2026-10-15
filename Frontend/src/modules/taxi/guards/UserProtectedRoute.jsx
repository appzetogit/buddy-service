import React, { useEffect } from 'react';
import { Outlet, useNavigate } from '@taxi/shared/router';
import { getLocalUserToken } from '../modules/user/services/authService';
import { UserHome } from '../routes/lazyPages';

const PLATFORM_LOGIN = '/user/auth/login';

/**
 * Taxi rider screens need the platform customer session (the same login Food and Quick Commerce
 * use). Signed-out visitors are sent to the platform login.
 */
export const UserProtectedRoute = () => {
  const navigate = useNavigate();
  const token = getLocalUserToken();

  useEffect(() => {
    if (!token) {
      navigate(PLATFORM_LOGIN, { replace: true });
    }
  }, [token, navigate]);

  if (!token) {
    return null;
  }

  return <Outlet />;
};

export const UserHomeRoute = () => {
  const navigate = useNavigate();
  const token = getLocalUserToken();

  useEffect(() => {
    if (!token) {
      navigate(PLATFORM_LOGIN, { replace: true });
    }
  }, [token, navigate]);

  if (!token) {
    return null;
  }

  return <UserHome />;
};

export default UserProtectedRoute;
