#!/usr/bin/env python3

import os
import logging
import sys
import json

# --- Configuration ---
# PostgreSQL Connection Details
PG_HOST = os.getenv("PG_HOST")
PG_PORT = os.getenv("PG_PORT", "5432")
PG_USER = os.getenv("PG_USER")
PG_PASSWORD = os.getenv("PG_PASSWORD") # Consider K8s secrets or other secure methods
PG_DATABASE = os.getenv("PG_DATABASE") # Target database for analysis

# Analysis Parameters
SLOW_QUERY_THRESHOLD_MS = int(os.getenv("SLOW_QUERY_THRESHOLD_MS", "100")) # Queries longer than this are flagged
TOP_N_SLOW_QUERIES = int(os.getenv("TOP_N_SLOW_QUERIES", "10"))
MIN_SEQ_SCANS_FOR_INDEX_REC = int(os.getenv("MIN_SEQ_SCANS_FOR_INDEX_REC", "100")) # Min seq scans to suggest index

# --- Logging Setup ---
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("DBPerformanceAnalyzer")

# --- Database Interaction ---
try:
    import psycopg2
    from psycopg2.extras import DictCursor
except ImportError:
    logger.critical("Missing required Python library: psycopg2. Please install it (`pip install psycopg2-binary`).")
    sys.exit(2)

def get_db_connection():
    """Establishes a connection to the PostgreSQL database."""
    if not all([PG_HOST, PG_USER, PG_PASSWORD, PG_DATABASE]):
        logger.error("PostgreSQL connection details incomplete. Skipping analysis.")
        return None
    try:
        conn = psycopg2.connect(
            host=PG_HOST,
            port=PG_PORT,
            user=PG_USER,
            password=PG_PASSWORD,
            dbname=PG_DATABASE,
            connect_timeout=10
        )
        logger.info(f"Successfully connected to PostgreSQL database '{PG_DATABASE}' on {PG_HOST}.")
        return conn
    except psycopg2.OperationalError as e:
        logger.error(f"Failed to connect to PostgreSQL: {e}")
        return None
    except Exception as e:
        logger.error(f"An unexpected error occurred during DB connection: {e}")
        return None

def execute_query(conn, query, params=None):
    """Executes a SQL query and returns results."""
    results = []
    try:
        with conn.cursor(cursor_factory=DictCursor) as cur:
            cur.execute(query, params)
            if cur.description: # Check if the query returns rows
                results = cur.fetchall()
    except psycopg2.Error as e:
        logger.error(f"Database query failed: {e}")
        logger.error(f"Query: {query}")
        # Optionally rollback if it was a transaction, though these are read queries
        # conn.rollback()
    return results

# --- Analysis Functions ---

def check_pg_stat_statements(conn):
    """Checks if pg_stat_statements extension is enabled."""
    logger.info("Checking for pg_stat_statements extension...")
    query = "SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements';"
    result = execute_query(conn, query)
    if result:
        logger.info("pg_stat_statements extension is enabled.")
        return True
    else:
        logger.warning("pg_stat_statements extension is NOT enabled.")
        logger.warning("Enable it for detailed query performance analysis: CREATE EXTENSION IF NOT EXISTS pg_stat_statements;")
        return False

def analyze_slow_queries(conn):
    """Identifies slow queries using pg_stat_statements."""
    logger.info(f"--- Analyzing Slow Queries (>{SLOW_QUERY_THRESHOLD_MS}ms avg) ---")
    recommendations = []
    if not check_pg_stat_statements(conn):
        return recommendations

    # Query pg_stat_statements for top N slowest average queries
    # Note: Requires appropriate permissions on pg_stat_statements view
    query = """
        SELECT
            userid::regrole AS user,
            dbid::regdatabase AS database,
            queryid,
            query,
            calls,
            total_exec_time,
            mean_exec_time,
            rows
        FROM pg_stat_statements
        WHERE dbid = (SELECT oid FROM pg_database WHERE datname = %s)
          AND mean_exec_time > %s
        ORDER BY mean_exec_time DESC
        LIMIT %s;
    """
    try:
        results = execute_query(conn, query, (PG_DATABASE, SLOW_QUERY_THRESHOLD_MS, TOP_N_SLOW_QUERIES))
        if not results:
            logger.info("No slow queries found exceeding the threshold.")
            return recommendations

        logger.warning(f"Found {len(results)} slow queries (avg > {SLOW_QUERY_THRESHOLD_MS}ms):")
        for row in results:
            rec = (f"Slow Query Found:\n"
                   f"  User: {row['user']}\n"
                   f"  Avg Time: {row['mean_exec_time']:.2f} ms\n"
                   f"  Total Time: {row['total_exec_time']:.2f} ms\n"
                   f"  Calls: {row['calls']}\n"
                   f"  Avg Rows: {row['rows'] / row['calls'] if row['calls'] > 0 else 0:.1f}\n"
                   f"  Query: {row['query'][:200]}...\n" # Truncate long queries
                   f"  Recommendation: Analyze query plan using EXPLAIN ANALYZE. Consider indexing relevant columns.")
            logger.warning(rec)
            recommendations.append(rec)
    except psycopg2.errors.UndefinedTable:
         logger.error("pg_stat_statements view not found or insufficient permissions.")
    except Exception as e:
         logger.error(f"Error analyzing slow queries: {e}")

    return recommendations

def analyze_index_usage(conn):
    """Identifies potentially missing indexes based on sequential scans."""
    logger.info("--- Analyzing Index Usage (Sequential Scans) ---")
    recommendations = []

    # Query for tables with a high number of sequential scans compared to index scans
    # This is a heuristic and might produce false positives.
    query = """
        SELECT
            relname AS table_name,
            seq_scan,
            idx_scan,
            n_live_tup AS live_rows
        FROM pg_stat_user_tables
        WHERE schemaname = 'public' -- Adjust schema if needed
          AND seq_scan > %s
          AND idx_scan IS NOT NULL -- Avoid tables never index scanned
          AND seq_scan > idx_scan * 10 -- Significantly more seq scans than index scans (heuristic)
        ORDER BY seq_scan DESC
        LIMIT 10;
    """
    try:
        results = execute_query(conn, query, (MIN_SEQ_SCANS_FOR_INDEX_REC,))
        if not results:
            logger.info("No tables found with high sequential scan counts based on current heuristics.")
            return recommendations

        logger.warning("Found tables with potentially inefficient sequential scans:")
        for row in results:
            rec = (f"High Sequential Scans on Table '{row['table_name']}':\n"
                   f"  Seq Scans: {row['seq_scan']}\n"
                   f"  Index Scans: {row['idx_scan']}\n"
                   f"  Live Rows: {row['live_rows']}\n"
                   f"  Recommendation: Review queries hitting this table (using pg_stat_statements if enabled). "
                   f"Consider adding indexes on columns used in WHERE clauses or JOIN conditions if appropriate.")
            logger.warning(rec)
            recommendations.append(rec)
    except Exception as e:
        logger.error(f"Error analyzing index usage: {e}")

    return recommendations

# --- Main Execution ---
def main():
    logger.info("=== Starting Database Performance Analysis (PostgreSQL) ===")
    all_recommendations = []

    conn = get_db_connection()
    if not conn:
        sys.exit(1)

    try:
        # Check prerequisites within the DB
        # check_pg_stat_statements(conn) # Called within analyze_slow_queries

        # Run analyses
        slow_query_recs = analyze_slow_queries(conn)
        all_recommendations.extend(slow_query_recs)

        index_recs = analyze_index_usage(conn)
        all_recommendations.extend(index_recs)

        # Add more checks: Unused indexes, connection pooling stats, vacuum/analyze status etc.
        logger.info("Placeholder: Add checks for unused indexes, vacuum status, connection stats...")

    finally:
        if conn:
            conn.close()
            logger.info("Database connection closed.")

    logger.info("--- Analysis Summary ---")
    if not all_recommendations:
        logger.info("No major database optimization recommendations found based on current checks.")
    else:
        logger.warning("Potential Optimization Areas Found:")
        for i, rec in enumerate(all_recommendations):
            print(f"{i+1}. {rec}\n") # Add newline for readability

    logger.info("=== Database Performance Analysis Finished ===")

if __name__ == "__main__":
    main()
