const SEATS = ["venice", "claude", "gpt", "grok", "gemini", "deepseek", "kimi", "qwen", "glm", "mistral"];

/** How a run moves: priced first, then the seats in parallel, then one judge, then one answer. */
export function Flow() {
  const sx = 322;
  const y0 = 34;
  const gap = 27;
  const ys = SEATS.map((_, i) => y0 + i * gap);
  const mid = ys[4] + gap / 2;
  return (
    <svg className="flow" viewBox="0 0 640 330" role="img" aria-label="Question, then a budget gate, then ten seats in parallel, then a judge, then one answer">
      {/* question */}
      <rect className="box" x="1" y={mid - 26} width="112" height="52" rx="10" />
      <text className="h" x="57" y={mid + 5} textAnchor="middle">question</text>
      <path className="ln" d={`M113 ${mid} H146`} />

      {/* gate */}
      <rect className="gate" x="146" y={mid - 40} width="132" height="80" rx="10" />
      <text className="h" x="212" y={mid - 10} textAnchor="middle">price it</text>
      <text x="212" y={mid + 10} textAnchor="middle">worst case</text>
      <text x="212" y={mid + 26} textAnchor="middle">≤ budget?</text>
      <path className="ln" d={`M212 ${mid + 40} V${mid + 80}`} strokeDasharray="3 3" />
      <text x="212" y={mid + 98} textAnchor="middle">no: nothing runs,</text>
      <text x="212" y={mid + 114} textAnchor="middle">nothing is paid</text>

      {/* fan out */}
      {ys.map((y) => (
        <path key={`o${y}`} className="ln" d={`M278 ${mid} C300 ${mid}, 300 ${y}, ${sx} ${y}`} />
      ))}
      {SEATS.map((s, i) => (
        <g key={s}>
          <rect className="bl" x={sx} y={ys[i] - 8} width="16" height="16" rx="3" opacity={0.55 + i * 0.045} />
          <text x={sx + 24} y={ys[i] + 4}>{s}</text>
        </g>
      ))}
      {/* fan in */}
      {ys.map((y) => (
        <path key={`i${y}`} className="ln" d={`M${sx + 86} ${y} C${sx + 112} ${y}, ${sx + 112} ${mid}, 452 ${mid}`} />
      ))}

      {/* judge and answer */}
      <rect className="box" x="452" y={mid - 26} width="96" height="52" rx="10" />
      <text className="h" x="500" y={mid + 5} textAnchor="middle">judge</text>
      <path className="ln" d={`M548 ${mid} H572`} />
      <rect className="gate" x="572" y={mid - 44} width="67" height="88" rx="10" />
      <text className="h" x="605" y={mid - 12} textAnchor="middle">one</text>
      <text className="h" x="605" y={mid + 6} textAnchor="middle">answer</text>
      <text x="605" y={mid + 26} textAnchor="middle">+ split</text>
    </svg>
  );
}
