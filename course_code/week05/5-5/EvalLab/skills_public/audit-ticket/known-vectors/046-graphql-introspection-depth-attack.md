---
id: 46
title: "GraphQL Introspection / Depth Attack"
severity: 6
category: backend
---

### 46 — GraphQL Introspection / Depth Attack
**Severity: 6** | **Real: Schema leakage, nested query DoS**

Introspection exposes full schema. Deeply nested query `{ user { posts { comments { user { posts ... } } } } }` crashes server.

#### Verification Procedure

**Step 1: Check for GraphQL**
```
grep -rn --include="*.ts" -iE "graphql|apollo|nexus|type-graphql|mercurius" apps/backend/
```
- If no GraphQL: N/A
- If GraphQL: proceed

**Step 2: Check introspection in production**
```
grep -rn --include="*.ts" "introspection" apps/backend/
```
- ✅ PASS: `introspection: false` in production configuration
- ❌ FAIL: Introspection enabled in production (full schema exposed)

**Step 3: Check query depth limiting**
```
grep -rn --include="*.ts" -iE "depth|maxDepth|depthLimit|complexity" apps/backend/
```
- ✅ PASS: Query depth limit configured (e.g., max depth 5-10)
- ❌ FAIL: No depth limiting (infinitely nested queries accepted)

**Step 4: Check query complexity limiting**
```
grep -rn --include="*.ts" -iE "complexity|cost|maxCost" apps/backend/
```
- ✅ PASS: Query complexity/cost analysis restricts expensive queries
- ⚠️ PARTIAL: Depth limited but no complexity analysis

**Overall verdict:**
- ✅: Introspection off in prod, depth+complexity limits
- ⚠️: Some limits but gaps
- ❌: No depth/complexity limits with GraphQL
- N/A: No GraphQL
