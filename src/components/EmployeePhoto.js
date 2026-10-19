'use client';

import { useState } from 'react';

// Shows the NAVER WORKS profile photo, falling back to the given content.
export default function EmployeePhoto({ empNo, fallback = null }) {
  const [failed, setFailed] = useState(false);
  if (!empNo || failed) return fallback;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/employees/photo?empNo=${encodeURIComponent(empNo)}`}
      alt=""
      onError={() => setFailed(true)}
      style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }}
    />
  );
}
