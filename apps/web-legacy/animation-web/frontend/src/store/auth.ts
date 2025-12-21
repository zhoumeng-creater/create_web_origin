import { api } from "../lib/api";

export type User = { email: string; created_at: string } | null;

export function setToken(t: string) { localStorage.setItem("token", t); }
export function getToken(): string | null { return localStorage.getItem("token"); }
export function clearToken() { localStorage.removeItem("token"); }

export async function fetchMe(): Promise<User> {
  try {
    const { data } = await api.get("/auth/me");
    return data;
  } catch {
    return null;
  }
}
