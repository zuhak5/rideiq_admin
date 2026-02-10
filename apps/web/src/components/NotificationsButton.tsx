import React from 'react';
import { Link } from 'react-router-dom';

export default function NotificationsButton({ count, to }: { count: number; to: string }) {
  return (
    <Link to={to} className="btn relative" aria-label={count > 0 ? `Notifications (${count} unread)` : 'Notifications'}>
      <BellIcon />
      {count > 0 ? (
        <span className="absolute -right-1 -top-1 inline-flex min-w-[18px] items-center justify-center rounded-full bg-black px-1.5 py-0.5 text-[10px] font-semibold text-white">
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </Link>
  );
}

function BellIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 8a6 6 0 10-12 0c0 7-3 8-3 8h18s-3-1-3-8" />
      <path d="M13.73 21a2 2 0 01-3.46 0" />
    </svg>
  );
}
