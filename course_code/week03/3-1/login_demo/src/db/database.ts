import { UserRecord } from "../types/user";

type TableName = "users";

const usersTable: UserRecord[] = [
  {
    id: "u_1001",
    email: "demo@example.com",
    passwordHash: "hash:demo123",
    displayName: "Demo User",
    role: "member"
  },
  {
    id: "u_1002",
    email: "admin@example.com",
    passwordHash: "hash:admin123",
    displayName: "Admin User",
    role: "admin"
  }
];

function getTable(table: TableName): UserRecord[] {
  if (table === "users") {
    return usersTable;
  }

  return [];
}

// Simulated database access so the repository can clearly show a users table lookup.
export async function queryOne(
  table: TableName,
  where: Partial<UserRecord>
): Promise<UserRecord | undefined> {
  const rows = getTable(table);

  return rows.find((row) =>
    Object.entries(where).every(([key, value]) => {
      const field = key as keyof UserRecord;
      return row[field] === value;
    })
  );
}
