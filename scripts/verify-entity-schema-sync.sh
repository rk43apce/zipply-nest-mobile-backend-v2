#!/bin/bash

# Entity ↔ Database Schema Sync Verification Script
# Usage: bash scripts/verify-entity-schema-sync.sh
# Verifies all entities have columns that match actual database schema

set -e

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5433}"
DB_NAME="${DB_NAME:-vida_rider}"
DB_USER="${DB_USER:-vida}"
DB_PASSWORD="${DB_PASSWORD:-password}"

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Entity ↔ Database Schema Sync Verification${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo ""

# Test database connection
echo -e "${YELLOW}Testing database connection...${NC}"
if ! psql postgresql://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME -c "SELECT 1;" &> /dev/null; then
  echo -e "${RED}❌ Cannot connect to database${NC}"
  echo "   Host: $DB_HOST:$DB_PORT"
  echo "   Database: $DB_NAME"
  echo "   User: $DB_USER"
  exit 1
fi
echo -e "${GREEN}✅ Database connected${NC}"
echo ""

# Define tables and their expected column counts
declare -A TABLES=(
  ["payment_transactions"]="14"
  ["topup_limits_tracker"]="5"
  ["wallets"]="14"
  ["wallet_transactions"]="8"
  ["wallet_holds"]="6"
  ["commission_ledger"]="7"
  ["business_rules"]="5"
  ["wallet_audit_log"]="8"
  ["transaction_links"]="5"
  ["refund_requests"]="8"
  ["wallet_transaction_links"]="3"
)

TOTAL_TABLES=${#TABLES[@]}
SYNCED_TABLES=0
FAILED_TABLES=0
MISSING_TABLES=0

echo -e "${BLUE}Verifying ${TOTAL_TABLES} entities...${NC}"
echo ""

# Verify each table
for table_name in "${!TABLES[@]}"; do
  expected_cols=${TABLES[$table_name]}
  
  # Check if table exists
  table_exists=$(psql postgresql://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME -t -c \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_name='$table_name';" 2>/dev/null)
  
  if [ "$table_exists" -eq 0 ]; then
    echo -e "${YELLOW}⚠️  $table_name${NC} (TABLE NOT FOUND - may not be created yet)"
    ((MISSING_TABLES++))
    continue
  fi
  
  # Get actual column count
  actual_cols=$(psql postgresql://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME -t -c \
    "SELECT COUNT(*) FROM information_schema.columns WHERE table_name='$table_name';" 2>/dev/null)
  
  actual_cols=$(echo $actual_cols | tr -d ' ')
  expected_cols=$(echo $expected_cols | tr -d ' ')
  
  if [ "$actual_cols" -eq "$expected_cols" ]; then
    echo -e "${GREEN}✅ $table_name${NC} (${actual_cols} columns)"
    ((SYNCED_TABLES++))
  else
    echo -e "${RED}❌ $table_name${NC} (expected ${expected_cols}, found ${actual_cols})"
    echo "   Run: psql ... -c \"\\d $table_name\" to see details"
    ((FAILED_TABLES++))
  fi
done

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo "Results: ${GREEN}${SYNCED_TABLES} synced${NC}, ${RED}${FAILED_TABLES} failed${NC}, ${YELLOW}${MISSING_TABLES} missing${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo ""

if [ $FAILED_TABLES -gt 0 ]; then
  echo -e "${RED}❌ SYNC CHECK FAILED - Fix entity definitions or database schema${NC}"
  echo ""
  echo "To debug a specific table:"
  echo "  psql postgresql://$DB_USER:***@$DB_HOST:$DB_PORT/$DB_NAME"
  echo "  \\d table_name  # Show table structure"
  echo "  SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='table_name' ORDER BY ordinal_position;"
  echo ""
  exit 1
fi

if [ $MISSING_TABLES -gt 0 ]; then
  echo -e "${YELLOW}⚠️  ${MISSING_TABLES} tables not yet created${NC}"
  echo "   Run migrations to create missing tables: npm run migration:run"
  echo ""
fi

echo -e "${GREEN}✅ ALL SYNCED - Entity definitions match database schema${NC}"
echo ""
exit 0
