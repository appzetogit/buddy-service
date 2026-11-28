import React from "react";

/**
 * Seller login background: a green (brand) gradient with a storefront, shopping bags and two
 * "dashboard" cards. Pure SVG: sharp on every screen and needs no image file.
 */
const bag = (x, y, s, fill, rot = 0) => (
  <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${s})`}>
    <rect x="0" y="22" width="64" height="72" rx="10" fill={fill} />
    <path d="M18 30 V22 a14 14 0 0 1 28 0 V30" fill="none" stroke="#fff" strokeOpacity=".9" strokeWidth="5" strokeLinecap="round" />
    <rect x="0" y="22" width="64" height="72" rx="10" fill="url(#shine)" />
    <circle cx="32" cy="62" r="9" fill="#fff" fillOpacity=".9" />
    <path d="M27.5 62 l3.2 3.4 l6-6.8" fill="none" stroke="#16A34A" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
  </g>
);

const box = (x, y, s, rot = 0) => (
  <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${s})`}>
    <path d="M0 18 L40 0 L80 18 L80 62 L40 80 L0 62 Z" fill="#fff" fillOpacity=".95" />
    <path d="M0 18 L40 36 L80 18" fill="none" stroke="#16A34A" strokeOpacity=".55" strokeWidth="3" strokeLinejoin="round" />
    <path d="M40 36 V80" stroke="#16A34A" strokeOpacity=".55" strokeWidth="3" />
    <path d="M20 9 L60 27" stroke="#BBF7D0" strokeWidth="6" strokeLinecap="round" />
  </g>
);

export default function SellerLoginArt({ className = "" }) {
  return (
    <svg
      className={className}
      viewBox="0 0 800 900"
      preserveAspectRatio="xMidYMax slice"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="slBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#064E24" />
          <stop offset=".5" stopColor="#15803D" />
          <stop offset="1" stopColor="#22C55E" />
        </linearGradient>
        <linearGradient id="shine" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".28" />
          <stop offset=".55" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="slGlass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".28" />
          <stop offset="1" stopColor="#fff" stopOpacity=".1" />
        </linearGradient>
        <pattern id="slDots" width="30" height="30" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1.6" fill="#fff" fillOpacity=".28" />
        </pattern>
        <filter id="slBlur" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="14" stdDeviation="14" floodColor="#022c12" floodOpacity=".35" />
        </filter>
      </defs>

      <rect width="800" height="900" fill="url(#slBg)" />
      <rect width="800" height="520" fill="url(#slDots)" />
      <circle cx="710" cy="110" r="270" fill="#fff" fillOpacity=".07" />
      <circle cx="60" cy="780" r="320" fill="#fff" fillOpacity=".06" />
      <circle cx="430" cy="420" r="230" fill="#BBF7D0" fillOpacity=".07" />

      {/* illustration: desktop only (on a phone it would sit behind the company name) */}
      <g className="max-lg:hidden">
      {/* floating dashboard cards */}
      <g filter="url(#slBlur)">
        <rect x="70" y="120" width="236" height="104" rx="22" fill="url(#slGlass)" stroke="#fff" strokeOpacity=".45" />
        <text x="94" y="156" fill="#fff" fillOpacity=".85" fontSize="15" fontWeight="600">Today&apos;s sales</text>
        <text x="94" y="196" fill="#fff" fontSize="30" fontWeight="800">₹ 24,580</text>
        <g fill="#fff" fillOpacity=".85">
          <rect x="226" y="176" width="9" height="22" rx="3" />
          <rect x="241" y="164" width="9" height="34" rx="3" />
          <rect x="256" y="170" width="9" height="28" rx="3" />
          <rect x="271" y="150" width="9" height="48" rx="3" />
        </g>
      </g>
      <g filter="url(#slBlur)">
        <rect x="498" y="214" width="226" height="82" rx="22" fill="url(#slGlass)" stroke="#fff" strokeOpacity=".45" />
        <circle cx="540" cy="255" r="20" fill="#fff" />
        <path d="M531 255.5 l7 7 l13-14.5" fill="none" stroke="#16A34A" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        <text x="572" y="249" fill="#fff" fontSize="16" fontWeight="800">New order</text>
        <text x="572" y="273" fill="#fff" fillOpacity=".85" fontSize="14" fontWeight="500">#1024 · 3 items</text>
      </g>

      {/* storefront */}
      <ellipse cx="400" cy="858" rx="300" ry="26" fill="#022c12" fillOpacity=".28" />
      <g filter="url(#slBlur)">
        <rect x="200" y="640" width="400" height="206" rx="14" fill="#F0FDF4" />
        <rect x="224" y="676" width="108" height="104" rx="10" fill="#BBF7D0" />
        <rect x="224" y="676" width="108" height="104" rx="10" fill="url(#shine)" />
        <rect x="352" y="690" width="96" height="156" rx="10" fill="#15803D" />
        <circle cx="430" cy="770" r="5" fill="#fff" />
        <rect x="468" y="676" width="108" height="104" rx="10" fill="#BBF7D0" />
        <rect x="468" y="676" width="108" height="104" rx="10" fill="url(#shine)" />
        <rect x="242" y="738" width="30" height="42" rx="4" fill="#16A34A" />
        <rect x="280" y="722" width="30" height="58" rx="4" fill="#4ADE80" />
        <rect x="490" y="730" width="64" height="50" rx="6" fill="#16A34A" />
        {/* awning */}
        <path d="M184 640 L216 584 H584 L616 640 Z" fill="#fff" />
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <path key={i} d={`M${184 + i * 54} 640 L${216 + i * 46.5} 584 H${216 + (i + 1) * 46.5} L${184 + (i + 1) * 54} 640 Z`} fill={i % 2 ? "#fff" : "#16A34A"} />
        ))}
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <path key={`s${i}`} d={`M${184 + i * 54} 640 a27 24 0 0 0 54 0 Z`} fill={i % 2 ? "#fff" : "#16A34A"} />
        ))}
        <rect x="320" y="548" width="160" height="40" rx="12" fill="#064E24" />
        <text x="400" y="576" textAnchor="middle" fill="#fff" fontSize="22" fontWeight="800" letterSpacing="4">SHOP</text>
      </g>

      {/* bags, parcels and coin around the shop */}
      {bag(98, 690, 1.15, "#16A34A", -6)}
      {bag(612, 660, 1.3, "#22C55E", 7)}
      {bag(660, 752, 0.9, "#15803D", -4)}
      {box(120, 574, 1.05, -8)}
      {box(628, 514, 0.8, 10)}
      <g filter="url(#slBlur)">
        <circle cx="590" cy="400" r="40" fill="#FDE047" />
        <circle cx="590" cy="400" r="31" fill="none" stroke="#CA8A04" strokeOpacity=".6" strokeWidth="3" />
        <text x="590" y="413" textAnchor="middle" fill="#A16207" fontSize="36" fontWeight="800">₹</text>
      </g>
      </g>
    </svg>
  );
}
