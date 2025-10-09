// frontend/types/next-auth.d.ts
import NextAuth, { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      username: string;
      email: string;
      role?: "superadmin" | "admin" | "user";
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    username: string;
    email: string;
    role?: "superadmin" | "admin" | "user";
  }
}
