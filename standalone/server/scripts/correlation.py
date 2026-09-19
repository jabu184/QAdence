import sys
import json
import math

try:
    import numpy as np
    from scipy import stats
except ImportError as e:
    sys.stderr.write(f"Error importing numpy/scipy: {e}\n")
    sys.exit(1)


def format_p(p):
    if p is None or math.isnan(p):
        return "N/A"
    if p < 0.001:
        return "< 0.001"
    return f"{p:.4f}"


def analyze_dataset(points, ds_id, ds_name, ds_color, x_name, y_name):
    # Filter valid pairs
    valid = []
    for pt in points:
        x = pt.get("x")
        y = pt.get("y")
        if x is not None and y is not None:
            try:
                xf = float(x)
                yf = float(y)
                if not (math.isnan(xf) or math.isinf(xf) or math.isnan(yf) or math.isinf(yf)):
                    valid.append((xf, yf))
            except (ValueError, TypeError):
                continue

    n = len(valid)
    if n < 3:
        return {
            "id": ds_id,
            "name": ds_name,
            "color": ds_color,
            "n": n,
            "hasEnoughData": False,
            "message": f"Sample size too small (n={n}, minimum 3 required)."
        }

    x_arr = np.array([p[0] for p in valid], dtype=np.float64)
    y_arr = np.array([p[1] for p in valid], dtype=np.float64)

    # Check for zero variance
    x_var = float(np.var(x_arr))
    y_var = float(np.var(y_arr))
    if x_var == 0 or y_var == 0:
        return {
            "id": ds_id,
            "name": ds_name,
            "color": ds_color,
            "n": n,
            "hasEnoughData": False,
            "message": "Zero variance detected in one or both variables (constant values)."
        }

    # 1. Pearson Linear Correlation
    pearson_res = stats.pearsonr(x_arr, y_arr)
    r = float(pearson_res.statistic)
    p_pearson = float(pearson_res.pvalue)
    r2_linear = r ** 2

    # Confidence interval for Pearson r (95%)
    ci_lower = None
    ci_upper = None
    try:
        ci = pearson_res.confidence_interval(confidence_level=0.95)
        ci_lower = float(ci.low)
        ci_upper = float(ci.high)
    except Exception:
        # Fallback manual Fisher z transform
        try:
            z = np.arctanh(np.clip(r, -0.9999, 0.9999))
            se = 1.0 / np.sqrt(n - 3)
            ci_lower = float(np.tanh(z - 1.96 * se))
            ci_upper = float(np.tanh(z + 1.96 * se))
        except Exception:
            pass

    # 2. Spearman Rank Non-Parametric Correlation
    spearman_res = stats.spearmanr(x_arr, y_arr)
    rho = float(spearman_res.statistic)
    p_spearman = float(spearman_res.pvalue)

    # 3. Kendall Tau Non-Parametric Correlation
    kendall_res = stats.kendalltau(x_arr, y_arr)
    tau = float(kendall_res.statistic)
    p_kendall = float(kendall_res.pvalue)

    # 4. Polynomial Fit (degree 2) comparison
    r2_poly = r2_linear
    try:
        if n >= 4:
            poly_coeffs = np.polyfit(x_arr, y_arr, deg=2)
            p_fitted = np.polyval(poly_coeffs, x_arr)
            ss_res = np.sum((y_arr - p_fitted) ** 2)
            ss_tot = np.sum((y_arr - np.mean(y_arr)) ** 2)
            if ss_tot > 0:
                r2_poly = float(max(0.0, min(1.0, 1.0 - (ss_res / ss_tot))))
    except Exception:
        pass

    delta_r2 = max(0.0, r2_poly - r2_linear)

    # 5. Determine Suggested Correlation Type & Clinical QA Interpretation
    suggested_type = "None"
    badge_label = "No Correlation"
    badge_color = "gray"
    interpretation = ""

    both_non_sig = (p_pearson > 0.05) and (p_spearman > 0.05)

    if both_non_sig:
        suggested_type = "No Significant Correlation"
        badge_label = "No Correlation (p > 0.05)"
        badge_color = "gray"
        interpretation = (
            f"Neither linear (p = {format_p(p_pearson)}) nor rank dependence (p = {format_p(p_spearman)}) "
            f"reached statistical significance at α = 0.05. No meaningful association between {x_name} and {y_name}."
        )
    elif delta_r2 >= 0.15 and r2_poly >= 0.40:
        suggested_type = "Curvilinear / Non-Linear (Polynomial)"
        badge_label = f"Curvilinear (Poly ΔR²=+{delta_r2:.2f})"
        badge_color = "emerald"
        interpretation = (
            f"Curvilinear non-linear relationship detected: quadratic polynomial fit explains substantially more variance "
            f"(R² = {r2_poly:.3f}) than linear fit (R² = {r2_linear:.3f}, ΔR² = +{delta_r2:.3f}). Consider polynomial modeling."
        )
    elif abs(rho) > abs(r) + 0.10 and p_spearman <= 0.05:
        dir_label = "Positive" if rho > 0 else "Negative"
        suggested_type = f"Non-Parametric Monotonic ({dir_label})"
        badge_label = f"Monotonic Rank ({dir_label})"
        badge_color = "purple"
        interpretation = (
            f"Non-parametric rank dependence (Spearman ρ = {rho:.3f}, p = {format_p(p_spearman)}) is notably stronger than linear "
            f"Pearson (r = {r:.3f}). The variables exhibit a consistent monotonic relationship that departs from strict linearity."
        )
    elif p_pearson <= 0.05:
        dir_label = "Positive" if r > 0 else "Negative"
        str_label = "Strong" if abs(r) >= 0.8 else ("Moderate" if abs(r) >= 0.5 else "Weak")
        suggested_type = f"Linear ({str_label} {dir_label})"
        badge_label = f"Linear ({str_label} {dir_label})"
        badge_color = "blue"
        ci_text = f"[{ci_lower:.3f}, {ci_upper:.3f}]" if (ci_lower is not None and ci_upper is not None) else "N/A"
        interpretation = (
            f"{str_label} {dir_label.lower()} linear correlation (Pearson r = {r:.3f}, p = {format_p(p_pearson)}, R² = {r2_linear:.3f}). "
            f"The 95% confidence interval for r is {ci_text}."
        )
    else:
        # Spearman is significant but Pearson is not
        dir_label = "Positive" if rho > 0 else "Negative"
        suggested_type = f"Monotonic Trend ({dir_label})"
        badge_label = f"Monotonic ({dir_label})"
        badge_color = "purple"
        interpretation = (
            f"Rank order relationship is significant (Spearman ρ = {rho:.3f}, p = {format_p(p_spearman)}), "
            f"while linear Pearson correlation did not reach significance (p = {format_p(p_pearson)})."
        )

    # Probability of correlation factor: (1 - p_value) expressed as a percentage
    prob_linear = round(max(0.0, min(100.0, (1.0 - p_pearson) * 100)), 2)
    prob_nonparametric = round(max(0.0, min(100.0, (1.0 - p_spearman) * 100)), 2)

    return {
        "id": ds_id,
        "name": ds_name,
        "color": ds_color,
        "n": n,
        "hasEnoughData": True,
        # Linear (Pearson)
        "pearsonR": round(r, 4),
        "pearsonP": round(p_pearson, 6),
        "pearsonPFormatted": format_p(p_pearson),
        "rSquared": round(r2_linear, 4),
        "ci95": [round(ci_lower, 4), round(ci_upper, 4)] if (ci_lower is not None and ci_upper is not None) else None,
        "probLinear": prob_linear,
        # Non-parametric (Spearman & Kendall)
        "spearmanRho": round(rho, 4),
        "spearmanP": round(p_spearman, 6),
        "spearmanPFormatted": format_p(p_spearman),
        "probNonParametric": prob_nonparametric,
        "kendallTau": round(tau, 4),
        "kendallP": round(p_kendall, 6),
        "kendallPFormatted": format_p(p_kendall),
        # Polynomial fit
        "polyR2": round(r2_poly, 4),
        "deltaR2": round(delta_r2, 4),
        # Suggested classification & narrative
        "suggestedType": suggested_type,
        "badgeLabel": badge_label,
        "badgeColor": badge_color,
        "interpretation": interpretation
    }


def main():
    try:
        raw_input = sys.stdin.read()
        if not raw_input.strip():
            print(json.dumps({"error": "Empty input"}))
            return

        payload = json.loads(raw_input)
        datasets = payload.get("datasets", [])
        x_name = payload.get("xName", "X Variable")
        y_name = payload.get("yName", "Y Variable")

        results = []
        combined_points = []

        for ds in datasets:
            pts = ds.get("points", [])
            ds_result = analyze_dataset(
                pts,
                ds.get("id"),
                ds.get("name", "Dataset"),
                ds.get("color", "#2563eb"),
                x_name,
                y_name
            )
            results.append(ds_result)
            combined_points.extend(pts)

        combined_result = None
        if len(datasets) > 1 and len(combined_points) >= 3:
            combined_result = analyze_dataset(
                combined_points,
                "combined",
                "Pooled (All Datasets)",
                "#475569",
                x_name,
                y_name
            )

        output = {
            "success": True,
            "xName": x_name,
            "yName": y_name,
            "datasets": results,
            "combined": combined_result
        }
        print(json.dumps(output))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))


if __name__ == "__main__":
    main()
