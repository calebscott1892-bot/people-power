import React from 'react';

export default function BarChart({ data, labelKey = 'label', valueKey = 'value', height = 160, barColor = '#3A3DFF' }) {
  if (!Array.isArray(data) || !data.length) return null;
  const max = Math.max(...data.map(d => d[valueKey]));
  return (
    <svg width="100%" height={height} viewBox={`0 0 400 ${height}`} style={{ width: '100%', height }}>
      {data.map((d, i) => {
        const barHeight = (d[valueKey] / max) * (height - 30);
        return (
          <g key={i}>
            <rect
              x={i * 50 + 20}
              y={height - barHeight - 20}
              width={32}
              height={barHeight}
              fill={barColor}
              rx={6}
            />
            <text
              x={i * 50 + 36}
              y={height - 5}
              textAnchor="middle"
              fontSize={12}
              fill="#444"
            >
              {d[labelKey]}
            </text>
            <text
              x={i * 50 + 36}
              y={height - barHeight - 28}
              textAnchor="middle"
              fontSize={12}
              fill="#222"
              fontWeight={700}
            >
              {d[valueKey]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
