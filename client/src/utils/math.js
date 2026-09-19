// Statistical & Mathematical Modeling Utility for Patient QA Analytics

export function calculateStats(numbers) {
  if (!numbers || numbers.length === 0) {
    return { count: 0, mean: 0, stdDev: 0, min: 0, max: 0, median: 0, range: 0 };
  }
  const sorted = [...numbers].sort((a, b) => a - b);
  const count = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / count;
  const variance = sorted.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / count;
  const stdDev = Math.sqrt(variance);
  const min = sorted[0];
  const max = sorted[count - 1];
  const median = count % 2 === 0
    ? (sorted[count / 2 - 1] + sorted[count / 2]) / 2
    : sorted[Math.floor(count / 2)];

  return {
    count,
    mean: Math.round(mean * 1000) / 1000,
    stdDev: Math.round(stdDev * 1000) / 1000,
    min: Math.round(min * 1000) / 1000,
    max: Math.round(max * 1000) / 1000,
    median: Math.round(median * 1000) / 1000,
    range: Math.round((max - min) * 1000) / 1000
  };
}

export function computeLinearRegression(points, isDateX = false) {
  if (!points || points.length < 2) return null;

  const valid = points.filter(p => typeof p.x === 'number' && !isNaN(p.x) && typeof p.y === 'number' && !isNaN(p.y));
  const n = valid.length;
  if (n < 2) return null;

  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += valid[i].x;
    sumY += valid[i].y;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let num = 0;
  let den = 0;
  let ssY = 0;
  for (let i = 0; i < n; i++) {
    const dx = valid[i].x - meanX;
    const dy = valid[i].y - meanY;
    num += dx * dy;
    den += dx * dx;
    ssY += dy * dy;
  }

  if (den === 0) return null;

  const slope = num / den;
  const intercept = meanY - slope * meanX;
  const r2 = ssY === 0 ? 1 : Math.min(1, Math.max(0, (num * num) / (den * ssY)));

  const sortedByX = [...valid].sort((a, b) => a.x - b.x);
  const minX = sortedByX[0].x;
  const maxX = sortedByX[n - 1].x;

  let formattedRate = '';
  if (isDateX) {
    // slope is per millisecond; convert to rate per 30 days
    const ratePerMonth = slope * (30 * 24 * 60 * 60 * 1000);
    formattedRate = `${ratePerMonth >= 0 ? '+' : ''}${ratePerMonth.toFixed(3)} / month`;
  } else {
    formattedRate = `${slope >= 0 ? '+' : ''}${slope.toFixed(4)} / unit`;
  }

  return {
    slope,
    intercept,
    r2: Math.round(r2 * 1000) / 1000,
    formattedRate,
    equation: `y = ${slope.toFixed(3)}x + ${intercept.toFixed(2)}`,
    trendPoints: [
      { x: minX, y: slope * minX + intercept },
      { x: maxX, y: slope * maxX + intercept }
    ]
  };
}

export function computePolynomialRegression(points, order = 2, isDateX = false) {
  if (!points || points.length < 2) return null;

  const valid = [...points]
    .filter(p => typeof p.x === 'number' && !isNaN(p.x) && typeof p.y === 'number' && !isNaN(p.y))
    .sort((a, b) => a.x - b.x);

  const n = valid.length;
  const deg = Math.max(1, Math.min(6, parseInt(order, 10) || 2));
  if (n < deg + 1) return null;

  // Normalize x values to prevent numerical instability with large numbers (e.g. millisecond timestamps)
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += valid[i].x;
    sumY += valid[i].y;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let varX = 0;
  for (let i = 0; i < n; i++) {
    const diff = valid[i].x - meanX;
    varX += diff * diff;
  }
  const stdX = Math.sqrt(varX / n) || 1;

  // Build Vandermonde normal equations on standardized u = (x - meanX) / stdX
  const m = deg + 1;
  const A = Array.from({ length: m }, () => new Float64Array(m));
  const B = new Float64Array(m);

  // Precompute power sums of u
  const uPowers = new Float64Array(2 * deg + 1);
  for (let i = 0; i < n; i++) {
    const u = (valid[i].x - meanX) / stdX;
    let up = 1;
    for (let p = 0; p <= 2 * deg; p++) {
      uPowers[p] += up;
      if (p < m) {
        B[p] += up * valid[i].y;
      }
      up *= u;
    }
  }

  for (let r = 0; r < m; r++) {
    for (let c = 0; c < m; c++) {
      A[r][c] = uPowers[r + c];
    }
  }

  // Gaussian elimination with partial pivoting
  for (let i = 0; i < m; i++) {
    let maxRow = i;
    for (let k = i + 1; k < m; k++) {
      if (Math.abs(A[k][i]) > Math.abs(A[maxRow][i])) {
        maxRow = k;
      }
    }
    const tempA = A[i];
    A[i] = A[maxRow];
    A[maxRow] = tempA;

    const tempB = B[i];
    B[i] = B[maxRow];
    B[maxRow] = tempB;

    if (Math.abs(A[i][i]) < 1e-12) return null;

    for (let k = i + 1; k < m; k++) {
      const factor = A[k][i] / A[i][i];
      for (let j = i; j < m; j++) {
        A[k][j] -= factor * A[i][j];
      }
      B[k] -= factor * B[i];
    }
  }

  // Back substitution
  const coeffs = new Float64Array(m);
  for (let i = m - 1; i >= 0; i--) {
    let sum = B[i];
    for (let j = i + 1; j < m; j++) {
      sum -= A[i][j] * coeffs[j];
    }
    coeffs[i] = sum / A[i][i];
  }

  const evalPoly = (xVal) => {
    const u = (xVal - meanX) / stdX;
    let res = 0;
    let up = 1;
    for (let p = 0; p < m; p++) {
      res += coeffs[p] * up;
      up *= u;
    }
    return res;
  };

  // Compute R2
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const yHat = evalPoly(valid[i].x);
    const dy = valid[i].y - meanY;
    const res = valid[i].y - yHat;
    ssTot += dy * dy;
    ssRes += res * res;
  }
  const r2 = ssTot > 0 ? Math.max(0, Math.min(1, 1 - ssRes / ssTot)) : 1;

  // Generate smooth trend points
  const minX = valid[0].x;
  const maxX = valid[n - 1].x;
  const numSteps = Math.min(80, Math.max(20, n * 2));
  const step = (maxX - minX) / (numSteps - 1);

  const trendPoints = [];
  for (let s = 0; s < numSteps; s++) {
    const curX = minX + s * step;
    trendPoints.push({
      x: curX,
      y: Math.round(evalPoly(curX) * 1000) / 1000
    });
  }

  return {
    order: deg,
    r2: Math.round(r2 * 1000) / 1000,
    equation: `Polynomial (Order ${deg})`,
    formattedRate: `Poly (d=${deg})`,
    trendPoints
  };
}


export function computeMovingAverage(points, windowSize = 5) {
  if (!points || points.length < windowSize) return [];

  const valid = [...points]
    .filter(p => typeof p.x === 'number' && !isNaN(p.x) && typeof p.y === 'number' && !isNaN(p.y))
    .sort((a, b) => a.x - b.x);

  const result = [];
  const k = Math.max(2, Math.min(windowSize, valid.length));

  for (let i = k - 1; i < valid.length; i++) {
    let sum = 0;
    for (let j = i - k + 1; j <= i; j++) {
      sum += valid[j].y;
    }
    result.push({
      x: valid[i].x,
      y: Math.round((sum / k) * 1000) / 1000
    });
  }

  return result;
}

export function computeBoxPlotStats(numbers) {
  if (!numbers || numbers.length === 0) return null;
  const valid = numbers.filter(v => typeof v === 'number' && !isNaN(v)).sort((a, b) => a - b);
  const n = valid.length;
  if (n === 0) return null;

  const min = valid[0];
  const max = valid[n - 1];

  const getPercentile = (p) => {
    const pos = (n - 1) * p;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (valid[base + 1] !== undefined) {
      return valid[base] + rest * (valid[base + 1] - valid[base]);
    }
    return valid[base];
  };

  const q1 = getPercentile(0.25);
  const median = getPercentile(0.5);
  const q3 = getPercentile(0.75);
  const iqr = q3 - q1;

  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;

  // Whiskers: lowest/highest values within the fences
  const nonOutliers = valid.filter(v => v >= lowerFence && v <= upperFence);
  const lowerWhisker = nonOutliers.length > 0 ? nonOutliers[0] : min;
  const upperWhisker = nonOutliers.length > 0 ? nonOutliers[nonOutliers.length - 1] : max;

  const outliers = valid.filter(v => v < lowerFence || v > upperFence);
  const sum = valid.reduce((acc, v) => acc + v, 0);
  const mean = sum / n;

  return {
    n,
    min: Math.round(min * 1000) / 1000,
    max: Math.round(max * 1000) / 1000,
    q1: Math.round(q1 * 1000) / 1000,
    median: Math.round(median * 1000) / 1000,
    q3: Math.round(q3 * 1000) / 1000,
    iqr: Math.round(iqr * 1000) / 1000,
    mean: Math.round(mean * 1000) / 1000,
    lowerWhisker: Math.round(lowerWhisker * 1000) / 1000,
    upperWhisker: Math.round(upperWhisker * 1000) / 1000,
    outliers: outliers.map(v => Math.round(v * 1000) / 1000)
  };
}

