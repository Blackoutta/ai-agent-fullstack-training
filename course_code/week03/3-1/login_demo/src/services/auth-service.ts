import { userRepository } from "../repositories/user-repository";
import { LoginResult } from "../types/user";
import { verifyPassword } from "../utils/password";
import { issueAccessToken } from "../utils/token";

export class AuthService {
  async login(email: string, password: string): Promise<LoginResult> {
    const user = await userRepository.findByEmail(email);

    if (!user) {
      throw new Error("User not found");
    }

    const passwordMatched = await verifyPassword(password, user.passwordHash);

    if (!passwordMatched) {
      throw new Error("Invalid password");
    }

    const accessToken = issueAccessToken({
      userId: user.id,
      role: user.role
    });

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role
      }
    };
  }
}

export const authService = new AuthService();
