import React from 'react';
import { ChevronRight } from 'lucide-react';
import { useNavigate } from '@taxi/shared/router';
import AutomaticSurgePanel from './AutomaticSurgePanel';

/// Surge pricing. Fares rise automatically, area by area, when riders
/// outnumber free drivers - see AutomaticSurgePanel. The fixed time slots this
/// page used to hold are retired: surge now follows demand only.
const PriceHike = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#F8FDFA] p-3 lg:p-4 font-sans">
      <div className="mb-4 border-b border-gray-100 pb-2">
        <h1 className="text-xl font-bold text-[#1E293B]">Price Hike</h1>
        <div className="flex items-center gap-1.5 text-[11px] text-gray-400 mt-1 font-medium">
          <span
            className="cursor-pointer hover:text-green-600 transition-colors"
            onClick={() => navigate('/admin/pricing/set-price')}
          >
            Pricing
          </span>
          <ChevronRight size={10} />
          <span className="text-slate-800 font-bold uppercase">Surge Pricing</span>
        </div>
      </div>

      <AutomaticSurgePanel />

      <p className="text-[11px] text-gray-500">
        While an area is surging, every vehicle&apos;s base fare, per-km rate and per-minute rate
        there are multiplied. Distance and time allowances, taxes and commissions are not changed.
      </p>
    </div>
  );
};

export default PriceHike;
