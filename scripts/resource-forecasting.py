#!/usr/bin/env python3

import os
import requests
import logging
import sys
import datetime
import time
import json
import pandas as pd
import numpy as np
import statsmodels.api as sm # Using statsmodels for simple linear regression

# --- Configuration ---
# Prometheus
PROMETHEUS_URL = os.getenv("PROMETHEUS_URL", "http://prometheus.homelab:9090")
# Historical data duration (e.g., '30d', '7d')
HISTORY_DURATION = os.getenv("HISTORY_DURATION", "30d")
# Step for Prometheus range query (e.g., '1h', '15m') - Balance granularity and performance
QUERY_STEP = os.getenv("QUERY_STEP", "1h")

# Forecasting
# How many days into the future to forecast
FORECAST_HORIZON_DAYS = int(os.getenv("FORECAST_HORIZON_DAYS", "7"))
# Thresholds for forecasted usage to trigger warnings/recommendations
FORECAST_CPU_WARN_THRESHOLD = float(os.getenv("FORECAST_CPU_WARN_THRESHOLD", "70")) # %
FORECAST_MEM_WARN_THRESHOLD = float(os.getenv("FORECAST_MEM_WARN_THRESHOLD", "75")) # %
FORECAST_DISK_WARN_THRESHOLD = float(os.getenv("FORECAST_DISK_WARN_THRESHOLD", "70")) # % (Root FS)

# Reporting
REPORT_DIR = os.getenv("REPORT_DIR", "./forecasting_reports")
TIMESTAMP_FORMAT = "%Y%m%d_%H%M%S"

# --- Logging Setup ---
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("ResourceForecaster")

# --- Helper Functions ---
def query_prometheus_range(query, duration, step):
    """Queries Prometheus range API."""
    api_endpoint = f"{PROMETHEUS_URL}/api/v1/query_range"
    end_time = time.time()
    # Convert duration string (like '30d') to seconds for start time calculation
    # This is a simplified parser, assumes 'd' for days, 'h' for hours, 'm' for minutes
    duration_seconds = 0
    if duration.endswith('d'):
        duration_seconds = int(duration[:-1]) * 86400
    elif duration.endswith('h'):
        duration_seconds = int(duration[:-1]) * 3600
    elif duration.endswith('m'):
        duration_seconds = int(duration[:-1]) * 60
    else:
        logger.error(f"Unsupported duration format: {duration}. Use 'd', 'h', or 'm'.")
        return None
    start_time = end_time - duration_seconds

    params = {
        'query': query,
        'start': start_time,
        'end': end_time,
        'step': step,
    }
    logger.info(f"Querying Prometheus Range API (duration={duration}, step={step}): {query}")
    try:
        response = requests.get(api_endpoint, params=params, timeout=120) # Longer timeout for range queries
        response.raise_for_status()
        result = response.json()
        if result['status'] == 'success':
            return result['data']['result']
        else:
            logger.error(f"Prometheus range query failed: {result.get('error', 'Unknown error')}")
            return None
    except requests.exceptions.RequestException as e:
        logger.error(f"Error connecting to Prometheus at {PROMETHEUS_URL}: {e}")
        return None
    except Exception as e:
        logger.error(f"An unexpected error occurred during Prometheus range query: {e}")
        return None

def process_prometheus_data(prom_results, metric_name):
    """Converts Prometheus range query results to a Pandas DataFrame."""
    data = []
    if not prom_results:
        logger.warning(f"No data received from Prometheus for {metric_name}.")
        return pd.DataFrame() # Return empty DataFrame

    for result in prom_results:
        # Use 'instance' label, remove port if present
        instance = result['metric'].get('instance', 'unknown').split(':')[0]
        values = result['values']
        for timestamp, value in values:
            try:
                 # Convert value to float, handle potential non-numeric values gracefully
                 numeric_value = float(value)
                 data.append({'timestamp': pd.to_datetime(timestamp, unit='s'), 'instance': instance, metric_name: numeric_value})
            except (ValueError, TypeError):
                 logger.warning(f"Skipping non-numeric value '{value}' for {metric_name} at timestamp {timestamp}")
                 continue


    if not data:
         logger.warning(f"No valid numeric data points found for {metric_name} after processing.")
         return pd.DataFrame()

    df = pd.DataFrame(data)
    df = df.set_index('timestamp')
    # Pivot to have instances as columns (optional, depends on analysis needs)
    # df_pivot = df.pivot(columns='instance', values=metric_name)
    return df

# --- Analysis & Forecasting ---
def analyze_and_forecast(df, metric_name, forecast_days):
    """Performs trend analysis and forecasting using linear regression."""
    forecasts = {}
    if df.empty or metric_name not in df.columns:
        logger.warning(f"DataFrame is empty or missing '{metric_name}' column. Skipping forecast.")
        return forecasts

    # Aggregate across all instances for overall trend, or analyze per instance
    # For simplicity, let's average across instances if multiple exist
    if 'instance' in df.columns:
         metric_series = df.groupby(df.index)[metric_name].mean()
         logger.info(f"Analyzing average {metric_name} across instances.")
    else:
         metric_series = df[metric_name]
         logger.info(f"Analyzing {metric_name} for single instance/aggregate.")


    # Prepare data for linear regression: time vs. value
    metric_series = metric_series.dropna() # Remove missing values
    if len(metric_series) < 10: # Need sufficient data points for regression
         logger.warning(f"Insufficient data points ({len(metric_series)}) for {metric_name} trend analysis. Skipping forecast.")
         return forecasts

    # Use seconds since the first timestamp as the independent variable (X)
    X = (metric_series.index - metric_series.index.min()).total_seconds()
    y = metric_series.values
    X = sm.add_constant(X) # Add intercept term

    try:
        # Fit Ordinary Least Squares (OLS) model
        model = sm.OLS(y, X)
        results = model.fit()
        logger.info(f"Linear Regression Summary for {metric_name}:\n{results.summary()}")

        # Forecast future values
        last_timestamp_sec = (metric_series.index.max() - metric_series.index.min()).total_seconds()
        forecast_end_sec = last_timestamp_sec + forecast_days * 86400
        # Create future time points (e.g., daily for forecast horizon)
        forecast_X_sec = np.linspace(last_timestamp_sec, forecast_end_sec, forecast_days + 1)
        forecast_X = sm.add_constant(forecast_X_sec)

        # Predict using the fitted model
        forecast_values = results.predict(forecast_X)

        # Store forecast results (e.g., forecast for the end date)
        forecasts['trend_slope'] = results.params[1] # Slope indicates increase/decrease per second
        forecasts['current_value'] = y[-1] # Last observed value
        forecasts['forecast_value_end'] = forecast_values[-1] # Forecasted value at the end of the horizon
        forecasts['forecast_period_days'] = forecast_days

        # Convert slope to per day for easier interpretation
        slope_per_day = results.params[1] * 86400
        logger.info(f"Forecast for {metric_name}: Current={y[-1]:.2f}, TrendSlope={slope_per_day:.4f}/day, ForecastEnd={forecast_values[-1]:.2f} in {forecast_days} days")

    except Exception as e:
        logger.error(f"Failed to perform regression/forecast for {metric_name}: {e}")

    return forecasts

# --- Reporting ---
def generate_recommendations(forecasts):
    """Generates recommendations based on forecast results."""
    recommendations = []

    # CPU Forecast
    if 'CPU' in forecasts:
        fc = forecasts['CPU']
        if fc.get('forecast_value_end', -1) > FORECAST_CPU_WARN_THRESHOLD:
            rec = (f"CPU usage forecast ({fc['forecast_value_end']:.1f}%) exceeds threshold ({FORECAST_CPU_WARN_THRESHOLD}%) "
                   f"in {fc['forecast_period_days']} days. Trend slope: {fc.get('trend_slope', 0)*86400:.2f}%/day. "
                   f"Recommendation: Investigate high CPU usage sources or consider scaling CPU resources.")
            recommendations.append({"resource": "CPU", "severity": "WARN", "message": rec})

    # Memory Forecast
    if 'Memory' in forecasts:
        fc = forecasts['Memory']
        if fc.get('forecast_value_end', -1) > FORECAST_MEM_WARN_THRESHOLD:
            rec = (f"Memory usage forecast ({fc['forecast_value_end']:.1f}%) exceeds threshold ({FORECAST_MEM_WARN_THRESHOLD}%) "
                   f"in {fc['forecast_period_days']} days. Trend slope: {fc.get('trend_slope', 0)*86400:.2f}%/day. "
                   f"Recommendation: Investigate memory usage patterns (leaks?) or consider adding RAM/adjusting limits.")
            recommendations.append({"resource": "Memory", "severity": "WARN", "message": rec})

    # Disk Forecast
    if 'Disk' in forecasts:
        fc = forecasts['Disk']
        if fc.get('forecast_value_end', -1) > FORECAST_DISK_WARN_THRESHOLD:
            rec = (f"Disk usage forecast ({fc['forecast_value_end']:.1f}%) exceeds threshold ({FORECAST_DISK_WARN_THRESHOLD}%) "
                   f"in {fc['forecast_period_days']} days. Trend slope: {fc.get('trend_slope', 0)*86400:.2f}%/day. "
                   f"Recommendation: Plan disk space cleanup (logs, images) or expand storage capacity.")
            recommendations.append({"resource": "Disk", "severity": "WARN", "message": rec})

    return recommendations

def generate_report(all_forecasts, recommendations):
    """Generates and saves the forecasting report."""
    logger.info("--- Generating Forecasting Report ---")
    report_timestamp = datetime.datetime.now().strftime(TIMESTAMP_FORMAT)
    report_filename = f"forecasting_report_{report_timestamp}.json"
    if not os.path.exists(REPORT_DIR):
        os.makedirs(REPORT_DIR)
    report_path = os.path.join(REPORT_DIR, report_filename)

    report_data = {
        "report_generated_at": datetime.datetime.now().isoformat(),
        "history_duration": HISTORY_DURATION,
        "query_step": QUERY_STEP,
        "forecast_horizon_days": FORECAST_HORIZON_DAYS,
        "forecasts": all_forecasts,
        "recommendations": recommendations
    }

    # Print Summary to Console
    logger.info("--- Forecasting Summary ---")
    for resource, fc in all_forecasts.items():
        logger.info(f"Resource: {resource}")
        logger.info(f"  Current Value: {fc.get('current_value', 'N/A'):.2f}")
        logger.info(f"  Trend Slope: {fc.get('trend_slope', 0)*86400:.4f} / day")
        logger.info(f"  Forecast ({fc.get('forecast_period_days', 'N/A')} days): {fc.get('forecast_value_end', 'N/A'):.2f}")

    if recommendations:
        logger.warning("Recommendations:")
        for rec in recommendations:
            logger.warning(f"  [{rec['severity']}] {rec['resource']}: {rec['message']}")
    else:
        logger.info("No immediate recommendations based on current forecasts and thresholds.")

    # Save Full Report JSON
    try:
        with open(report_path, 'w') as f:
            json.dump(report_data, f, indent=2)
        logger.info(f"Full forecasting report saved to: {report_path}")
    except Exception as e:
        logger.error(f"Failed to save forecasting report to {report_path}: {e}")

# --- Main Execution ---
def main():
    logger.info("=== Starting Resource Usage Forecasting ===")
    start_run_time = datetime.datetime.now()
    all_forecasts = {}

    # --- Define Queries ---
    # Average CPU Usage across all nodes (adjust if node-exporter labels differ)
    cpu_query = '100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)'
    # Average Memory Usage across all nodes
    mem_query = 'avg((1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100)'
    # Average Root Disk Usage across all nodes
    disk_query = 'avg((1 - (node_filesystem_avail_bytes{mountpoint="/",fstype!="tmpfs"} / node_filesystem_size_bytes{mountpoint="/",fstype!="tmpfs"})) * 100)'

    queries = {
        "CPU": cpu_query,
        "Memory": mem_query,
        "Disk": disk_query,
    }

    # --- Collect & Analyze Data ---
    for name, query in queries.items():
        logger.info(f"--- Processing Metric: {name} ---")
        prom_data = query_prometheus_range(query, HISTORY_DURATION, QUERY_STEP)
        df = process_prometheus_data(prom_data, name)
        if not df.empty:
            forecast_result = analyze_and_forecast(df, name, FORECAST_HORIZON_DAYS)
            if forecast_result:
                 all_forecasts[name] = forecast_result
        else:
             logger.warning(f"Skipping forecast for {name} due to lack of data.")


    # --- Generate Recommendations & Report ---
    recommendations = generate_recommendations(all_forecasts)
    generate_report(all_forecasts, recommendations)

    end_run_time = datetime.datetime.now()
    run_duration = end_run_time - start_run_time
    logger.info(f"Forecasting run finished in {run_duration}.")
    logger.info("=== Resource Usage Forecasting Finished ===")

if __name__ == "__main__":
    # --- Dependency Check ---
    try:
        import pandas
        import numpy
        import statsmodels
        import requests
    except ImportError as e:
        logger.critical(f"Missing required Python library: {e.name}. Please install it.")
        logger.critical("Required: pandas, numpy, statsmodels, requests")
        sys.exit(2)

    # --- Check Prometheus Connection ---
    logger.info("Checking Prometheus connection...")
    try:
         # Simple query to test connection
         if requests.get(f"{PROMETHEUS_URL}/api/v1/query", params={'query': 'vector(1)'}, timeout=10).status_code != 200:
              raise ConnectionError("Failed to get successful response from Prometheus.")
         logger.info("Prometheus connection successful.")
    except Exception as e:
         logger.critical(f"Failed to connect to Prometheus at {PROMETHEUS_URL}: {e}")
         logger.critical("Ensure Prometheus is running and accessible.")
         sys.exit(3)

    main()

# --- Scheduling Notes ---
#
# This script can be run periodically (e.g., weekly or monthly) as a Kubernetes CronJob or systemd timer.
#
# 1.  **Containerization:**
#     - Create Dockerfile based on Python.
#     - Install dependencies: `pandas`, `numpy`, `statsmodels`, `requests`.
#     - COPY script into image.
#     - Set ENTRYPOINT/CMD.
#
# 2.  **Kubernetes CronJob:**
#     - Define `CronJob` resource.
#     - Set schedule (e.g., `0 3 * * 0` for 3 AM Sunday).
#     - Use the container image.
#     - Configure environment variables (PROMETHEUS_URL, thresholds, etc.).
#     - Mount a PVC for storing reports (`REPORT_DIR`).
#     - Set resource limits/requests (forecasting can be memory/CPU intensive).
#     - Set `concurrencyPolicy: Forbid`.
#
# 3.  **Improvements:**
#     - **More Sophisticated Models:** Replace linear regression with ARIMA, SARIMA, or Prophet (requires `prophet` library) for potentially better forecasts, especially with seasonality.
#     - **Per-Node Analysis:** Modify data processing and analysis to forecast for individual nodes instead of just the average.
#     - **Capacity Input:** Instead of fixed thresholds, query Prometheus for node capacity (total CPU cores, total memory) to calculate forecasted utilization percentage more accurately.
#     - **Alerting Integration:** Push recommendations or critical forecast warnings to Alertmanager or other notification systems.
#     - **Visualization:** Generate plots of historical data, trend lines, and forecasts (requires `matplotlib` or `seaborn`).
