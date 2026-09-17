import { queryOne } from "../db/database";
import { UserRecord } from "../types/user";

export class UserRepository {
  async findByEmail(email: string): Promise<UserRecord | undefined> {
    // The repository is responsible for reading the users table.
    return queryOne("users", { email });
  }
}

export const userRepository = new UserRepository();
