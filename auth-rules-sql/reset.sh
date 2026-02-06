#!/bin/bash
set -e

# Auth Rules SQL - Reset & Test Script
# Resets the postgres database and runs all migrations + tests

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
AUTH_SCHEMA="$PROJECT_ROOT/vendor/supabase-postgres/migrations/db/init-scripts/00000000000001-auth-schema.sql"

echo "=== Auth Rules SQL Reset ==="
echo ""

# Check if docker is available
if ! command -v docker &> /dev/null; then
    echo "Error: docker is not installed or not in PATH"
    exit 1
fi

# Function to run psql via docker
run_sql() {
    docker-compose -f "$SCRIPT_DIR/docker-compose.yml" exec -T postgres psql -U postgres -d postgres "$@"
}

run_sql_file() {
    echo "Running: $(basename "$1")"
    docker-compose -f "$SCRIPT_DIR/docker-compose.yml" exec -T postgres psql -U postgres -d postgres -f "/sql/$(basename "$1")"
}

run_sql_content() {
    docker-compose -f "$SCRIPT_DIR/docker-compose.yml" exec -T postgres psql -U postgres -d postgres
}

# Stop and remove existing container
echo "1. Stopping existing postgres container..."
docker-compose -f "$SCRIPT_DIR/docker-compose.yml" down -v 2>/dev/null || true

# Start fresh postgres
echo "2. Starting fresh postgres container..."
docker-compose -f "$SCRIPT_DIR/docker-compose.yml" up -d

# Wait for postgres to be ready
echo "3. Waiting for postgres to be ready..."
until docker-compose -f "$SCRIPT_DIR/docker-compose.yml" exec -T postgres pg_isready -U postgres > /dev/null 2>&1; do
    sleep 1
done
echo "   Postgres is ready!"

# Small extra delay to ensure postgres is fully initialized
sleep 2

# Create roles and run auth schema
echo "4. Running auth schema..."
echo "CREATE ROLE supabase_admin NOLOGIN; CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;" | run_sql_content 2>/dev/null || true
cat "$AUTH_SCHEMA" | run_sql_content
echo "   Auth schema complete!"

# Run our system SQL
echo "5. Running auth_rules system SQL..."
cat "$SCRIPT_DIR/sql/system.sql" | run_sql_content
echo "   System SQL complete!"

# Run tests
echo ""
echo "6. Running tests..."
echo "========================================"
for test_file in "$SCRIPT_DIR"/sql/tests/*.sql; do
  echo "--- Running: $(basename "$test_file") ---"
  cat "$test_file" | run_sql_content
done
echo "========================================"

echo ""
echo "=== Reset Complete ==="
echo ""
echo "Connect with: docker-compose -f $SCRIPT_DIR/docker-compose.yml exec postgres psql -U postgres"
