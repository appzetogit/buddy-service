import { useEffect, useState } from 'react';
import {
  Award, BellRing, Bike, Briefcase, Building, Building2, Car, CheckCircle2, Clock,
  Compass, DollarSign, FileText, Gift, Globe, GraduationCap, HardHat, Headphones,
  HeartHandshake, Image, MapPin, Navigation, PhoneCall, Plane, ShieldCheck, Shield,
  ShoppingBag, Smartphone, Sparkles, Stethoscope, TrendingUp, UserCheck, Users,
  UtensilsCrossed, Wallet,
} from 'lucide-react';
import api from '../../shared/api/axiosInstance';
import { LANDING_FALLBACK } from './landingFallback';

/**
 * CMS-backed content for the marketing site.
 *
 * Every section falls back to the hardcoded copy in landingFallback, so a slow
 * or failed request renders the full page rather than an empty one. The backend
 * applies the same per-section fallback, which means a half-filled document is
 * also safe.
 */

// The API stores an icon name; components cannot be serialised.
const ICONS = {
  Award, BellRing, Bike, Briefcase, Building, Building2, Car, CheckCircle2, Clock,
  Compass, DollarSign, FileText, Gift, Globe, GraduationCap, HardHat, Headphones,
  HeartHandshake, Image, MapPin, Navigation, PhoneCall, Plane, Shield, ShieldCheck,
  ShoppingBag, Smartphone, Stethoscope, TrendingUp, UserCheck, Users,
  UtensilsCrossed, Wallet,
};

const withIcons = (items = []) =>
  items.map((item) => ({ ...item, icon: ICONS[item.icon] || Sparkles }));

export { ICONS as LANDING_ICONS };

export default function useLandingContent() {
  const [content, setContent] = useState(LANDING_FALLBACK);
  const [source, setSource] = useState('fallback');

  useEffect(() => {
    let alive = true;

    api
      .get('/users/landing-content')
      .then((res) => {
        if (!alive) return;
        const data = res?.data?.data || res?.data;
        if (!data || typeof data !== 'object') return;

        setContent({
          services: data.services?.length ? data.services : LANDING_FALLBACK.services,
          valueProps: data.valueProps?.length ? data.valueProps : LANDING_FALLBACK.valueProps,
          drivers: data.drivers?.length ? data.drivers : LANDING_FALLBACK.drivers,
          partners: data.partners?.length ? data.partners : LANDING_FALLBACK.partners,
          launchCities: data.launchCities?.length ? data.launchCities : LANDING_FALLBACK.launchCities,
          contact: { ...LANDING_FALLBACK.contact, ...(data.contact || {}) },
          brand: { ...LANDING_FALLBACK.brand, ...(data.brand || {}) },
          hero: { ...LANDING_FALLBACK.hero, ...(data.hero || {}) },
          footer: { ...LANDING_FALLBACK.footer, ...(data.footer || {}) },
          seo: { ...LANDING_FALLBACK.seo, ...(data.seo || {}) },
          about: { ...LANDING_FALLBACK.about, ...(data.about || {}) },
          faqs: data.faqs?.length ? data.faqs : LANDING_FALLBACK.faqs,
          servicesPage: { ...LANDING_FALLBACK.servicesPage, ...(data.servicesPage || {}) },
          corporatePage: { ...LANDING_FALLBACK.corporatePage, ...(data.corporatePage || {}) },
          partnerPage: { ...LANDING_FALLBACK.partnerPage, ...(data.partnerPage || {}) },
          driverPage: { ...LANDING_FALLBACK.driverPage, ...(data.driverPage || {}) },
          advertisePage: { ...LANDING_FALLBACK.advertisePage, ...(data.advertisePage || {}) },
        });
        setSource('api');
      })
      .catch(() => {
        /* keep the fallback */
      });

    return () => {
      alive = false;
    };
  }, []);

  return {
    ...content,
    // resolved to components at the edge, so pages stay unaware of the mapping
    services: withIcons(content.services),
    valueProps: withIcons(content.valueProps),
    source,
  };
}
