import type { JSX } from 'react';

/** A chain: the link is read hour by hour (readable without its word, Charles's rule of 21/11). */
export function Chain(): JSX.Element {
  return (
    <svg
      className="cl-chain"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" strokeLinecap="round" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" strokeLinecap="round" />
    </svg>
  );
}
