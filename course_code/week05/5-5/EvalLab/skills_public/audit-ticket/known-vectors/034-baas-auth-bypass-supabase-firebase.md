---
id: 34
title: "BaaS Auth Bypass (Supabase/Firebase)"
severity: 9
category: backend
---

### 34 — BaaS Auth Bypass (Supabase/Firebase)
**Severity: 9** | **Real: Thousands of apps exposed 2024-2026, entire databases downloadable**

Row Level Security (RLS) disabled — anon key (visible in client-side code) allows anyone to read/write ALL data via direct API calls.

#### Verification Procedure

**Step 1: Check if BaaS is used**
```
grep -rn --include="*.ts" --include="*.tsx" -iE "supabase|firebase|SUPABASE|FIREBASE|createClient|initializeApp" .
```
- If no BaaS: N/A
- If BaaS: proceed

**Step 2: Check for anon/public key in frontend**
```
grep -rn --include="*.ts" --include="*.tsx" "NEXT_PUBLIC.*SUPABASE\|NEXT_PUBLIC.*FIREBASE\|supabaseUrl\|supabaseAnonKey" apps/web/
```
- Record: Is the anon key exposed (it always is in BaaS architecture)

**Step 3: Verify RLS is enabled (Supabase)**
```
# In Supabase: check migration files or SQL definitions
grep -rn "ENABLE ROW LEVEL SECURITY\|alter table.*enable.*rls\|CREATE POLICY" . --include="*.sql"
```
- ✅ PASS: Every table has RLS enabled with policies that use `auth.uid()`
- ❌ FAIL: Any table without RLS → entire table is readable/writable by anon key

**Step 4: Verify policies cover all operations (Supabase)**
```
grep -rn "CREATE POLICY" . --include="*.sql" | grep -oE "(SELECT|INSERT|UPDATE|DELETE)" | sort | uniq -c
```
- ✅ PASS: Every table has policies for SELECT, INSERT, UPDATE, DELETE operations
- ❌ FAIL: Missing policy for any operation (e.g., SELECT policy exists but no UPDATE policy)

**Step 5: Check for service_role key in frontend**
```
grep -rn --include="*.ts" --include="*.tsx" -iE "service.role\|SERVICE_ROLE\|supabase.*admin\|service.*key" apps/web/
```
- ✅ PASS: Zero results — service_role key never appears in frontend code
- ❌ FAIL: Service_role key in any client-side file (bypasses ALL RLS)

**Step 6: Verify Firebase rules (Firebase)**
```
cat firebase.json 2>/dev/null
cat firestore.rules 2>/dev/null || cat database.rules.json 2>/dev/null
```
- ✅ PASS: Rules check `request.auth != null` and `request.auth.uid == resource.data.userId`
- ❌ FAIL: Rules are `allow read, write: if true;` or missing

**Step 7: Manual test (Supabase)**
```
# Using just the anon key (from client source):
# curl 'https://PROJECT.supabase.co/rest/v1/TABLE' -H 'apikey: ANON_KEY'
# If it returns data → RLS is not working
```
- ✅ PASS: Returns empty or 401 for data you shouldn't access
- ❌ FAIL: Returns all data from the table

**Overall verdict:**
- ✅: RLS enabled on all tables, auth.uid() policies for all operations, service_role not in frontend
- ⚠️: RLS enabled but some tables missing policies
- ❌: RLS disabled, or service_role key in frontend, or `allow: true` rules
- N/A: No BaaS used
