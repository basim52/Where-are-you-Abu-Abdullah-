import React from 'react';

export const Logo: React.FC<{ className?: string }> = ({ className }) => {
  return (
    <svg 
      viewBox="0 0 100 120" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg" 
      className={className}
    >
      {/* Map Pin Shape */}
      <path 
        d="M50 0C32.3 0 18 14.3 18 32C18 53.3 50 85 50 85C50 85 82 53.3 82 32C82 14.3 67.7 0 50 0Z" 
        fill="#3D2B1F" 
      />
      
      {/* White Circle Center */}
      <circle cx="50" cy="32" r="22" fill="white" />
      
      {/* Dish (Cloche) Icon */}
      <path 
        d="M38 40H62C62 40 62 30 50 30C38 30 38 40 38 40Z" 
        fill="#3D2B1F" 
      />
      <rect x="47" y="27" width="6" height="3" rx="1.5" fill="#3D2B1F" />
      <rect x="36" y="41" width="28" height="2" rx="1" fill="#3D2B1F" />

      {/* Coffee Cup Icon */}
      <path 
        d="M52 35L62 35L60 48C59.5 51 57 52 54 52L53 52C50 52 48.5 51 48 48L46 35H52Z" 
        fill="white" 
        stroke="#3D2B1F"
        strokeWidth="1.5"
      />
      <ellipse cx="54" cy="43.5" rx="2" ry="3" fill="#3D2B1F" transform="rotate(20, 54, 43.5)" />
      
      {/* Arabic Script Placeholder (Stylized Marks) */}
      <path d="M30 100Q40 90 50 100T70 100" stroke="#3D2B1F" strokeWidth="4" strokeLinecap="round" />
      <path d="M35 110Q45 105 55 115" stroke="#D4A373" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
};
