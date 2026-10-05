import type { SVGProps } from 'react';

function Icon(props: SVGProps<SVGSVGElement>) {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false" {...props} />;
}

export const PlayIcon = () => (
  <Icon>
    <path d="M4 2.5v11a.5.5 0 0 0 .76.43l9-5.5a.5.5 0 0 0 0-.86l-9-5.5A.5.5 0 0 0 4 2.5Z" />
  </Icon>
);
export const PauseIcon = () => (
  <Icon>
    <rect x="3.5" y="2.5" width="3.2" height="11" rx="0.8" />
    <rect x="9.3" y="2.5" width="3.2" height="11" rx="0.8" />
  </Icon>
);
export const StopIcon = () => (
  <Icon>
    <rect x="3" y="3" width="10" height="10" rx="1.2" />
  </Icon>
);
export const LoopIcon = () => (
  <Icon fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7V6a2 2 0 0 1 2-2h7.5M10.5 1.8 12.7 4l-2.2 2.2M13 9v1a2 2 0 0 1-2 2H3.5M5.5 14.2 3.3 12l2.2-2.2" />
  </Icon>
);
export const CloseIcon = () => (
  <Icon fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
    <path d="m4 4 8 8M12 4l-8 8" />
  </Icon>
);
export const LockIcon = () => (
  <Icon width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="7" width="10" height="7" rx="1.5" />
    <path d="M5 7V5a3 3 0 0 1 6 0v2" />
  </Icon>
);
export const Logo = () => (
  <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <rect width="32" height="32" rx="7" fill="#0d1014" stroke="#2a323c" />
    <path d="M4 16h3l2-7 3 14 3-18 3 22 3-14 2 3h3" fill="none" stroke="#f0a13a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
