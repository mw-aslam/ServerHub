const WIDTH = 200;
const HEIGHT = 36;
const MAX_POINTS = 40;

export function Sparkline({ values, label }: { values: (number | null)[]; label: string }) {
  const recent = values.slice(-MAX_POINTS);
  const known = recent.filter((value): value is number => value !== null);

  if (known.length < 2) {
    return <div className="h-9 text-xs leading-9 text-muted">График появится через минуту</div>;
  }

  const max = Math.max(...known, 1);
  const min = Math.min(...known);
  const span = Math.max(max - min, 1);
  const step = WIDTH / Math.max(recent.length - 1, 1);

  let path = '';
  let penDown = false;
  recent.forEach((value, index) => {
    if (value === null) {
      penDown = false;
      return;
    }
    const x = (index * step).toFixed(1);
    const y = (HEIGHT - 3 - ((value - min) / span) * (HEIGHT - 6)).toFixed(1);
    path += `${penDown ? 'L' : 'M'}${x} ${y}`;
    penDown = true;
  });

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className="block h-9 w-full"
    >
      <path
        d={path}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
