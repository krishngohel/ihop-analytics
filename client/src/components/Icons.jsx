// Small stroke icons, drawn on a 24px grid. They inherit color from the text around them.
function Icon({ size = 18, children, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export const OverviewIcon = (p) => <Icon {...p}><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></Icon>;
export const HotspotIcon = (p) => <Icon {...p}><path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-1.8.8-3 1.8-4 .3 1.6 1.2 2.4 2 2.6C10.3 9 10.5 6 12 3z" /></Icon>;
export const RegionsIcon = (p) => <Icon {...p}><path d="M9 4 3 6.5v13.5L9 17.5l6 2.5 6-2.5V4l-6 2.5L9 4z" /><path d="M9 4v13.5M15 6.5V20" /></Icon>;
export const StoreIcon = (p) => <Icon {...p}><path d="M4 10v10h16V10" /><path d="M3 10 5 4h14l2 6a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0z" /><path d="M10 20v-5h4v5" /></Icon>;
export const SummaryIcon = (p) => <Icon {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></Icon>;
export const ForecastIcon = (p) => <Icon {...p}><path d="M3 20h18" /><path d="m4 15 5-5 4 3 7-8" /><path d="M15 5h5v5" /></Icon>;
export const DataIcon = (p) => <Icon {...p}><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" /><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></Icon>;
export const RefreshIcon = (p) => <Icon {...p}><path d="M20 11a8 8 0 0 0-14.5-4M4 13a8 8 0 0 0 14.5 4" /><path d="M5 3v4h4M19 21v-4h-4" /></Icon>;
export const SunIcon = (p) => <Icon {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Icon>;
export const MoonIcon = (p) => <Icon {...p}><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" /></Icon>;
export const SignOutIcon = (p) => <Icon {...p}><path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3" /><path d="m15 16 4-4-4-4M19 12H9" /></Icon>;
export const MenuIcon = (p) => <Icon {...p}><path d="M4 7h16M4 12h16M4 17h16" /></Icon>;
export const CheckIcon = (p) => <Icon {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></Icon>;
export const AlertIcon = (p) => <Icon {...p}><path d="M12 4 2.5 20h19L12 4z" /><path d="M12 10v4.5M12 17.5v.01" /></Icon>;
export const EyeIcon = (p) => <Icon {...p}><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></Icon>;
export const StarIcon = (p) => <Icon {...p}><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z" /></Icon>;
export const InfoIcon = (p) => <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 7.5v.01" /></Icon>;

export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round">
        <ellipse cx="12" cy="8" rx="8" ry="3" />
        <path d="M4 12.5c0 1.7 3.6 3 8 3s8-1.3 8-3M4 17c0 1.7 3.6 3 8 3s8-1.3 8-3" />
      </svg>
    </span>
  );
}

export function Brand({ className = "" }) {
  return (
    <span className={`brand ${className}`}>
      <BrandMark />
      <span className="brand-name"><strong>IHOP Operations</strong><span>Sales and labor</span></span>
    </span>
  );
}
