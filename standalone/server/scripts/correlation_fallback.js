/**
 * Pure JavaScript statistical correlation engine.
 * Provides a 100% offline fallback for Pearson linear, Spearman rank,
 * Kendall tau, and quadratic polynomial analysis matching correlation.py.
 */

function formatP(p) {
  if (p === null || isNaN(p)) return 'N/A';
  if (p < 0.001) return '< 0.001';
  return p.toFixed(4);
}

// Student's t distribution two-tailed p-value approximation
function tPValue(t, df) {
  if (isNaN(t) || df <= 0) return 1.0;
  const absT = Math.abs(t);
  const x = df / (df + absT * absT);
  return Math.min(1.0, Math.max(0.0, ibeta(df / 2, 0.5, x)));
}

// Regularized incomplete beta function I_x(a, b)
function ibeta(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  if (x > (a + 1) / (a + b + 2)) {
    return 1 - ibeta(b, a, 1 - x);
  }

  const lbeta = lgamma(a) + lgamma(b) - lgamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lbeta) / a;

  const MAX_ITER = 200;
  const EPS = 1e-14;
  let f = 1.0, c = 1.0, d = 0.0;

  for (let m = 0; m <= MAX_ITER; m++) {
    let num;
    if (m === 0) {
      num = 1;
    } else {
      const k = m / 2;
      if (m % 2 === 0) {
        num = (k * (b - k) * x) / ((a + 2 * k - 1) * (a + 2 * k));
      } else {
        const k2 = (m - 1) / 2;
        num = -((a + k2) * (a + b + k2) * x) / ((a + 2 * k2) * (a + 2 * k2 + 1));
      }
    }

    d = 1.0 + num * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    d = 1.0 / d;

    c = 1.0 + num / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;

    const delta = c * d;
    f *= delta;
    if (Math.abs(delta - 1.0) < EPS) break;
  }

  return Math.min(1.0, Math.max(0.0, front * (f - 1.0)));
}

// Log gamma function (Lanczos approximation)
function lgamma(z) {
  const c = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.138571095836524,
    9.9843695780195716e-6,
    1.5056327351493116e-7
  ];
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
  }
  z -= 1;
  let x = c[0];
  for (let i = 1; i < c.length; i++) {
    x += c[i] / (z + i);
  }
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

// Standard normal complementary error function approximation for Kendall Tau p-value
function normalPValue(z) {
  const absZ = Math.abs(z);
  const p = 0.3275911;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const t = 1.0 / (1.0 + p * (absZ / Math.SQRT2));
  const erfc = (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-0.5 * absZ * absZ);
  return Math.min(1.0, Math.max(0.0, erfc));
}

// Ranking with tie averaging
function rankArray(arr) {
  const indexed = arr.map((val, idx) => ({ val, idx }));
  indexed.sort((a, b) => a.val - b.val);
  const ranks = new Array(arr.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j < indexed.length && indexed[j].val === indexed[i].val) {
      j++;
    }
    const avgRank = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) {
      ranks[indexed[k].idx] = avgRank;
    }
    i = j;
  }
  return ranks;
}

function analyzeDatasetJS(points, dsId, dsName, dsColor, xName, yName) {
  const valid = [];
  for (const pt of points) {
    const x = parseFloat(pt?.x);
    const y = parseFloat(pt?.y);
    if (!isNaN(x) && !isNaN(y) && isFinite(x) && isFinite(y)) {
      valid.push([x, y]);
    }
  }

  const n = valid.length;
  if (n < 3) {
    return {
      id: dsId,
      name: dsName,
      color: dsColor,
      n,
      hasEnoughData: false,
      message: `Sample size too small (n=${n}, minimum 3 required).`
    };
  }

  const xs = valid.map(p => p[0]);
  const ys = valid.map(p => p[1]);

  const xMean = xs.reduce((a, b) => a + b, 0) / n;
  const yMean = ys.reduce((a, b) => a + b, 0) / n;

  let ssXX = 0, ssYY = 0, ssXY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - xMean;
    const dy = ys[i] - yMean;
    ssXX += dx * dx;
    ssYY += dy * dy;
    ssXY += dx * dy;
  }

  if (ssXX === 0 || ssYY === 0) {
    return {
      id: dsId,
      name: dsName,
      color: dsColor,
      n,
      hasEnoughData: false,
      message: 'Zero variance detected in one or both variables (constant values).'
    };
  }

  // 1. Pearson Linear Correlation
  const r = Math.max(-1.0, Math.min(1.0, ssXY / Math.sqrt(ssXX * ssYY)));
  const r2Linear = r * r;
  const tStat = Math.abs(r) >= 1.0 ? 1e9 : r * Math.sqrt((n - 2) / (1 - r * r));
  const pPearson = tPValue(tStat, n - 2);

  // 95% Confidence Interval (Fisher z-transform)
  let ciLower = null, ciUpper = null;
  if (n > 3) {
    const clampedR = Math.max(-0.9999, Math.min(0.9999, r));
    const z = 0.5 * Math.log((1 + clampedR) / (1 - clampedR));
    const se = 1.0 / Math.sqrt(n - 3);
    const zLow = z - 1.96 * se;
    const zHigh = z + 1.96 * se;
    ciLower = Math.tanh(zLow);
    ciUpper = Math.tanh(zHigh);
  }

  // 2. Spearman Rank Non-Parametric Correlation
  const xRanks = rankArray(xs);
  const yRanks = rankArray(ys);
  const xrMean = (n + 1) / 2;
  const yrMean = (n + 1) / 2;
  let ssRXX = 0, ssRYY = 0, ssRXY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xRanks[i] - xrMean;
    const dy = yRanks[i] - yrMean;
    ssRXX += dx * dx;
    ssRYY += dy * dy;
    ssRXY += dx * dy;
  }
  const rho = (ssRXX > 0 && ssRYY > 0)
    ? Math.max(-1.0, Math.min(1.0, ssRXY / Math.sqrt(ssRXX * ssRYY)))
    : 0;
  const tStatRho = Math.abs(rho) >= 1.0 ? 1e9 : rho * Math.sqrt((n - 2) / Math.max(1e-9, 1 - rho * rho));
  const pSpearman = tPValue(tStatRho, n - 2);

  // 3. Kendall Tau Correlation
  let concordant = 0, discordant = 0, tX = 0, tY = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = xs[i] - xs[j];
      const dy = ys[i] - ys[j];
      if (dx === 0 && dy === 0) {
        // Both tied
      } else if (dx === 0) {
        tX++;
      } else if (dy === 0) {
        tY++;
      } else if ((dx > 0 && dy > 0) || (dx < 0 && dy < 0)) {
        concordant++;
      } else {
        discordant++;
      }
    }
  }
  const denom = Math.sqrt((concordant + discordant + tX) * (concordant + discordant + tY));
  const tau = denom > 0 ? (concordant - discordant) / denom : 0;
  const v0 = (4 * n + 10) / (9 * n * (n - 1));
  const zKendall = Math.abs(tau) / Math.sqrt(Math.max(1e-9, v0));
  const pKendall = normalPValue(zKendall);

  // 4. Polynomial Fit (Degree 2)
  let r2Poly = r2Linear;
  if (n >= 4) {
    try {
      let s0 = n, s1 = 0, s2 = 0, s3 = 0, s4 = 0;
      let sy = 0, sxy = 0, sx2y = 0;
      for (let i = 0; i < n; i++) {
        const x = xs[i], y = ys[i], x2 = x * x;
        s1 += x;
        s2 += x2;
        s3 += x2 * x;
        s4 += x2 * x2;
        sy += y;
        sxy += x * y;
        sx2y += x2 * y;
      }
      const M = [
        [s4, s3, s2, sx2y],
        [s3, s2, s1, sxy],
        [s2, s1, s0, sy]
      ];
      for (let i = 0; i < 3; i++) {
        let maxRow = i;
        for (let k = i + 1; k < 3; k++) {
          if (Math.abs(M[k][i]) > Math.abs(M[maxRow][i])) maxRow = k;
        }
        [M[i], M[maxRow]] = [M[maxRow], M[i]];
        if (Math.abs(M[i][i]) > 1e-12) {
          for (let k = i + 1; k < 3; k++) {
            const factor = M[k][i] / M[i][i];
            for (let j = i; j <= 3; j++) {
              M[k][j] -= factor * M[i][j];
            }
          }
        }
      }
      const cCoeff = M[2][3] / M[2][2];
      const bCoeff = (M[1][3] - M[1][2] * cCoeff) / M[1][1];
      const aCoeff = (M[0][3] - M[0][2] * cCoeff - M[0][1] * bCoeff) / M[0][0];

      let ssRes = 0, ssTot = 0;
      for (let i = 0; i < n; i++) {
        const yPred = aCoeff * xs[i] * xs[i] + bCoeff * xs[i] + cCoeff;
        ssRes += Math.pow(ys[i] - yPred, 2);
        ssTot += Math.pow(ys[i] - yMean, 2);
      }
      if (ssTot > 0) {
        r2Poly = Math.max(0.0, Math.min(1.0, 1.0 - (ssRes / ssTot)));
      }
    } catch (_) {}
  }
  const deltaR2 = Math.max(0.0, r2Poly - r2Linear);

  // 5. Interpretations and Badges (strictly matching correlation.py)
  let suggestedType = 'None';
  let badgeLabel = 'No Correlation';
  let badgeColor = 'gray';
  let interpretation = '';

  const bothNonSig = (pPearson > 0.05) && (pSpearman > 0.05);

  if (bothNonSig) {
    suggestedType = 'No Significant Correlation';
    badgeLabel = 'No Correlation (p > 0.05)';
    badgeColor = 'gray';
    interpretation = `Neither linear (p = ${formatP(pPearson)}) nor rank dependence (p = ${formatP(pSpearman)}) reached statistical significance at α = 0.05. No meaningful association between ${xName} and ${yName}.`;
  } else if (deltaR2 >= 0.15 && r2Poly >= 0.40) {
    suggestedType = 'Curvilinear / Non-Linear (Polynomial)';
    badgeLabel = `Curvilinear (Poly ΔR²=+${deltaR2.toFixed(2)})`;
    badgeColor = 'emerald';
    interpretation = `Curvilinear non-linear relationship detected: quadratic polynomial fit explains substantially more variance (R² = ${r2Poly.toFixed(3)}) than linear fit (R² = ${r2Linear.toFixed(3)}, ΔR² = +${deltaR2.toFixed(3)}). Consider polynomial modeling.`;
  } else if (Math.abs(rho) > Math.abs(r) + 0.10 && pSpearman <= 0.05) {
    const dirLabel = rho > 0 ? 'Positive' : 'Negative';
    suggestedType = `Non-Parametric Monotonic (${dirLabel})`;
    badgeLabel = `Monotonic Rank (${dirLabel})`;
    badgeColor = 'purple';
    interpretation = `Non-parametric rank dependence (Spearman ρ = ${rho.toFixed(3)}, p = ${formatP(pSpearman)}) is notably stronger than linear Pearson (r = ${r.toFixed(3)}). The variables exhibit a consistent monotonic relationship that departs from strict linearity.`;
  } else if (pPearson <= 0.05) {
    const dirLabel = r > 0 ? 'Positive' : 'Negative';
    const strLabel = Math.abs(r) >= 0.8 ? 'Strong' : (Math.abs(r) >= 0.5 ? 'Moderate' : 'Weak');
    suggestedType = `Linear (${strLabel} ${dirLabel})`;
    badgeLabel = `Linear (${strLabel} ${dirLabel})`;
    badgeColor = 'blue';
    const ciText = (ciLower !== null && ciUpper !== null) ? `[${ciLower.toFixed(3)}, ${ciUpper.toFixed(3)}]` : 'N/A';
    interpretation = `${strLabel} ${dirLabel.toLowerCase()} linear correlation (Pearson r = ${r.toFixed(3)}, p = ${formatP(pPearson)}, R² = ${r2Linear.toFixed(3)}). The 95% confidence interval for r is ${ciText}.`;
  } else {
    const dirLabel = rho > 0 ? 'Positive' : 'Negative';
    suggestedType = `Monotonic Trend (${dirLabel})`;
    badgeLabel = `Monotonic (${dirLabel})`;
    badgeColor = 'purple';
    interpretation = `Rank order relationship is significant (Spearman ρ = ${rho.toFixed(3)}, p = ${formatP(pSpearman)}), while linear Pearson correlation did not reach significance (p = ${formatP(pPearson)}).`;
  }

  const probLinear = Math.round(Math.max(0.0, Math.min(100.0, (1.0 - pPearson) * 100)) * 100) / 100;
  const probNonparametric = Math.round(Math.max(0.0, Math.min(100.0, (1.0 - pSpearman) * 100)) * 100) / 100;

  return {
    id: dsId,
    name: dsName,
    color: dsColor,
    n,
    hasEnoughData: true,
    pearsonR: Math.round(r * 10000) / 10000,
    pearsonP: Math.round(pPearson * 1000000) / 1000000,
    pearsonPFormatted: formatP(pPearson),
    rSquared: Math.round(r2Linear * 10000) / 10000,
    ci95: (ciLower !== null && ciUpper !== null)
      ? [Math.round(ciLower * 10000) / 10000, Math.round(ciUpper * 10000) / 10000]
      : null,
    probLinear,
    spearmanRho: Math.round(rho * 10000) / 10000,
    spearmanP: Math.round(pSpearman * 1000000) / 1000000,
    spearmanPFormatted: formatP(pSpearman),
    probNonParametric: probNonparametric,
    kendallTau: Math.round(tau * 10000) / 10000,
    kendallP: Math.round(pKendall * 1000000) / 1000000,
    kendallPFormatted: formatP(pKendall),
    polyR2: Math.round(r2Poly * 10000) / 10000,
    deltaR2: Math.round(deltaR2 * 10000) / 10000,
    suggestedType,
    badgeLabel,
    badgeColor,
    interpretation
  };
}

function calculateCorrelationJS(payload) {
  const datasets = payload.datasets || [];
  const xName = payload.xName || 'X Variable';
  const yName = payload.yName || 'Y Variable';

  const results = [];
  const combinedPoints = [];

  for (const ds of datasets) {
    const pts = ds.points || [];
    const dsResult = analyzeDatasetJS(
      pts,
      ds.id,
      ds.name || 'Dataset',
      ds.color || '#2563eb',
      xName,
      yName
    );
    results.push(dsResult);
    combinedPoints.push(...pts);
  }

  let combinedResult = null;
  if (datasets.length > 1 && combinedPoints.length >= 3) {
    combinedResult = analyzeDatasetJS(
      combinedPoints,
      'combined',
      'Pooled (All Datasets)',
      '#475569',
      xName,
      yName
    );
  }

  return {
    success: true,
    engine: 'javascript_fallback',
    xName,
    yName,
    datasets: results,
    combined: combinedResult
  };
}

module.exports = {
  calculateCorrelationJS,
  analyzeDatasetJS
};
